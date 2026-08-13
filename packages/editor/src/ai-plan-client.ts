import type {
  AiPlanningInputV1,
  ProviderErrorCode,
  ProviderFailureReason,
  ProviderProgress
} from "@codemotion/ai-planner";
import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import type { AiPlanCompletedResultV2 } from "@codemotion/schema";

export type AiPlanStatus = "running" | "cancelling" | "completed" | "failed" | "cancelled";

export interface BrowserAiPlanTaskView {
  readonly id: string;
  readonly status: AiPlanStatus;
  readonly phase: ProviderProgress["phase"] | "accepted" | "plan";
  readonly progress?: ProviderProgress;
  readonly events: readonly ProviderProgress[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly modalities: readonly ("text" | "image" | "audio" | "video")[];
  readonly result?: AiPlanCompletedResultV2;
  readonly error?: {
    readonly code: ProviderErrorCode | "planning" | "media_preview_failed";
    readonly message: string;
    readonly retryable: boolean;
    readonly problemCode?: ProviderFailureReason;
  };
}

export const AI_CANVAS_RATIOS = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350]
} as const;

export interface AiPlanningFormValue {
  readonly prompt: string;
  readonly selectedEffectId?: AiPlanningInputV1["selectedEffectId"];
  readonly assets: AiPlanningInputV1["assets"];
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationSeconds: number;
  readonly style: string;
  readonly colors: readonly string[];
  readonly tone: string;
  readonly requiredText: string;
  readonly forbiddenContent: string;
}

function splitValues(value: string, limit = 16): string[] {
  return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean).slice(0, limit);
}

export function buildAiPlanningInput(value: AiPlanningFormValue): AiPlanningInputV1 {
  return {
    contract: "ai-task/v1",
    prompt: value.prompt,
    ...(value.selectedEffectId === undefined ? {} : { selectedEffectId: value.selectedEffectId }),
    assets: value.assets,
    canvas: { width: value.width, height: value.height, fps: value.fps },
    durationSeconds: value.durationSeconds,
    style: splitValues(value.style),
    brand: {
      colors: [...value.colors],
      tone: splitValues(value.tone),
      requiredText: splitValues(value.requiredText),
      forbiddenContent: splitValues(value.forbiddenContent),
      logoAssetIds: value.assets.filter((item) => item.purpose === "logo").map((item) => item.assetId)
    }
  };
}

interface ErrorEnvelope {
  readonly error?: { readonly code?: unknown; readonly retryable?: unknown };
}

const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  400: "请求未通过服务端校验。",
  401: "登录已失效，请重新登录。",
  403: "当前会话缺少所需权限。",
  404: "任务不存在或不可访问。",
  409: "任务状态已变化，请刷新后重试。",
  413: "请求内容超过服务端限制。",
  415: "服务端不支持此内容类型。",
  422: "输入内容未通过安全校验。",
  429: "请求过于频繁，请稍后重试。",
  503: "服务暂时不可用。"
};

export class AiPlanApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly retryable: boolean
  ) { super(message); }
}

function cookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  for (const part of document.cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1)); }
    catch { return undefined; }
  }
  return undefined;
}

export function csrfToken(): string | undefined {
  return cookie("__Host-cmfx_csrf") ?? cookie("cmfx_dev_csrf");
}

export function authenticatedPost(body?: BodyInit, contentType?: string, signal?: AbortSignal): RequestInit {
  const csrf = csrfToken();
  if (!csrf) throw new AiPlanApiError("安全会话缺少 CSRF 凭据，请重新登录。", 403, "CSRF_MISSING", false);
  return {
    method: "POST",
    credentials: "same-origin",
    headers: {
      ...(contentType === undefined ? {} : { "content-type": contentType }),
      "X-CMFX-CSRF": csrf
    },
    ...(body === undefined ? {} : { body }),
    ...(signal === undefined ? {} : { signal })
  };
}

const TASK_KEYS = new Set(["id", "status", "phase", "progress", "events", "createdAt", "updatedAt", "modalities", "result", "error"]);
const STATUSES = new Set<AiPlanStatus>(["running", "cancelling", "completed", "failed", "cancelled"]);
const PHASES = new Set<BrowserAiPlanTaskView["phase"]>(["accepted", "validate", "upload", "process", "infer", "cleanup", "plan"]);
const MODALITIES = new Set<BrowserAiPlanTaskView["modalities"][number]>(["text", "image", "audio", "video"]);
const ERROR_CODES = new Set<ProviderErrorCode | "planning" | "media_preview_failed">([
  "cancelled", "timeout", "rate_limited", "invalid_input", "authentication", "unsupported",
  "provider_unavailable", "provider_response", "security", "planning", "media_preview_failed"
]);
const PROBLEM_CODES = new Set<ProviderFailureReason>([
  "NO_OUTPUT", "INVALID_JSON", "SCHEMA_INVALID", "PLANNING_CONSTRAINT", "SHOT_RANGE",
  "EFFECT_ID_INVALID", "TEXT_REQUIRED", "ASSET_COUNT_INCOMPATIBLE", "MEDIA_PREVIEW_FAILED",
  "ARK_UNAVAILABLE", "ASSET_BINDING", "RESPONSE_ENVELOPE", "MODEL_MISMATCH"
]);

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => keys.has(key));
}

