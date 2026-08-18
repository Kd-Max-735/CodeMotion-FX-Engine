/// <reference types="vite/client" />

import { csrfToken } from "./browser-security.js";
import { BrowserApiError } from "./media-asset-client.js";

export type VideoGenerationMode = "fast" | "standard" | "fine";

export interface GpuTelemetryView {
  readonly available: boolean;
  readonly name?: string;
  readonly memoryUsedMiB?: number;
  readonly memoryTotalMiB?: number;
  readonly utilizationPercent?: number;
  readonly peakMemoryUsedMiB?: number;
  readonly sampledAt?: string;
  readonly message?: string;
}

export interface NativeEffectToolView {
  readonly toolName: "film_grain";
  readonly displayName: string;
  readonly category: string;
  readonly configured: boolean;
}

export interface SelectedEffectInputRequirementView {
  readonly name: string;
  readonly kind: "image" | "video" | "audio" | "mask" | "lut" | "depth-map" | "font" | "model" | "texture" | "data";
  readonly required: boolean;
  readonly cardinality: "one" | "many";
  readonly description: string;
  readonly acceptedMimeTypes: readonly string[];
  readonly acceptsUploadedImage: boolean;
  readonly acceptsUploadedVideo?: boolean;
}

export interface SelectedEffectToolView {
  readonly toolName: string;
  readonly displayName: string;
  readonly category: string;
  readonly configured: boolean;
  readonly inputRequirements: readonly SelectedEffectInputRequirementView[];
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
  readonly source: { readonly kind: "image"; readonly assetId: string };
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
  readonly gpu: GpuTelemetryView;
  readonly failure?: { readonly code: "VIDEO_RENDER_FAILED"; readonly message: string };
}

export interface NativeExecutionInputView {
  readonly source_image: string;
  readonly effectParams: Readonly<Record<string, unknown>>;
  readonly output: {
    readonly durationSeconds: number;
    readonly generationMode: VideoGenerationMode;
    readonly fps: number;
    readonly format: "mp4";
  };
}

export interface SelectedExecutionView {
  readonly id: string;
  readonly status: NativeExecutionView["status"];
  readonly toolName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source?: { readonly kind: "image"; readonly assetId: string };
  readonly video: NativeExecutionView["video"];
  readonly gpu: GpuTelemetryView;
  readonly failure?: NativeExecutionView["failure"];
}

export interface SelectedExecutionInputView {
  readonly authorizedInputs: readonly Readonly<{
    name: string;
    kind: SelectedEffectInputRequirementView["kind"];
    count: number;
  }>[];
  readonly effectParams: Readonly<Record<string, unknown>>;
  readonly output: {
    readonly durationSeconds: number;
    readonly generationMode: VideoGenerationMode;
    readonly fps: number;
    readonly format: "mp4";
  };
}

export interface SelectedToolCallView {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  };
}

export type SelectedEffectTurn = Readonly<{
  kind: "message";
  tool: Pick<SelectedEffectToolView, "toolName" | "displayName" | "category">;
  reasoningContent: string;
  content: string;
}> | Readonly<{
  kind: "tool_call";
  tool: Pick<SelectedEffectToolView, "toolName" | "displayName" | "category">;
  reasoningContent: string;
  content: string;
  toolCall: SelectedToolCallView;
  executionInput: SelectedExecutionInputView;
  execution: SelectedExecutionView;
}>;

