/// <reference types="vite/client" />

import { csrfToken } from "./browser-security.js";
import { validateApplicationScopes, type ApplicationScope } from "@codemotion/schema";

export type { ApplicationScope } from "@codemotion/schema";
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

export function hasApplicationScope(session: BrowserSessionV1 | undefined, scope: ApplicationScope): boolean {
  return session?.principal.scopes.includes(scope) === true;
}

export class BrowserApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryable: boolean) {
    super(messageFor(status, code));
  }
}

function messageFor(status: number, code: string): string {
  if (code === "SERVICE_UNREACHABLE") return "认证服务未运行，请启动或重新启动开发服务器。";
  if (code === "REQUEST_ORIGIN_REJECTED" || code === "LOGIN_ORIGIN_REJECTED") return "当前页面 Origin 被认证服务拒绝。";
  if (status === 401) return "登录已失效，请重新登录。";
  if (status === 403) return "当前账号缺少所需权限。";
  if (code === "ASSET_IN_USE") return "该素材正被当前工程或运行中的任务使用，暂时不能删除。";
  if (status === 409) return "请求状态冲突，请刷新后重试。";
  if (status === 413) return "文件超过服务端限制。";
  if (status === 415) return "不支持此文件格式。";
  if (status === 422) return "文件未通过安全验证。";
  if (status === 429) return "上传过于频繁，请稍后重试。";
  if (status === 500) return "服务响应不可用，请重新登录。";
  if (status === 503) return "服务暂时不可用，请稍后重试。";
  return "服务请求失败。";
}

async function browserRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new BrowserApiError(0, "SERVICE_UNREACHABLE", true);
  }
  const body = await response.json().catch(() => ({})) as { error?: { code?: unknown; retryable?: unknown } };
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined" && path !== "/api/session") {
      window.dispatchEvent(new Event("cmfx:unauthenticated"));
    }
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
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.keys(value).length !== 2 || !Object.hasOwn(value, "authenticated") || !Object.hasOwn(value, "principal")) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  const raw = value as { authenticated?: unknown; principal?: Record<string, unknown> };
  const principal = raw.principal;
  if (raw.authenticated !== true || !principal || Array.isArray(principal)
    || Object.keys(principal).length !== 4
    || !["tenantId", "userId", "scopes", "expiresAt"].every((key) => Object.hasOwn(principal, key))
    || typeof principal.tenantId !== "string" || principal.tenantId.length < 1 || principal.tenantId.length > 256
    || typeof principal.userId !== "string" || principal.userId.length < 1 || principal.userId.length > 256
    || typeof principal.expiresAt !== "number" || !Number.isInteger(principal.expiresAt)
    || !validateApplicationScopes(principal.scopes)) {
    throw new BrowserApiError(500, "INVALID_RESPONSE", false);
  }
  return {
    authenticated: true,
    principal: {
      tenantId: principal.tenantId,
      userId: principal.userId,
      scopes: [...principal.scopes],
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

export function isLocalDevelopmentClient(): boolean {
  return import.meta.env.DEV && typeof window !== "undefined" && window.location.origin === "http://127.0.0.1:4174";
}

let developmentAutoSessionPromise: Promise<void> | undefined;

async function readSession(signal?: AbortSignal): Promise<BrowserSessionV1> {
  return session(await browserRequest(
    "/api/session",
    signal === undefined ? {} : { signal }
  ));
}

export const sessionApi = {
  read: readSession,
  readWithDevelopmentFallback: async (signal?: AbortSignal): Promise<BrowserSessionV1> => {
    try { return await readSession(signal); }
    catch (error) {
      if (!(error instanceof BrowserApiError) || error.status !== 401 || !isLocalDevelopmentClient()) throw error;
      if (developmentAutoSessionPromise === undefined) {
        developmentAutoSessionPromise = browserRequest("/auth/dev/auto-session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
          ...(signal === undefined ? {} : { signal })
        }).then(() => undefined).catch((cause) => {
          developmentAutoSessionPromise = undefined;
          throw cause;
        });
      }
      await developmentAutoSessionPromise;
      return readSession(signal);
    }
  },
  startProductionLogin: (): void => { window.location.assign("/auth/login"); },
  logout: async (): Promise<void> => {
    await browserRequest("/auth/logout", { method: "POST", headers: csrfHeaders() });
    developmentAutoSessionPromise = undefined;
  }
};

export const mediaAssetApi = {
  list: async (options: { limit?: number; cursor?: string; kind?: BrowserMediaKind } = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams();
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.cursor !== undefined) query.set("cursor", options.cursor);
    if (options.kind !== undefined) query.set("kind", options.kind);
    const raw = await browserRequest(
      `/api/media-assets${query.size ? `?${query}` : ""}`,
      signal === undefined ? {} : { signal }
    ) as { items?: unknown; nextCursor?: unknown };
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
  },
  delete: async (assetId: string, signal?: AbortSignal): Promise<void> => {
    await browserRequest(`/api/media-assets/${encodeURIComponent(assetId)}`, {
      method: "DELETE",
      headers: csrfHeaders(),
      ...(signal === undefined ? {} : { signal })
    });
  }
};