function progress(value: unknown): value is ProviderProgress {
  if (!record(value) || !exactKeys(value, new Set(["phase", "localAssetId", "loaded", "total"]))) return false;
  return PHASES.has(value.phase as BrowserAiPlanTaskView["phase"])
    && value.phase !== "accepted" && value.phase !== "plan"
    && (value.localAssetId === undefined || typeof value.localAssetId === "string")
    && (value.loaded === undefined || typeof value.loaded === "number" && Number.isFinite(value.loaded) && value.loaded >= 0)
    && (value.total === undefined || typeof value.total === "number" && Number.isFinite(value.total) && value.total >= 0);
}

function safeError(value: unknown): value is NonNullable<BrowserAiPlanTaskView["error"]> {
  return record(value) && exactKeys(value, new Set(["code", "message", "retryable", "problemCode"]))
    && ERROR_CODES.has(value.code as ProviderErrorCode | "planning" | "media_preview_failed")
    && typeof value.message === "string" && value.message.length > 0 && value.message.length <= 512
    && typeof value.retryable === "boolean"
    && (value.problemCode === undefined || PROBLEM_CODES.has(value.problemCode as ProviderFailureReason));
}

function invalidTask(): never {
  throw new AiPlanApiError("服务端返回了无效任务。", 500, "INVALID_RESPONSE", false);
}

function validateTask(value: unknown): BrowserAiPlanTaskView {
  if (!record(value) || !exactKeys(value, TASK_KEYS)) {
    throw new AiPlanApiError("服务端返回了无效任务。", 500, "INVALID_RESPONSE", false);
  }
  if (typeof value.id !== "string" || value.id.length < 1 || value.id.length > 256
    || !STATUSES.has(value.status as AiPlanStatus)
    || !PHASES.has(value.phase as BrowserAiPlanTaskView["phase"])
    || !Array.isArray(value.events) || value.events.length > 100 || !value.events.every(progress)
    || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
    || !Array.isArray(value.modalities) || !value.modalities.every((item) => MODALITIES.has(item as never))
    || value.progress !== undefined && !progress(value.progress)
    || value.error !== undefined && !safeError(value.error)) invalidTask();

  const status = value.status as AiPlanStatus;
  if (status === "completed") {
    if (value.error !== undefined) invalidTask();
    const result = P0_BROWSER_PROJECT_AUTHORITY_V1.validateAiPlanCompletedResult(value.result);
    if (!result.valid) throw new AiPlanApiError("服务端返回了无效规划结果。", 500, "INVALID_RESPONSE", false);
    return { ...value, status, result: result.value } as unknown as BrowserAiPlanTaskView;
  }
  if (value.result !== undefined) {
    throw new AiPlanApiError("服务端返回了无效规划结果。", 500, "INVALID_RESPONSE", false);
  }
  if ((status === "running" || status === "cancelling") && value.error !== undefined) invalidTask();
  if ((status === "failed" || status === "cancelled") && value.error === undefined) invalidTask();
  return value as unknown as BrowserAiPlanTaskView;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AiPlanApiError("AI 服务未运行或网络不可达。", 0, "SERVICE_UNREACHABLE", true);
  }
  const body = await response.json().catch(() => ({})) as T & ErrorEnvelope;
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("cmfx:unauthenticated"));
    const code = typeof body.error?.code === "string" ? body.error.code : `HTTP_${response.status}`;
    throw new AiPlanApiError(
      STATUS_MESSAGES[response.status] ?? "AI 服务请求失败。",
      response.status,
      code,
      body.error?.retryable === true
    );
  }
  return body;
}

export const aiPlanApi = {
  list: async (signal?: AbortSignal) => {
    const body = await request<unknown>("/api/ai-plans", signal === undefined ? {} : { signal });
    if (!record(body) || Object.keys(body).length !== 2 || typeof body.configured !== "boolean" || !Array.isArray(body.tasks)) invalidTask();
    return { configured: body.configured, tasks: body.tasks.map(validateTask) };
  },
  get: async (id: string, signal?: AbortSignal) => {
    const body = await request<unknown>(`/api/ai-plans/${encodeURIComponent(id)}`, signal === undefined ? {} : { signal });
    if (!record(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "task")) invalidTask();
    return { task: validateTask(body.task) };
  },
  create: async (input: AiPlanningInputV1, signal?: AbortSignal) => {
    const body = await request<unknown>("/api/ai-plans", authenticatedPost(JSON.stringify(input), "application/json", signal));
    if (!record(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "task")) invalidTask();
    return { task: validateTask(body.task) };
  },
  cancel: async (id: string, signal?: AbortSignal) => {
    const body = await request<unknown>(`/api/ai-plans/${encodeURIComponent(id)}/cancel`, authenticatedPost(undefined, undefined, signal));
    if (!record(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "task")) invalidTask();
    return { task: validateTask(body.task) };
  }
};
