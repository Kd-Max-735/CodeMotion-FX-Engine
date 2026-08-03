import { csrfToken } from "./ai-plan-client.js";

export type ApplicationScope = "ai:plan" | "assets:read" | "assets:write";
export type AiAssetPurpose = "reference-image" | "reference-video" | "reference-audio" | "logo";
export type BrowserMediaKind = "image" | "svg" | "audio" | "video";

export interface BrowserSessionV1 {
  readonly authenticated: true;
  readonly principal: {
    readonly tenantId: string;
    readonly userId: string;
    readonly scopes: readonly ApplicationScope[];
    readonly expiresAt: number;
  };
}

export interface BrowserAssetSummaryV1 {
  readonly assetId: string;
  readonly displayName: string;
  readonly kind: BrowserMediaKind;
  readonly mime: string;
  readonly codec: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
  readonly durationSeconds?: number;
  readonly uploadedAt: string;
  readonly allowedPurposes: readonly AiAssetPurpose[];
}

export class BrowserApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryable: boolean) {
    super(messageFor(status));
  }
}

function messageFor(status: number): string {
  if (status === 401) return "登录已失效，请重新登录。";
  if (status === 403) return "当前账号缺少所需权限。";
  if (status === 409) return "请求状态冲突，请刷新后重试。";
  if (status === 413) return "文件超过服务端限制。";
  if (status === 415) return "不支持此文件格式。";
  if (status === 422) return "文件未通过安全验证。";
  if (status === 429) return "上传过于频繁，请稍后重试。";
  return "服务请求失败。";
}

async function browserRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const body = await response.json().catch(() => ({})) as { error?: { code?: unknown; retryable?: unknown } };
  if (!response.ok) {
    throw new BrowserApiError(
      response.status,
      typeof body.error?.code === "string" ? body.error.code : `HTTP_${response.status}`,
      body.error?.retryable === true
    );
  }
  return body;
}

function csrfHeaders(): HeadersInit {
  const token = csrfToken();
  if (!token) throw new BrowserApiError(403, "CSRF_MISSING", false);
  return { "X-CMFX-CSRF": token };
}

function session(value: unknown): BrowserSessionV1 {
  if (typeof value !== "object" || value === null) throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  const raw = value as { authenticated?: unknown; principal?: Record<string, unknown> };
  const principal = raw.principal;
  if (raw.authenticated !== true || !principal || typeof principal.tenantId !== "string"
    || typeof principal.userId !== "string" || typeof principal.expiresAt !== "number"
    || !Array.isArray(principal.scopes) || principal.scopes.some((item) => !["ai:plan", "assets:read", "assets:write"].includes(String(item)))) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  return {
    authenticated: true,
    principal: {
      tenantId: principal.tenantId,
      userId: principal.userId,
      scopes: [...principal.scopes] as ApplicationScope[],
      expiresAt: principal.expiresAt
    }
  };
}

function asset(value: unknown): BrowserAssetSummaryV1 {
  if (typeof value !== "object" || value === null) throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  const raw = value as Record<string, unknown>;
  const allowed = raw.allowedPurposes;
  if (typeof raw.assetId !== "string" || typeof raw.displayName !== "string"
    || !["image", "svg", "audio", "video"].includes(String(raw.kind))
    || typeof raw.mime !== "string" || typeof raw.codec !== "string" || typeof raw.bytes !== "number"
    || typeof raw.uploadedAt !== "string" || !Array.isArray(allowed)
    || allowed.some((item) => !["reference-image", "reference-video", "reference-audio", "logo"].includes(String(item)))) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  const result: BrowserAssetSummaryV1 = {
    assetId: raw.assetId,
    displayName: raw.displayName,
    kind: raw.kind as BrowserMediaKind,
    mime: raw.mime,
    codec: raw.codec,
    bytes: raw.bytes,
    uploadedAt: raw.uploadedAt,
    allowedPurposes: [...allowed] as AiAssetPurpose[]
  };
  return {
    ...result,
    ...(typeof raw.width === "number" ? { width: raw.width } : {}),
    ...(typeof raw.height === "number" ? { height: raw.height } : {}),
    ...(typeof raw.durationSeconds === "number" ? { durationSeconds: raw.durationSeconds } : {})
  };
}

export const sessionApi = {
  read: async (): Promise<BrowserSessionV1> => session(await browserRequest("/api/session")),
  startProductionLogin: (): void => { window.location.assign("/auth/login"); },
  startDevelopmentLogin: (): void => { window.location.assign("/auth/dev/login"); },
  finishDevelopmentLogin: async (code: string): Promise<void> => {
    await browserRequest("/auth/dev/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code })
    });
  },
  logout: async (): Promise<void> => {
    await browserRequest("/auth/logout", { method: "POST", headers: csrfHeaders() });
  }
};

export const mediaAssetApi = {
  list: async (options: { limit?: number; cursor?: string; kind?: BrowserMediaKind } = {}) => {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.cursor !== undefined) query.set("cursor", options.cursor);
    if (options.kind !== undefined) query.set("kind", options.kind);
    const raw = await browserRequest(`/api/media-assets${query.size ? `?${query}` : ""}`) as { items?: unknown; nextCursor?: unknown };
    if (!Array.isArray(raw.items) || !(raw.nextCursor === null || typeof raw.nextCursor === "string")) {
      throw new BrowserApiError(500, "INVALID_RESPONSE", false);
    }
    return { items: raw.items.map(asset), nextCursor: raw.nextCursor };
  },
  upload: async (file: File, purpose?: AiAssetPurpose, signal?: AbortSignal): Promise<BrowserAssetSummaryV1> => {
    const data = new FormData();
    data.append("file", file);
    if (purpose !== undefined) data.append("purpose", purpose);
    const raw = await browserRequest("/api/media-assets", {
      method: "POST",
      headers: csrfHeaders(),
      body: data,
      ...(signal === undefined ? {} : { signal })
    }) as { asset?: unknown };
    return asset(raw.asset);
  }
};
