import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { TenantMediaStore, type MediaLimits } from "@codemotion/exporter";
import { loadServerEnvironment } from "@codemotion/ai-planner/server-environment";
import {
  AuthSessionService,
  developmentAuthOptionsFromEnvironment,
  productionAuthOptionsFromEnvironment,
  type AuthAuditEvent,
  type ProductionAuthEnvironment
} from "./auth-session-service.js";
import { AiPlanService, createAiPlanApi, createProductionAiPlanService } from "./ai-plan-service.js";
import { ExportTaskService, createExportApi } from "./export-task-service.js";
import { MediaAssetService } from "./media-asset-service.js";
import { EditorPreviewService, createEditorPreviewApi, sendSafeProjectError } from "./preview-task-service.js";

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>;

export interface ServerRuntimeOptions {
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
  readonly mediaAudit?: (event: Readonly<{ event: "media-index-record-rejected" | "media-index-load-failed" }>) => void;
  readonly createAiPlans?: (assets: TenantMediaStore) => AiPlanService;
}

export interface ServerRuntime {
  readonly auth: AuthSessionService;
  readonly mediaStore: TenantMediaStore;
  readonly mediaAssets: MediaAssetService;
  readonly aiPlans: AiPlanService;
  readonly previews: EditorPreviewService;
  readonly exports: ExportTaskService;
  readonly handle: Middleware;
  close(): Promise<void>;
  dispose(): Promise<void>;
}

export async function createServerRuntime(options: ServerRuntimeOptions): Promise<ServerRuntime> {
  const env = options.env ?? loadServerEnvironment().env;
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
  const initializationFailures = initialization
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (initializationFailures.length === 1) throw initializationFailures[0];
  if (initializationFailures.length > 1) {
    throw new AggregateError(initializationFailures, "Server runtime foundations failed to initialize.");
  }
  const cursorSecret = createHash("sha256").update("codemotion-media-cursor-secret-v1\0")
    .update(authOptions.sessionSecret).update(randomBytes(32)).digest();
  let mediaAssets: MediaAssetService | undefined;
  let aiPlans: AiPlanService | undefined;
  let previews: EditorPreviewService | undefined;
  let exports: ExportTaskService | undefined;
  try {
    mediaAssets = new MediaAssetService({
      store: mediaStore,
      auth,
      uploadTempRoot,
      cursorSecret,
      isAssetInUse: (owner, assetId) => aiPlans?.usesAsset(owner, assetId) === true
        || previews?.usesAsset(owner, assetId) === true
        || exports?.usesAsset(owner, assetId) === true
    });
    aiPlans = options.createAiPlans?.(mediaStore) ?? createProductionAiPlanService(
      mediaStore,
      options.mode === "development" && options.configureServer === true,
      env
    );
    previews = new EditorPreviewService(mediaStore);
    exports = new ExportTaskService({ resolver: mediaStore, outputRoot: exportRoot });
    await exports.initialize();
  } catch (error) {
    const cleanup = await Promise.allSettled([
      mediaAssets?.close(),
      aiPlans?.close(),
      previews?.close(),
      exports?.close()
    ]);
    const cleanupFailures = cleanup
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);
    if (cleanupFailures.length > 0) {
      throw new AggregateError([error, ...cleanupFailures], "Server runtime initialization and cleanup failed.");
    }
    throw error;
  }
  const handlers: Middleware[] = [
    auth.handle(),
    mediaAssets.handle(),
    createAiPlanApi(
      aiPlans,
      (request, response) => auth.resolveSession(request, response),
      (request, response) => auth.authorize(request, response, "ai:plan", true).then(() => undefined)
    ),
    createEditorPreviewApi(previews, auth),
    createExportApi(exports, auth)
  ];
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const handle: Middleware = async (request, response, next) => {
    if (closing) {
      if ((request.url ?? "").startsWith("/api/")) {
        sendSafeProjectError(response, 503, "SERVICE_CLOSING");
        return;
      }
      next();
      return;
    }
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
  const close = (): Promise<void> => {
    if (closePromise !== undefined) return closePromise;
    closing = true;
    closePromise = Promise.all([mediaAssets.close(), aiPlans.close(), previews.close(), exports.close()]).then(() => undefined);
    return closePromise;
  };
  return { auth, mediaStore, mediaAssets, aiPlans, previews, exports, handle, close, dispose: close };
}
