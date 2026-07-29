import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { MotionProject } from "@codemotion/core";
import { loadProject } from "@codemotion/schema";
import {
  ProviderError,
  VolcengineArkProvider,
  planAnimation,
  type LocalResourceInput,
  type ModelProvider,
  type ProviderErrorCode,
  type ProviderProgress
} from "@codemotion/ai-planner";
import type { AiPlanSettings, AiPlanTaskView } from "./ai-plan-client.js";

interface InternalTask {
  view: AiPlanTaskView;
  controller: AbortController;
  settings: AiPlanSettings;
  project: MotionProject;
  resources: readonly LocalResourceInput[];
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;

const safeErrors: Record<ProviderErrorCode | "planning", string> = {
  cancelled: "分析已取消。",
  timeout: "分析超过设定时限。",
  rate_limited: "服务请求频率已达上限，请稍后重试。",
  invalid_input: "输入格式、大小、时长或素材完整性校验失败。",
  authentication: "服务端 Provider 认证失败。",
  unsupported: "所选输入格式不受支持。",
  provider_unavailable: "理解服务暂时不可用。",
  provider_response: "模型返回未通过结构化校验。",
  security: "模型响应未通过安全校验。",
  planning: "Storyboard 或 DSL 未通过静态安全校验。"
};

function validateSettings(project: MotionProject, settings: AiPlanSettings): void {
  if (settings.prompt.length > 20_000) throw new Error("文本不能超过 20000 字符。");
  if (settings.assetIds.length === 0 && settings.prompt.trim().length === 0) throw new Error("请输入文本或选择至少一个素材。");
  if (settings.assetIds.length > 8 || new Set(settings.assetIds).size !== settings.assetIds.length) throw new Error("素材必须唯一且不超过 8 个。");
  if (!Number.isInteger(settings.width) || settings.width < 2 || !Number.isInteger(settings.height) || settings.height < 2) throw new Error("画布尺寸必须是大于 1 的整数。");
  if (!Number.isInteger(settings.fps) || settings.fps < 1 || settings.fps > 120) throw new Error("帧率必须是 1 至 120 的整数。");
  if (!Number.isFinite(settings.duration) || settings.duration < 0.5 || settings.duration > 60) throw new Error("规划时长必须在 0.5 至 60 秒之间。");
  if (!Number.isInteger(settings.timeoutMs) || settings.timeoutMs < 10_000 || settings.timeoutMs > 300_000) throw new Error("超时必须在 10 至 300 秒之间。");
  for (const id of settings.assetIds) {
    const asset = project.assets.find((item) => item.id === id);
    if (!asset || (asset.type !== "image" && asset.type !== "audio" && asset.type !== "video")) throw new Error("选择的素材不属于当前工程。");
    if (asset.metadata.decodeVerified !== true) throw new Error("选择的素材未通过 Stage 6 解码验证。");
  }
}

function resourceInputs(project: MotionProject, ids: readonly string[], storageDirectory: string): LocalResourceInput[] {
  return ids.map((id) => {
    const asset = project.assets.find((item) => item.id === id)!;
    const modality = asset.type as "image" | "audio" | "video";
    return {
      modality,
      localAssetId: id,
      asset,
      storageDirectory,
      ...(modality === "video" ? { videoFps: 0.3 } : {})
    };
  });
}

function errorView(error: unknown): NonNullable<AiPlanTaskView["error"]> {
  if (error instanceof ProviderError) {
    return { code: error.code, message: safeErrors[error.code], retryable: error.retryable };
  }
  const issueCodes = error instanceof Error
    ? /^AI planning static validation failed: ([a-z, ]+)$/.exec(error.message)?.[1]
    : undefined;
  return {
    code: "planning",
    message: issueCodes ? `${safeErrors.planning} 问题代码：${issueCodes}。` : safeErrors.planning,
    retryable: false
  };
}

export class AiPlanService {
  private readonly tasks = new Map<string, InternalTask>();

  constructor(private readonly provider: ModelProvider | undefined, private readonly mediaRoot: string) {}

