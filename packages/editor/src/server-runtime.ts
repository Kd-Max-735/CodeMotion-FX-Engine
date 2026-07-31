import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { TenantMediaStore, type MediaLimits } from "@codemotion/exporter";
import {
  AuthSessionService,
  developmentAuthOptionsFromEnvironment,
  productionAuthOptionsFromEnvironment,
  type AuthAuditEvent,
  type ProductionAuthEnvironment
} from "./auth-session-service.js";
import { AiPlanService, createAiPlanApi, createProductionAiPlanService } from "./ai-plan-service.js";
import { MediaAssetService } from "./media-asset-service.js";

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>;

export interface ServerRuntimeOptions {
  readonly mode: "production" | "preview" | "development";
  readonly configureServer?: boolean;
  readonly listenHost?: string;
  readonly publicOrigin?: string;
  readonly mediaRoot: string;
  readonly uploadTempRoot: string;
  readonly env?: ProductionAuthEnvironment;
  readonly mediaLimits?: Partial<MediaLimits>;
  readonly fetch?: typeof fetch;
  readonly writeDevLoginCode?: (code: string) => void;
  readonly authAudit?: (event: AuthAuditEvent) => void;
  readonly mediaAudit?: (event: Readonly<{ event: "media-index-record-rejected" | "media-index-load-failed" }>) => void;
}

export interface ServerRuntime {
  readonly auth: AuthSessionService;
  readonly mediaStore: TenantMediaStore;
  readonly mediaAssets: MediaAssetService;
  readonly aiPlans: AiPlanService;
  readonly handle: Middleware;
}

export async function createServerRuntime(options: ServerRuntimeOptions): Promise<ServerRuntime> {
  const env = options.env ?? process.env;
  const mediaRoot = resolve(options.mediaRoot);
  const uploadTempRoot = resolve(options.uploadTempRoot);
  const authOptions = options.mode === "development"
    ? developmentAuthOptionsFromEnvironment(env, {
      configureServer: options.configureServer === true,
      listenHost: options.listenHost ?? "",
      publicOrigin: options.publicOrigin ?? "",
      writeLoginCode: options.writeDevLoginCode ?? ((code) => {
        if (!process.stderr.isTTY) throw new Error("Dev login code requires an interactive controlling terminal.");
        process.stderr.write(`CodeMotion local login code: ${code}\n`);
      })
    }, { ...(options.authAudit === undefined ? {} : { audit: options.authAudit }) })
    : productionAuthOptionsFromEnvironment(env, {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.authAudit === undefined ? {} : { audit: options.authAudit })
    });
  const auth = new AuthSessionService(authOptions);
  const mediaStore = new TenantMediaStore({
    storageRoot: mediaRoot,
    allowedRoots: [uploadTempRoot],
    ...(options.mediaLimits === undefined ? {} : { limits: options.mediaLimits }),
    ...(options.mediaAudit === undefined ? {} : { audit: options.mediaAudit })
  });
  await Promise.all([auth.initialize(), mediaStore.initialize()]);
  const cursorSecret = createHash("sha256").update("codemotion-media-cursor-secret-v1\0")
    .update(authOptions.sessionSecret).update(randomBytes(32)).digest();
  const mediaAssets = new MediaAssetService({ store: mediaStore, auth, uploadTempRoot, cursorSecret });
  const aiPlans = createProductionAiPlanService(mediaStore);
  const handlers: Middleware[] = [
    auth.handle(),
    mediaAssets.handle(),
    createAiPlanApi(
      aiPlans,
      (request, response) => auth.resolveSession(request, response),
      (request, response) => auth.authorize(request, response, "ai:plan", true).then(() => undefined)
    )
  ];
  const handle: Middleware = async (request, response, next) => {
    let index = 0;
    const dispatch = async (): Promise<void> => {
      const handler = handlers[index++];
      if (handler === undefined) { next(); return; }
      let continued = false;
      await handler(request, response, () => { continued = true; });
      if (continued) await dispatch();
    };
    await dispatch();
  };
  return { auth, mediaStore, mediaAssets, aiPlans, handle };
}
