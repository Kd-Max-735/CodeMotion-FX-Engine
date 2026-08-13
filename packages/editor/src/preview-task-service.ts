import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { RenderQuality } from "@codemotion/core";
import {
  makeBrushCoverage,
  P0_BROWSER_PROJECT_AUTHORITY_V1,
  resolveFormal2dRasterSourceV1
} from "@codemotion/effects-2d";
import { createProjectFrameProducer, MediaPreviewDecodeError, type OwnerContext } from "@codemotion/exporter";
import type { EditorPreviewRequestV1 } from "@codemotion/schema";
import type { CoverageBuffer, LayerRasterSource } from "@codemotion/renderer-api";
import type {
  AuthenticatedSessionPrincipal,
  AuthSessionService
} from "./auth-session-service.js";
import {
  materializeBrowserProjectV1,
  ProjectServiceError,
  type OwnerMediaResolverV1
} from "./project-materialization.js";

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export function sendSafeProjectError(response: ServerResponse, status: number, code: string): void {
  const messages: Readonly<Record<string, string>> = Object.freeze({
    UNAUTHENTICATED: "Authentication is required.",
    FORBIDDEN: "The required permission is missing.",
    REQUEST_ORIGIN_REJECTED: "The request origin was rejected.",
    MALFORMED_REQUEST: "The request is malformed.",
    UNSUPPORTED_CONTRACT: "Unsupported contract.",
    PROJECT_TOO_LARGE: "The project exceeds the allowed size.",
    BROWSER_PROJECT_UNSAFE: "The browser project is unsafe.",
    PROJECT_VALIDATION_FAILED: "Project validation failed.",
    ASSET_REFERENCE_INVALID: "A project asset reference is invalid.",
    NOT_FOUND: "The requested object was not found.",
    MEDIA_STORAGE_UNAVAILABLE: "Media storage is temporarily unavailable.",
    MEDIA_VALIDATION_FAILED: "Media validation failed.",
    ASSET_CHANGED_DURING_MATERIALIZATION: "The project asset changed during validation.",
    SERVICE_CLOSING: "The service is closing.",
    MEDIA_PREVIEW_DECODE_FAILED: "The project media could not be decoded for preview.",
    PREVIEW_RENDER_FAILED: "Preview rendering failed."
  });
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify({
    error: {
      code,
      message: messages[code] ?? "The request failed.",
      retryable: status >= 500,
      requestId: `req_${randomUUID()}`
    }
  }));
}

async function jsonBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  const length = request.headers["content-length"];
  if (typeof length === "string" && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new ProjectServiceError("PROJECT_TOO_LARGE");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    signal.throwIfAborted();
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new ProjectServiceError("PROJECT_TOO_LARGE");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ProjectServiceError("MALFORMED_REQUEST"); }
}

export class EditorPreviewService {
  private readonly active = new Set<AbortController>();
  private readonly currentProjectAssets = new Map<string, ReadonlySet<string>>();
  private closing = false;

  private readonly resolver: OwnerMediaResolverV1;

  constructor(resolver: OwnerMediaResolverV1 | string) {
    this.resolver = typeof resolver === "string"
      ? { resolve: async () => { throw new ProjectServiceError("SERVICE_CLOSING"); } }
      : resolver;
    if (this.resolver === undefined || typeof this.resolver.resolve !== "function") {
      throw new Error("Browser project authority is not configured.");
    }
    if (!Object.isFrozen(P0_BROWSER_PROJECT_AUTHORITY_V1)) {
      throw new Error("Browser project authority is not configured.");
    }
  }

  usesAsset(owner: OwnerContext, assetId: string): boolean {
    return this.currentProjectAssets.get(JSON.stringify([owner.tenantId, owner.userId]))?.has(assetId) === true;
  }

