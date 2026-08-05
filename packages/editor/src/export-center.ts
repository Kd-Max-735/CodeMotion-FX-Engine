import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import type {
  BrowserProjectEnvelopeV1,
  ExportCreateRequestV1,
  ExportSettingsV1,
  ExportTaskViewV1
} from "@codemotion/schema";
import type { MotionProject } from "@codemotion/core";
import { authenticatedPost } from "./ai-plan-client.js";

export type ExportFormat = ExportSettingsV1["format"];
export type ExportSettings = ExportSettingsV1;
export type ExportTaskView = ExportTaskViewV1;
export interface AssetView {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly valid?: boolean;
  readonly shortHash?: string;
}

export class ExportApiError extends Error {
  constructor(message: string, readonly status: number, readonly code = `HTTP_${status}`) {
    super(message);
  }
}

const ERROR_MESSAGES: Readonly<Record<number, string>> = {
  400: "导出请求合同无效。",
  401: "登录已失效，请重新登录。",
  403: "当前会话缺少导出权限。",
  404: "导出任务不存在或不可访问。",
  409: "导出任务状态冲突，请刷新后重试。",
  413: "工程超过导出限制。",
  422: "工程或导出设置未通过校验。",
  429: "导出请求过于频繁，请稍后重试。",
  503: "导出服务暂时不可用。"
};

export function estimateExportBytes(settings: Pick<ExportSettings, "format" | "width" | "height" | "fps" | "duration" | "audio">): number {
  const frames = Math.ceil(settings.fps * settings.duration);
  const ratio = settings.format === "png-sequence" ? 1.2 : settings.format === "gif" ? 0.35 : 0.045;
  return Math.ceil(settings.width * settings.height * frames * ratio + (settings.audio ? settings.duration * 24_000 : 0));
}

export function validateExportSettings(editableProject: BrowserProjectEnvelopeV1 | MotionProject, settings: ExportSettings): string[] {
  if (!("contract" in editableProject)) return ["Browser project envelope required."];
  const request: ExportCreateRequestV1 = { contract: "export-request/v1", editableProject, settings };
  const result = P0_BROWSER_PROJECT_AUTHORITY_V1.validateExportCreateRequest(request);
  return result.valid ? [] : [result.error.message];
}

export function projectMedia(editableProject: BrowserProjectEnvelopeV1 | MotionProject): AssetView[] {
  const project = "contract" in editableProject ? editableProject.project : editableProject;
  return project.assets.map((asset) => ({ id: asset.id, kind: asset.type, label: asset.id }));
}

function task(value: unknown): ExportTaskView {
  const result = P0_BROWSER_PROJECT_AUTHORITY_V1.validateExportTaskView(value);
  if (!result.valid) throw new ExportApiError("服务端返回了无效导出任务。", 500, "INVALID_RESPONSE");
  return result.value;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ExportApiError("导出服务未运行或网络不可达。", 0, "SERVICE_UNREACHABLE");
  }
  const body = await response.json().catch(() => ({})) as { error?: { code?: unknown } };
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("cmfx:unauthenticated"));
    throw new ExportApiError(
      ERROR_MESSAGES[response.status] ?? "导出服务请求失败。",
      response.status,
      typeof body.error?.code === "string" ? body.error.code : `HTTP_${response.status}`
    );
  }
  return body;
}

const CONTENT_TYPES: Readonly<Record<ExportFormat, string>> = {
  "png-sequence": "application/zip",
  gif: "image/gif",
  webm: "video/webm",
  mp4: "video/mp4"
};

export const exportApi = {
  list: async (signal?: AbortSignal) => {
    const body = await request("/api/editor-exports", signal === undefined ? {} : { signal }) as Record<string, unknown>;
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length !== 1
      || !Array.isArray(body.tasks)) throw new ExportApiError("服务端返回了无效任务列表。", 500, "INVALID_RESPONSE");
    return { tasks: body.tasks.map(task) };
  },
  get: async (id: string, signal?: AbortSignal) => {
    const body = await request(`/api/editor-exports/${encodeURIComponent(id)}`, signal === undefined ? {} : { signal }) as { task?: unknown };
    return { task: task(body.task) };
  },
  create: async (editableProject: BrowserProjectEnvelopeV1, settings: ExportSettings, signal?: AbortSignal) => {
    const input: ExportCreateRequestV1 = { contract: "export-request/v1", editableProject, settings };
    const checked = P0_BROWSER_PROJECT_AUTHORITY_V1.validateExportCreateRequest(input);
    if (!checked.valid) throw new ExportApiError(checked.error.message, 422, checked.error.code);
    const body = await request("/api/editor-exports", authenticatedPost(JSON.stringify(checked.value), "application/json", signal)) as { task?: unknown };
    return { task: task(body.task) };
  },
  cancel: async (id: string, signal?: AbortSignal) => {
    const body = await request(`/api/editor-exports/${encodeURIComponent(id)}/cancel`, authenticatedPost(undefined, undefined, signal)) as { task?: unknown };
    return { task: task(body.task) };
  },
  retry: async (id: string, signal?: AbortSignal) => {
    const body = await request(`/api/editor-exports/${encodeURIComponent(id)}/retry`, authenticatedPost(undefined, undefined, signal)) as { task?: unknown };
    return { task: task(body.task) };
  },
  download: async (current: ExportTaskView, signal?: AbortSignal) => {
    let response: Response;
    try {
      response = await fetch(`/api/editor-exports/${encodeURIComponent(current.id)}/download`, {
        credentials: "same-origin",
        ...(signal === undefined ? {} : { signal })
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new ExportApiError("下载服务未运行或网络不可达。", 0, "SERVICE_UNREACHABLE");
    }
    if (!response.ok) {
      if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event("cmfx:unauthenticated"));
      throw new ExportApiError(ERROR_MESSAGES[response.status] ?? "下载失败。", response.status);
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.toLowerCase();
    if (contentType !== CONTENT_TYPES[current.format]
      || response.headers.get("x-content-type-options")?.toLowerCase() !== "nosniff"
      || !response.headers.get("cache-control")?.toLowerCase().includes("no-store")) {
      throw new ExportApiError("下载响应未通过安全校验。", 500, "INVALID_RESPONSE");
    }
    const blob = await response.blob();
    const declared = Number(response.headers.get("content-length"));
    if (blob.size < 1 || (Number.isFinite(declared) && declared >= 0 && declared !== blob.size)) {
      throw new ExportApiError("下载文件长度无效。", 500, "INVALID_RESPONSE");
    }
    return { blob, name: current.downloadName ?? `codemotion.${current.format}` };
  }
};
