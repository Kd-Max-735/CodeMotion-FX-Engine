import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { TenantMediaStore, type MediaLimits } from "@codemotion/exporter";
import {
  AuthSessionService,
  developmentAuthOptionsFromEnvironment,
  productionAuthOptionsFromEnvironment,
  type AuthAuditEvent,
  type ProductionAuthEnvironment
} from "./auth-session-service.js";
import {
  EffectToolService,
  createEffectToolApi,
  createProductionEffectToolService
} from "./effect-tool-service.js";
import { MediaAssetService } from "./media-asset-service.js";

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>;

export interface AeAgentServerRuntimeOptions {
  readonly mode: "production" | "preview" | "development";
  readonly configureServer?: boolean;
  readonly listenHost?: string;
  readonly publicOrigin?: string;
  readonly mediaRoot: string;
  readonly uploadTempRoot: string;
  readonly exportRoot?: string;
  readonly env?: ProductionAuthEnvironment;
  readonly mediaLimits?: Partial<MediaLimits>;
  readonly fetch?: typeof fetch;
  readonly authAudit?: (event: AuthAuditEvent) => void;
  readonly mediaAudit?: (event: Readonly<{
    event: "media-index-record-rejected" | "media-index-load-failed";
  }>) => void;
  readonly createEffectTools?: (assets: TenantMediaStore) => EffectToolService;
}

export interface AeAgentServerRuntime {
  readonly auth: AuthSessionService;
  readonly mediaStore: TenantMediaStore;
  readonly mediaAssets: MediaAssetService;
  readonly effectTools: EffectToolService;
  readonly handle: Middleware;
  close(): Promise<void>;
}

function serviceClosing(response: ServerResponse): void {
  const body = JSON.stringify({ error: { code: "SERVICE_CLOSING", retryable: true } });
  response.statusCode = 503;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

export async function createAeAgentServerRuntime(
  options: AeAgentServerRuntimeOptions
): Promise<AeAgentServerRuntime> {
  const env: ProductionAuthEnvironment = options.env ?? process.env;
  const mediaRoot = resolve(options.mediaRoot);
  const uploadTempRoot = resolve(options.uploadTempRoot);
  const exportRoot = resolve(options.exportRoot ?? join(mediaRoot, "..", "exports"));
  const authOptions = options.mode === "development"
    ? developmentAuthOptionsFromEnvironment(env, {
      configureServer: options.configureServer === true,
      listenHost: options.listenHost ?? "",
      publicOrigin: options.publicOrigin ?? ""
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
  const initialization = await Promise.allSettled([auth.initialize(), mediaStore.initialize()]);
  const failures = initialization
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, "AE Agent foundations failed to initialize.");
  }

  const cursorSecret = createHash("sha256").update("codemotion-media-cursor-secret-v1\0")
    .update(authOptions.sessionSecret).update(randomBytes(32)).digest();
  let effectTools: EffectToolService | undefined;
  let mediaAssets: MediaAssetService | undefined;
  try {
    effectTools = options.createEffectTools?.(mediaStore)
      ?? createProductionEffectToolService(
        mediaStore,
        env,
        options.fetch,
        undefined,
        join(exportRoot, "effect-tools")
      );
    mediaAssets = new MediaAssetService({
      store: mediaStore,
      auth,
      uploadTempRoot,
      cursorSecret,
      isAssetInUse: (owner, assetId) => effectTools?.usesAsset(owner, assetId) === true
    });
  } catch (error) {
    const cleanup = await Promise.allSettled([effectTools?.close(), mediaAssets?.close()]);
    const cleanupFailures = cleanup
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (cleanupFailures.length > 0) {
      throw new AggregateError([error, ...cleanupFailures], "AE Agent initialization cleanup failed.");
    }
    throw error;
  }

  const handlers: Middleware[] = [
    auth.handle(),
    mediaAssets.handle(),
    createEffectToolApi(effectTools, auth)
  ];
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const handle: Middleware = async (request, response, next) => {
    if (closing) {
      if ((request.url ?? "").startsWith("/api/") || (request.url ?? "").startsWith("/auth/")) {
        serviceClosing(response);
        return;
      }
      next();
      return;
    }
    let index = 0;
    const dispatch = async (): Promise<void> => {
      const handler = handlers[index++];
      if (handler === undefined) {
        next();
        return;
      }
      let continued = false;
      await handler(request, response, () => { continued = true; });
      if (continued) await dispatch();
    };
    await dispatch();
  };
  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closing = true;
    closePromise = Promise.all([mediaAssets.close(), effectTools.close()]).then(() => undefined);
    return closePromise;
  };
  return { auth, mediaStore, mediaAssets, effectTools, handle, close };
}