  async render(
    principal: AuthenticatedSessionPrincipal,
    rawRequest: unknown,
    signal?: AbortSignal
  ): Promise<{
    readonly pixels: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly time: number;
    readonly quality: RenderQuality;
  }> {
    if (this.closing) throw new ProjectServiceError("SERVICE_CLOSING");
    signal?.throwIfAborted();
    const validated = P0_BROWSER_PROJECT_AUTHORITY_V1.validateEditorPreviewRequest(rawRequest);
    if (!validated.valid) {
      const code = validated.error.code;
      throw new ProjectServiceError(code === "PROJECT_TOO_LARGE" ? "PROJECT_TOO_LARGE"
        : code === "UNSUPPORTED_CONTRACT" ? "UNSUPPORTED_CONTRACT"
          : code === "BROWSER_PROJECT_UNSAFE" ? "BROWSER_PROJECT_UNSAFE" : "MALFORMED_REQUEST");
    }
    const request: EditorPreviewRequestV1 = validated.value;
    const materialized = await materializeBrowserProjectV1(principal, request.editableProject, this.resolver, signal);
    signal?.throwIfAborted();
    this.currentProjectAssets.set(
      JSON.stringify([principal.tenantId, principal.userId]),
      new Set(materialized.project.assets.map((asset) => asset.id))
    );
    const project = structuredClone(materialized.project);
    const { width, height, quality } = request.frame;
    const time = Math.min(
      Math.max(0, request.frame.time),
      Math.max(0, project.duration - 1 / project.fps)
    );
    for (const composition of project.compositions) {
      for (const layer of composition.layers) {
        for (const effect of layer.effects) effect.renderQuality = quality;
      }
    }
    const coverageAssets = new Map<string, CoverageBuffer>([["builtin://brush/round", makeBrushCoverage()]]);
    const producer = createProjectFrameProducer(project, materialized.media, {
      timeContractVersion: "1.1.0",
      coverageAssets,
      resolveRasterSource: (context) => resolveFormal2dRasterSourceV1({
        layer: context.layer,
        compositionWidth: context.composition.width,
        compositionHeight: context.composition.height,
        renderWidth: context.request.width,
        renderHeight: context.request.height,
        projectSeed: context.project.seed,
        projectTime: context.projectTime.projectTime,
        layerTime: context.layerTime.localTime,
        ...(signal === undefined ? {} : { signal })
      }) as LayerRasterSource
    });
    const pixels = await producer({
      frame: Math.floor(time * project.fps + 1e-9),
      time,
      deltaTime: 1 / project.fps,
      fps: project.fps,
      width,
      height
    }, signal);
    signal?.throwIfAborted();
    if (pixels.byteLength !== width * height * 4) throw new Error("Invalid preview output.");
    return { pixels, width, height, time, quality };
  }

  track(controller: AbortController): () => void {
    if (this.closing) controller.abort(new ProjectServiceError("SERVICE_CLOSING"));
    this.active.add(controller);
    return () => { this.active.delete(controller); };
  }

  async close(): Promise<void> {
    this.closing = true;
    this.currentProjectAssets.clear();
    for (const controller of this.active) controller.abort(new ProjectServiceError("SERVICE_CLOSING"));
    const deadline = Date.now() + 5_000;
    while (this.active.size > 0 && Date.now() < deadline) {
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, Math.min(10, deadline - Date.now())));
    }
  }
}

function errorDetails(error: unknown): { status: number; code: string } {
  if (error instanceof ProjectServiceError) return { status: error.status, code: error.code };
  if (error instanceof MediaPreviewDecodeError) {
    return {
      status: error.reason === "process" ? 500 : 422,
      code: "MEDIA_PREVIEW_DECODE_FAILED"
    };
  }
  if (typeof error === "object" && error !== null && "status" in error && "code" in error) {
    const candidate = error as { status: unknown; code: unknown };
    if (typeof candidate.status === "number" && typeof candidate.code === "string") {
      return { status: candidate.status, code: candidate.code };
    }
  }
  return { status: 500, code: "PREVIEW_RENDER_FAILED" };
}

export function createEditorPreviewApi(
  service: EditorPreviewService,
  auth?: Pick<AuthSessionService, "authorize">
) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/editor-preview") return next();
    if (request.method !== "POST") return next();
    let release = (): void => undefined;
    let removeDisconnectListeners = (): void => undefined;
    try {
      if (auth === undefined) throw { status: 401, code: "UNAUTHENTICATED" };
      const principal = await auth.authorize(request, response, "project:preview", true);
      const controller = new AbortController();
      release = service.track(controller);
      const abort = (): void => controller.abort();
      const close = (): void => { if (!response.writableEnded) abort(); };
      request.once("aborted", abort);
      response.once("close", close);
      removeDisconnectListeners = () => {
        request.off("aborted", abort);
        response.off("close", close);
      };
      const body = await jsonBody(request, controller.signal);
      const result = await service.render(principal, body, controller.signal);
      controller.signal.throwIfAborted();
      response.statusCode = 200;
      response.setHeader("content-type", "application/octet-stream");
      response.setHeader("content-length", String(result.pixels.byteLength));
      response.setHeader("cache-control", "no-store");
      response.setHeader("x-content-type-options", "nosniff");
      response.setHeader("x-cmfx-width", String(result.width));
      response.setHeader("x-cmfx-height", String(result.height));
      response.setHeader("x-cmfx-time", String(result.time));
      response.setHeader("x-cmfx-quality", result.quality);
      response.setHeader("x-cmfx-time-contract", "1.1.0");
      response.setHeader("x-cmfx-renderer", "createProjectFrameProducer");
      response.end(Buffer.from(result.pixels));
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        const details = errorDetails(error);
        sendSafeProjectError(response, details.status, details.code);
      }
    } finally {
      removeDisconnectListeners();
      release();
    }
  };
}