export class EffectToolApiError extends BrowserApiError {
  constructor(
    status: number,
    code: string,
    retryable: boolean,
    readonly requirements: readonly SelectedEffectInputRequirementView[] = []
  ) {
    super(status, code, retryable);
  }
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
  executionInput: NativeExecutionInputView;
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
  const body = await response.json().catch(() => ({})) as {
    error?: { code?: unknown; retryable?: unknown; requirements?: unknown };
  };
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("cmfx:unauthenticated"));
    const requirements = Array.isArray(body.error?.requirements)
      ? body.error.requirements.map(inputRequirement) : [];
    throw new EffectToolApiError(
      response.status,
      typeof body.error?.code === "string" ? body.error.code : `HTTP_${response.status}`,
      body.error?.retryable === true,
      requirements
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

const TOOL_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const VIDEO_GENERATION_MODES = new Set<VideoGenerationMode>(["fast", "standard", "fine"]);

function gpuTelemetry(value: unknown): GpuTelemetryView {
  const raw = object(value);
  if (typeof raw.available !== "boolean"
    || (raw.sampledAt !== undefined && typeof raw.sampledAt !== "string")
    || (raw.message !== undefined && typeof raw.message !== "string")) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  if (!raw.available) {
    return {
      available: false,
      ...(raw.sampledAt === undefined ? {} : { sampledAt: raw.sampledAt as string }),
      ...(raw.message === undefined ? {} : { message: raw.message as string })
    };
  }
  if (typeof raw.name !== "string" || raw.name.length === 0
    || ![raw.memoryUsedMiB, raw.memoryTotalMiB, raw.utilizationPercent, raw.peakMemoryUsedMiB]
      .every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0)
    || typeof raw.sampledAt !== "string") {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  return {
    available: true,
    name: raw.name,
    memoryUsedMiB: raw.memoryUsedMiB as number,
    memoryTotalMiB: raw.memoryTotalMiB as number,
    utilizationPercent: raw.utilizationPercent as number,
    peakMemoryUsedMiB: raw.peakMemoryUsedMiB as number,
    sampledAt: raw.sampledAt
  };
}
const INPUT_KINDS = new Set([
  "image", "video", "audio", "mask", "lut", "depth-map", "font", "model", "texture", "data"
]);

function inputRequirement(value: unknown): SelectedEffectInputRequirementView {
  const item = object(value);
  if (typeof item.name !== "string" || !TOOL_NAME.test(item.name)
    || typeof item.kind !== "string" || !INPUT_KINDS.has(item.kind)
    || typeof item.required !== "boolean" || (item.cardinality !== "one" && item.cardinality !== "many")
    || typeof item.description !== "string" || !Array.isArray(item.acceptedMimeTypes)
    || item.acceptedMimeTypes.some((mime) => typeof mime !== "string")
    || typeof item.acceptsUploadedImage !== "boolean"
    || (item.acceptsUploadedVideo !== undefined && typeof item.acceptsUploadedVideo !== "boolean")) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  return Object.freeze({
    name: item.name,
    kind: item.kind as SelectedEffectInputRequirementView["kind"],
    required: item.required,
    cardinality: item.cardinality,
    description: item.description,
    acceptedMimeTypes: Object.freeze([...(item.acceptedMimeTypes as string[])]),
    acceptsUploadedImage: item.acceptsUploadedImage,
    acceptsUploadedVideo: item.acceptsUploadedVideo === true
  });
}

function selectedTool(value: unknown): SelectedEffectToolView {
  const raw = object(value);
  if (typeof raw.toolName !== "string" || !TOOL_NAME.test(raw.toolName)
    || typeof raw.displayName !== "string" || raw.displayName.trim().length === 0
    || typeof raw.category !== "string" || typeof raw.configured !== "boolean"
    || !Array.isArray(raw.inputRequirements)) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  const inputRequirements = raw.inputRequirements.map(inputRequirement);
  return Object.freeze({
    toolName: raw.toolName,
    displayName: raw.displayName,
    category: raw.category,
    configured: raw.configured,
    inputRequirements: Object.freeze(inputRequirements)
  });
}

function execution(value: unknown): NativeExecutionView {
  const raw = object(value);
  const source = object(raw.source);
  const video = object(raw.video);
  const gpu = gpuTelemetry(raw.gpu);
  const status = raw.status;
  if (typeof raw.id !== "string" || !["queued", "running", "completed", "failed"].includes(String(status))
    || raw.toolName !== "film_grain" || typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string"
    || source.kind !== "image" || typeof source.assetId !== "string"
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
    source: { kind: "image", assetId: source.assetId as string },
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
    gpu,
    ...(failure === undefined ? {} : {
      failure: { code: "VIDEO_RENDER_FAILED", message: failure.message as string }
    })
  };
}

function selectedExecution(value: unknown, expectedToolName?: string): SelectedExecutionView {
  const raw = object(value);
  const video = object(raw.video);
  const gpu = gpuTelemetry(raw.gpu);
  const status = raw.status;
  if (typeof raw.id !== "string" || !["queued", "running", "completed", "failed"].includes(String(status))
    || typeof raw.toolName !== "string" || !TOOL_NAME.test(raw.toolName)
    || expectedToolName !== undefined && raw.toolName !== expectedToolName
    || typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string"
    || video.format !== "mp4" || video.mime !== "video/mp4"
    || ![video.width, video.height, video.fps, video.durationSeconds, video.frameCount,
      video.completedFrames, video.progress].every((item) => typeof item === "number" && Number.isFinite(item))
    || typeof video.audio !== "boolean"
    || (video.bytes !== undefined && typeof video.bytes !== "number")
    || (video.downloadName !== undefined && typeof video.downloadName !== "string")) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  const source = raw.source === undefined ? undefined : object(raw.source);
  if (source !== undefined && (source.kind !== "image" || typeof source.assetId !== "string")) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  const failure = raw.failure === undefined ? undefined : object(raw.failure);
  if (failure !== undefined && (failure.code !== "VIDEO_RENDER_FAILED" || typeof failure.message !== "string")) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  return {
    id: raw.id,
    status: status as SelectedExecutionView["status"],
    toolName: raw.toolName,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    ...(source === undefined ? {} : { source: { kind: "image" as const, assetId: source.assetId as string } }),
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
    gpu,
    ...(failure === undefined ? {} : {
      failure: { code: "VIDEO_RENDER_FAILED" as const, message: failure.message as string }
    })
  };
}

function selectedIdentity(
  value: unknown,
  expectedToolName: string
): Pick<SelectedEffectToolView, "toolName" | "displayName" | "category"> {
  const raw = object(value);
  if (raw.toolName !== expectedToolName || typeof raw.displayName !== "string"
    || raw.displayName.trim().length === 0 || typeof raw.category !== "string") {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  return Object.freeze({
    toolName: expectedToolName,
    displayName: raw.displayName,
    category: raw.category
  });
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
  const executionInput = object(raw.executionInput);
  const effectParams = object(executionInput.effectParams);
  const output = object(executionInput.output);
  if (typeof call.id !== "string" || call.type !== "function" || fn.name !== "film_grain") {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  if (typeof executionInput.source_image !== "string" || output.format !== "mp4"
    || typeof output.durationSeconds !== "number" || !Number.isFinite(output.durationSeconds)
    || typeof output.generationMode !== "string" || !VIDEO_GENERATION_MODES.has(output.generationMode as VideoGenerationMode)
    || typeof output.fps !== "number" || !Number.isFinite(output.fps)) {
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
    executionInput: {
      source_image: executionInput.source_image,
      effectParams: structuredClone(effectParams),
      output: {
        durationSeconds: output.durationSeconds,
        generationMode: output.generationMode as VideoGenerationMode,
        fps: output.fps,
        format: "mp4"
      }
    },
    execution: execution(raw.execution)
  };
}

function selectedTurn(value: unknown, expectedToolName: string): SelectedEffectTurn {
  const raw = object(value);
  if (typeof raw.reasoningContent !== "string" || typeof raw.content !== "string") {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  const identity = selectedIdentity(raw.tool, expectedToolName);
  if (raw.kind === "message") {
    return { kind: "message", tool: identity, reasoningContent: raw.reasoningContent, content: raw.content };
  }
  if (raw.kind !== "tool_call") throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  const call = object(raw.toolCall);
  const fn = object(call.function);
  const args = object(fn.arguments);
  const executionInput = object(raw.executionInput);
  const effectParams = object(executionInput.effectParams);
  const output = object(executionInput.output);
  if (!Array.isArray(executionInput.authorizedInputs)
    || typeof call.id !== "string" || call.type !== "function" || fn.name !== expectedToolName
    || output.format !== "mp4" || typeof output.durationSeconds !== "number"
    || !Number.isFinite(output.durationSeconds)
    || typeof output.generationMode !== "string" || !VIDEO_GENERATION_MODES.has(output.generationMode as VideoGenerationMode)
    || typeof output.fps !== "number" || !Number.isFinite(output.fps)) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  const authorizedInputs = executionInput.authorizedInputs.map((value) => {
    const item = object(value);
    if (typeof item.name !== "string" || typeof item.kind !== "string" || !INPUT_KINDS.has(item.kind)
      || typeof item.count !== "number" || !Number.isInteger(item.count) || item.count < 1) {
      throw new BrowserApiError(500, "INVALID_RESPONSE", false);
    }
    return { name: item.name, kind: item.kind as SelectedEffectInputRequirementView["kind"], count: item.count };
  });
  return {
    kind: "tool_call",
    tool: identity,
    reasoningContent: raw.reasoningContent,
    content: raw.content,
    toolCall: {
      id: call.id,
      type: "function",
      function: { name: expectedToolName, arguments: structuredClone(args) }
    },
    executionInput: {
      authorizedInputs: Object.freeze(authorizedInputs),
      effectParams: structuredClone(effectParams),
      output: {
        durationSeconds: output.durationSeconds,
        generationMode: output.generationMode as VideoGenerationMode,
        fps: output.fps,
        format: "mp4"
      }
    },
    execution: selectedExecution(raw.execution, expectedToolName)
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
    readonly sourceImageId?: string;
  }, signal?: AbortSignal): Promise<NativeEffectTurn> => {
    const body = object(await jsonRequest("/api/effect-tools/v2/turns", {
      method: "POST",
      headers: csrfHeaders(),
      body: JSON.stringify({
        prompt: request.prompt,
        inputIds: request.sourceImageId === undefined ? {} : { source_image: request.sourceImageId }
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

export const selectedEffectToolApi = {
  catalog: async (signal?: AbortSignal): Promise<readonly SelectedEffectToolView[]> => {
    const body = object(await jsonRequest("/api/effect-tools/v3", signal === undefined ? {} : { signal }));
    if (!Array.isArray(body.tools) || body.tools.length !== 120 || body.count !== 120) {
      throw new BrowserApiError(500, "INVALID_RESPONSE", false);
    }
    const tools = body.tools.map(selectedTool);
    if (new Set(tools.map((item) => item.toolName)).size !== tools.length) {
      throw new BrowserApiError(500, "INVALID_RESPONSE", false);
    }
    return Object.freeze(tools);
  },
  turn: async (request: {
    readonly toolName: string;
    readonly prompt: string;
    readonly inputIds: Readonly<Record<string, string | readonly string[]>>;
  }, signal?: AbortSignal): Promise<SelectedEffectTurn> => {
    if (!TOOL_NAME.test(request.toolName)) throw new BrowserApiError(400, "INVALID_TOOL_NAME", false);
    const body = object(await jsonRequest("/api/effect-tools/v3/turns", {
      method: "POST",
      headers: csrfHeaders(),
      body: JSON.stringify({
        toolName: request.toolName,
        prompt: request.prompt,
        inputIds: request.inputIds
      }),
      ...(signal === undefined ? {} : { signal })
    }));
    return selectedTurn(body.turn, request.toolName);
  },
  execution: async (
    executionId: string,
    expectedToolName: string,
    signal?: AbortSignal
  ): Promise<SelectedExecutionView> => {
    if (!TOOL_NAME.test(expectedToolName)) throw new BrowserApiError(400, "INVALID_TOOL_NAME", false);
    const body = object(await jsonRequest(
      `/api/effect-tools/v3/executions/${encodeURIComponent(executionId)}`,
      signal === undefined ? {} : { signal }
    ));
    return selectedExecution(body.execution, expectedToolName);
  },
  videoUrl: (executionId: string): string => `/api/effect-tools/v3/executions/${encodeURIComponent(executionId)}/video`,
  downloadUrl: (executionId: string): string => `/api/effect-tools/v3/executions/${encodeURIComponent(executionId)}/download`
};