  get configured(): boolean { return this.provider !== undefined; }

  list(): AiPlanTaskView[] {
    return [...this.tasks.values()].map(({ view }) => structuredClone(view)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  create(rawProject: unknown, settings: AiPlanSettings): AiPlanTaskView {
    if (!this.provider) throw new Error("服务端 Provider 未配置。");
    const project = loadProject(JSON.stringify(rawProject));
    validateSettings(project, settings);
    const resources = resourceInputs(project, settings.assetIds, this.mediaRoot);
    const id = randomUUID();
    const now = new Date().toISOString();
    const modalities = [
      ...(settings.prompt.trim() ? ["text" as const] : []),
      ...resources.map((item) => item.modality)
    ];
    const task: InternalTask = {
      settings: structuredClone(settings),
      project,
      resources,
      controller: new AbortController(),
      view: {
        id,
        status: "running",
        phase: "accepted",
        events: [],
        createdAt: now,
        updatedAt: now,
        modalities
      }
    };
    this.tasks.set(id, task);
    void this.run(task);
    return structuredClone(task.view);
  }

  cancel(id: string): AiPlanTaskView {
    const task = this.tasks.get(id);
    if (!task) throw new Error("分析任务不存在。");
    if (task.view.status !== "running") throw new Error("只有运行中的任务可以取消。");
    task.view = { ...task.view, status: "cancelling", updatedAt: new Date().toISOString() };
    task.controller.abort(new ProviderError("cancelled", "Provider request was cancelled."));
    return structuredClone(task.view);
  }

  private async run(task: InternalTask): Promise<void> {
    const progress = (event: ProviderProgress): void => {
      task.view = {
        ...task.view,
        phase: event.phase,
        progress: event,
        events: [...task.view.events, event].slice(-100),
        updatedAt: new Date().toISOString()
      };
    };
    try {
      const result = await this.provider!.understand({
        prompt: task.settings.prompt.trim() || "请仅依据所选素材生成可编辑动画规划。",
        resources: task.resources,
        timeoutMs: task.settings.timeoutMs,
        signal: task.controller.signal,
        onProgress: progress
      });
      const { progress: _progress, ...viewWithoutProgress } = task.view;
      task.view = { ...viewWithoutProgress, phase: "plan", updatedAt: new Date().toISOString() };
      const planned = planAnimation(result, {
        resources: task.resources,
        width: task.settings.width,
        height: task.settings.height,
        fps: task.settings.fps,
        duration: task.settings.duration
      });
      task.view = {
        ...task.view,
        status: "completed",
        phase: "plan",
        result: planned,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      const failure = errorView(error);
      task.view = {
        ...task.view,
        status: failure.code === "cancelled" ? "cancelled" : "failed",
        error: failure,
        updatedAt: new Date().toISOString()
      };
    }
  }
}

export function createProductionAiPlanService(mediaRoot: string): AiPlanService {
  const apiKey = process.env.ARK_API_KEY;
  return new AiPlanService(
    apiKey && apiKey.trim().length >= 10 ? new VolcengineArkProvider({ apiKey }) : undefined,
    resolve(mediaRoot)
  );
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("请求体超过 5 MB。");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function createAiPlanApi(service: AiPlanService) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/ai-plans")) return next();
    try {
      if (request.method === "GET" && url.pathname === "/api/ai-plans") {
        sendJson(response, 200, { configured: service.configured, tasks: service.list() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/ai-plans") {
        const body = await jsonBody(request) as { project?: unknown; settings?: AiPlanSettings };
        if (!body.settings) throw new Error("缺少规划设置。");
        sendJson(response, 202, { task: service.create(body.project, body.settings) });
        return;
      }
      const cancel = /^\/api\/ai-plans\/([^/]+)\/cancel$/.exec(url.pathname);
      if (request.method === "POST" && cancel) {
        sendJson(response, 200, { task: service.cancel(decodeURIComponent(cancel[1]!)) });
        return;
      }
      sendJson(response, 404, { error: "AI 规划接口不存在。" });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "AI 规划请求失败。" });
    }
  };
}
