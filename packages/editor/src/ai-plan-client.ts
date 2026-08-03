import type {
  AiPlanningInputV1,
  PlannedAnimation,
  ProviderErrorCode,
  ProviderProgress
} from "@codemotion/ai-planner";

export type AiPlanStatus = "running" | "cancelling" | "completed" | "failed" | "cancelled";

export interface AiPlanTaskView {
  id: string;
  status: AiPlanStatus;
  phase: ProviderProgress["phase"] | "accepted" | "plan";
  progress?: ProviderProgress;
  events: readonly ProviderProgress[];
  createdAt: string;
  updatedAt: string;
  modalities: readonly ("text" | "image" | "audio" | "video")[];
  result?: PlannedAnimation;
  error?: {
    code: ProviderErrorCode | "planning";
    message: string;
    retryable: boolean;
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
  403: "当前账号缺少所需权限。",
  404: "任务不存在或不可访问。",
  409: "任务状态已发生变化，请刷新后重试。",
  413: "请求内容超过服务端限制。",
  415: "服务端不支持此内容类型。",
  422: "输入内容未通过安全校验。",
  429: "请求过于频繁，请稍后重试。"
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

function stateChangingInit(method: "POST", body?: BodyInit, contentType?: string): RequestInit {
  const csrf = csrfToken();
  if (!csrf) throw new AiPlanApiError("安全会话缺少 CSRF 凭据，请重新登录。", 403, "CSRF_MISSING", false);
  return {
    method,
    credentials: "same-origin",
    headers: {
      ...(contentType === undefined ? {} : { "content-type": contentType }),
      "X-CMFX-CSRF": csrf
    },
    ...(body === undefined ? {} : { body })
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const body = await response.json().catch(() => ({})) as T & ErrorEnvelope;
  if (!response.ok) {
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
  list: () => request<{ configured: boolean; tasks: AiPlanTaskView[] }>("/api/ai-plans"),
  get: (id: string) => request<{ task: AiPlanTaskView }>(`/api/ai-plans/${encodeURIComponent(id)}`),
  create: async (input: AiPlanningInputV1) => request<{ task: AiPlanTaskView }>(
    "/api/ai-plans",
    stateChangingInit("POST", JSON.stringify(input), "application/json")
  ),
  cancel: async (id: string) => request<{ task: AiPlanTaskView }>(
    `/api/ai-plans/${encodeURIComponent(id)}/cancel`,
    stateChangingInit("POST")
  )
};
