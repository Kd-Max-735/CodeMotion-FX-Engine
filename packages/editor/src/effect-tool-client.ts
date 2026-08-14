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
  readonly status: "completed";
  readonly toolName: "film_grain";
  readonly createdAt: string;
  readonly result: {
    readonly kind: string;
    readonly backendId: string;
    readonly degraded: boolean;
    readonly warnings: readonly string[];
    readonly output: unknown;
  };
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
  const result = object(raw.result);
  if (typeof raw.id !== "string" || raw.status !== "completed" || raw.toolName !== "film_grain"
    || typeof raw.createdAt !== "string" || typeof result.kind !== "string"
    || typeof result.backendId !== "string" || typeof result.degraded !== "boolean"
    || !Array.isArray(result.warnings) || result.warnings.some((item) => typeof item !== "string")) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  return {
    id: raw.id,
    status: "completed",
    toolName: "film_grain",
    createdAt: raw.createdAt,
    result: {
      kind: result.kind,
      backendId: result.backendId,
      degraded: result.degraded,
      warnings: [...result.warnings] as string[],
      output: result.output
    }
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
    readonly sourceFrameId?: string;
    readonly width: number;
    readonly height: number;
  }, signal?: AbortSignal): Promise<NativeEffectTurn> => {
    const body = object(await jsonRequest("/api/effect-tools/v2/turns", {
      method: "POST",
      headers: csrfHeaders(),
      body: JSON.stringify({
        prompt: request.prompt,
        inputIds: request.sourceFrameId === undefined ? {} : { source_frame: request.sourceFrameId },
        render: {
          time: 0,
          fps: 30,
          width: request.width,
          height: request.height,
          seed: 20260814,
          quality: "preview"
        }
      }),
      ...(signal === undefined ? {} : { signal })
    }));
    return turn(body.turn);
  },
  frame: async (executionId: string, signal?: AbortSignal) => {
    let response: Response;
    try {
      response = await fetch(`/api/effect-tools/v2/executions/${encodeURIComponent(executionId)}/frame`, {
        credentials: "same-origin",
        ...(signal === undefined ? {} : { signal })
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new BrowserApiError(0, "SERVICE_UNREACHABLE", true);
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { code?: unknown; retryable?: unknown } };
      throw new BrowserApiError(
        response.status,
        typeof body.error?.code === "string" ? body.error.code : `HTTP_${response.status}`,
        body.error?.retryable === true
      );
    }
    const width = Number(response.headers.get("x-cmfx-frame-width"));
    const height = Number(response.headers.get("x-cmfx-frame-height"));
    const data = new Uint8ClampedArray(await response.arrayBuffer());
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
      || data.byteLength !== width * height * 4) {
      throw new BrowserApiError(500, "INVALID_RESPONSE", false);
    }
    return { width, height, data };
  }
};
