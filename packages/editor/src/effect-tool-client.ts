/// <reference types="vite/client" />

import { csrfToken } from "./ai-plan-client.js";
import { BrowserApiError } from "./media-asset-client.js";

export interface NativeEffectToolView {
  readonly toolName: "film_grain";
  readonly displayName: string;
  readonly category: string;
  readonly configured: boolean;
}

export interface NativeToolCallView {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: "film_grain";
    readonly arguments: Readonly<Record<string, unknown>>;
  };
}

export interface NativeExecutionView {
  readonly id: string;
  readonly status: "queued" | "running" | "completed" | "failed";
  readonly toolName: "film_grain";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: { readonly kind: "video"; readonly assetId: string };
  readonly video: {
    readonly format: "mp4";
    readonly mime: "video/mp4";
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly durationSeconds: number;
    readonly frameCount: number;
    readonly completedFrames: number;
    readonly progress: number;
    readonly audio: boolean;
    readonly bytes?: number;
    readonly downloadName?: string;
  };
  readonly failure?: { readonly code: "VIDEO_RENDER_FAILED"; readonly message: string };
}

export type NativeEffectTurn = Readonly<{
  kind: "message";
  reasoningContent: string;
  content: string;
}> | Readonly<{
  kind: "tool_call";
  reasoningContent: string;
  content: string;
  toolCall: NativeToolCallView;
  execution: NativeExecutionView;
}>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  return value as Record<string, unknown>;
}

async function jsonRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try { response = await fetch(path, { credentials: "same-origin", ...init }); }
  catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new BrowserApiError(0, "SERVICE_UNREACHABLE", true);
  }
  const body = await response.json().catch(() => ({})) as { error?: { code?: unknown; retryable?: unknown } };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("cmfx:unauthenticated"));
    throw new BrowserApiError(
      response.status,
      typeof body.error?.code === "string" ? body.error.code : `HTTP_${response.status}`,
      body.error?.retryable === true
    );
  }
  return body;
}

function tool(value: unknown): NativeEffectToolView {
  const raw = object(value);
  if (raw.toolName !== "film_grain" || typeof raw.displayName !== "string"
    || typeof raw.category !== "string" || typeof raw.configured !== "boolean") {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  return {
    toolName: "film_grain",
    displayName: raw.displayName,
    category: raw.category,
    configured: raw.configured
  };
}

function execution(value: unknown): NativeExecutionView {
  const raw = object(value);
  const source = object(raw.source);
  const video = object(raw.video);
  const status = raw.status;
  if (typeof raw.id !== "string" || !["queued", "running", "completed", "failed"].includes(String(status))
    || raw.toolName !== "film_grain" || typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string"
    || source.kind !== "video" || typeof source.assetId !== "string"
    || video.format !== "mp4" || video.mime !== "video/mp4"
    || ![video.width, video.height, video.fps, video.durationSeconds, video.frameCount,
      video.completedFrames, video.progress].every((item) => typeof item === "number" && Number.isFinite(item))
    || typeof video.audio !== "boolean"
    || (video.bytes !== undefined && typeof video.bytes !== "number")
    || (video.downloadName !== undefined && typeof video.downloadName !== "string")) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  const failure = raw.failure === undefined ? undefined : object(raw.failure);
  if (failure !== undefined && (failure.code !== "VIDEO_RENDER_FAILED" || typeof failure.message !== "string")) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  return {
    id: raw.id,
    status: status as NativeExecutionView["status"],
    toolName: "film_grain",
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    source: { kind: "video", assetId: source.assetId as string },
    video: {
      format: "mp4",
      mime: "video/mp4",
      width: video.width as number,
      height: video.height as number,
      fps: video.fps as number,
      durationSeconds: video.durationSeconds as number,
      frameCount: video.frameCount as number,
      completedFrames: video.completedFrames as number,
      progress: video.progress as number,
      audio: video.audio as boolean,
      ...(video.bytes === undefined ? {} : { bytes: video.bytes as number }),
      ...(video.downloadName === undefined ? {} : { downloadName: video.downloadName as string })
    },
    ...(failure === undefined ? {} : {
      failure: { code: "VIDEO_RENDER_FAILED", message: failure.message as string }
    })
  };
}

function turn(value: unknown): NativeEffectTurn {
  const raw = object(value);
  if (typeof raw.reasoningContent !== "string" || typeof raw.content !== "string") {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  if (raw.kind === "message") {
    return { kind: "message", reasoningContent: raw.reasoningContent, content: raw.content };
  }
  if (raw.kind !== "tool_call") throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  const call = object(raw.toolCall);
  const fn = object(call.function);
  const args = object(fn.arguments);
  if (typeof call.id !== "string" || call.type !== "function" || fn.name !== "film_grain") {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  return {
    kind: "tool_call",
    reasoningContent: raw.reasoningContent,
    content: raw.content,
    toolCall: {
      id: call.id,
      type: "function",
      function: { name: "film_grain", arguments: structuredClone(args) }
    },
    execution: execution(raw.execution)
  };
}

function csrfHeaders(): HeadersInit {
  const token = csrfToken();
  if (!token) throw new BrowserApiError(403, "CSRF_MISSING", false);
  return { "content-type": "application/json", "X-CMFX-CSRF": token };
}

export const nativeEffectToolApi = {
  describe: async (signal?: AbortSignal): Promise<NativeEffectToolView> => {
    const body = object(await jsonRequest("/api/effect-tools/v2", signal === undefined ? {} : { signal }));
    return tool(body.tool);
  },
  turn: async (request: {
    readonly prompt: string;
    readonly sourceVideoId?: string;
  }, signal?: AbortSignal): Promise<NativeEffectTurn> => {
    const body = object(await jsonRequest("/api/effect-tools/v2/turns", {
      method: "POST",
      headers: csrfHeaders(),
      body: JSON.stringify({
        prompt: request.prompt,
        inputIds: request.sourceVideoId === undefined ? {} : { source_video: request.sourceVideoId }
      }),
      ...(signal === undefined ? {} : { signal })
    }));
    return turn(body.turn);
  },
  execution: async (executionId: string, signal?: AbortSignal): Promise<NativeExecutionView> => {
    const body = object(await jsonRequest(
      `/api/effect-tools/v2/executions/${encodeURIComponent(executionId)}`,
      signal === undefined ? {} : { signal }
    ));
    return execution(body.execution);
  },
  videoUrl: (executionId: string): string => `/api/effect-tools/v2/executions/${encodeURIComponent(executionId)}/video`,
  downloadUrl: (executionId: string): string => `/api/effect-tools/v2/executions/${encodeURIComponent(executionId)}/download`
};
