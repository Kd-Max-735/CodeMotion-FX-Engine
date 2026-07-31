import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import {
  OwnedTaskStore,
  TenantMediaStore,
  type OwnerContext,
  type VerifiedStoredMedia
} from "@codemotion/exporter";
import {
  ProviderError,
  VolcengineArkProvider,
  parseAiPlanningInputV1,
  planAnimation,
  type AiAssetReference,
  type AiPlanningInputV1,
  type AiTaskPrincipal,
  type LocalResourceInput,
  type ModelProvider,
  type ProviderErrorCode,
  type ProviderProgress
} from "@codemotion/ai-planner";
import type { AiPlanTaskView } from "./ai-plan-client.js";

export interface AiSessionPrincipal {
  readonly tenantId: string;
  readonly userId: string;
  readonly scopes: readonly string[];
}

export interface AiAssetResolver {
  resolve(owner: OwnerContext, assetId: string, signal?: AbortSignal): Promise<VerifiedStoredMedia>;
}

interface InternalTask {
  view: AiPlanTaskView;
  controller: AbortController;
  input: AiPlanningInputV1;
  principal: AiTaskPrincipal;
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

class AiAuthorizationError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
  }
}

function authorizedPrincipal(value: unknown): AiSessionPrincipal {
  if (typeof value !== "object" || value === null) {
    throw new AiAuthorizationError(401, "Authenticated AI principal is required.");
  }
  const principal = value as Partial<AiSessionPrincipal>;
  if (typeof principal.tenantId !== "string" || principal.tenantId.length < 1 || principal.tenantId.length > 256
    || typeof principal.userId !== "string" || principal.userId.length < 1 || principal.userId.length > 256
    || !Array.isArray(principal.scopes) || principal.scopes.some((scope) => typeof scope !== "string")) {
    throw new AiAuthorizationError(401, "Authenticated AI principal is invalid.");
  }
  if (!principal.scopes.includes("ai:plan")) {
    throw new AiAuthorizationError(403, "The ai:plan scope is required.");
  }
  return {
    tenantId: principal.tenantId,
    userId: principal.userId,
    scopes: [...principal.scopes]
  };
}

function ownerOf(principal: AiSessionPrincipal): OwnerContext {
  return { tenantId: principal.tenantId, userId: principal.userId };
}

function expectedAssetTypes(reference: AiAssetReference): readonly string[] {
  if (reference.purpose === "reference-image" || reference.purpose === "logo") return ["image", "svg"];
  if (reference.purpose === "reference-video") return ["video"];
  return ["audio"];
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
  private readonly tasks = new OwnedTaskStore<InternalTask>();

  constructor(
    private readonly provider: ModelProvider | undefined,
    private readonly assets: AiAssetResolver
  ) {}

  get configured(): boolean { return this.provider !== undefined; }

  list(rawPrincipal: AiSessionPrincipal): AiPlanTaskView[] {
    const owner = ownerOf(authorizedPrincipal(rawPrincipal));
    return this.tasks.list(owner).map(({ value }) => structuredClone(value.view))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(rawPrincipal: AiSessionPrincipal, id: string): AiPlanTaskView {
    const owner = ownerOf(authorizedPrincipal(rawPrincipal));
    return structuredClone(this.tasks.get(owner, id).value.view);
  }

  async create(rawPrincipal: AiSessionPrincipal, rawInput: unknown): Promise<AiPlanTaskView> {
    const session = authorizedPrincipal(rawPrincipal);
    if (!this.provider) throw new Error("服务端 Provider 未配置。");
    const input = parseAiPlanningInputV1(rawInput);
    const id = randomUUID();
    const principal: AiTaskPrincipal = {
      tenantId: session.tenantId,
      userId: session.userId,
      taskId: id,
      scopes: ["ai:plan"]
    };
    const resources = await this.resolveResources(ownerOf(session), input.assets);
    const now = new Date().toISOString();
    const modalities = [
      ...(input.prompt.trim() ? ["text" as const] : []),
      ...resources.map((item) => item.modality)
    ];
    const task: InternalTask = {
      input,
      principal,
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
    this.tasks.put(ownerOf(session), id, task);
    void this.run(task);
    return structuredClone(task.view);
  }

  cancel(rawPrincipal: AiSessionPrincipal, id: string): AiPlanTaskView {
    const owner = ownerOf(authorizedPrincipal(rawPrincipal));
    const task = this.tasks.get(owner, id).value;
    if (task.view.status !== "running") throw new Error("只有运行中的任务可以取消。");
    task.view = { ...task.view, status: "cancelling", updatedAt: new Date().toISOString() };
    task.controller.abort(new ProviderError("cancelled", "Provider request was cancelled."));
    return structuredClone(task.view);
  }

  private async resolveResources(
    owner: OwnerContext,
    references: readonly AiAssetReference[]
  ): Promise<LocalResourceInput[]> {
    const resources: LocalResourceInput[] = [];
    for (const reference of references) {
      const verified = await this.assets.resolve(owner, reference.assetId);
      if (verified.asset.id !== reference.assetId
        || !expectedAssetTypes(reference).includes(verified.asset.type)) {
        throw new ProviderError("security", "Authorized asset type does not match its ai-task/v1 purpose.");
      }
      const modality = verified.asset.type === "svg"
        ? "image"
        : verified.asset.type as "image" | "audio" | "video";
      resources.push({
        modality,
        localAssetId: reference.assetId,
        asset: verified.asset,
        storageDirectory: dirname(verified.storedPath),
        ...(modality === "video" ? { videoFps: 0.3 } : {})
      });
    }
    return resources;
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
        principal: task.principal,
        prompt: task.input.prompt.trim() || "请仅依据所选素材生成可编辑动画规划。",
        resources: task.resources,
        planning: {
          width: task.input.canvas.width,
          height: task.input.canvas.height,
          fps: task.input.canvas.fps,
          durationSeconds: task.input.durationSeconds,
          style: task.input.style,
          brand: task.input.brand
        },
        timeoutMs: 120_000,
        signal: task.controller.signal,
        onProgress: progress
      });
      const { progress: _progress, ...viewWithoutProgress } = task.view;
      task.view = { ...viewWithoutProgress, phase: "plan", updatedAt: new Date().toISOString() };
      const planned = await planAnimation(result, {
        resources: task.resources,
        width: task.input.canvas.width,
        height: task.input.canvas.height,
        fps: task.input.canvas.fps,
        duration: task.input.durationSeconds,
        style: task.input.style,
        brand: task.input.brand,
        signal: task.controller.signal
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

export function createProductionAiPlanService(
  mediaRoot: string,
  assets: AiAssetResolver = new TenantMediaStore({
    storageRoot: resolve(mediaRoot),
    allowedRoots: []
  })
): AiPlanService {
  const apiKey = process.env.ARK_API_KEY;
  return new AiPlanService(
    apiKey && apiKey.trim().length >= 10 ? new VolcengineArkProvider({ apiKey }) : undefined,
    assets
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

export function createAiPlanApi(
  service: AiPlanService,
  resolvePrincipal?: (
    request: IncomingMessage
  ) => AiSessionPrincipal | Promise<AiSessionPrincipal>
) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/ai-plans")) return next();
    try {
      if (resolvePrincipal === undefined) {
        throw new AiAuthorizationError(401, "Authenticated AI principal resolver is not configured.");
      }
      let resolved: unknown;
      try {
        resolved = await resolvePrincipal(request);
      } catch {
        throw new AiAuthorizationError(401, "AI principal resolution failed.");
      }
      const principal = authorizedPrincipal(resolved);
      if (request.method === "GET" && url.pathname === "/api/ai-plans") {
        sendJson(response, 200, { configured: service.configured, tasks: service.list(principal) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/ai-plans") {
        const body = await jsonBody(request);
        sendJson(response, 202, { task: await service.create(principal, body) });
        return;
      }
      const read = /^\/api\/ai-plans\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && read) {
        sendJson(response, 200, { task: service.get(principal, decodeURIComponent(read[1]!)) });
        return;
      }
      const cancel = /^\/api\/ai-plans\/([^/]+)\/cancel$/.exec(url.pathname);
      if (request.method === "POST" && cancel) {
        sendJson(response, 200, { task: service.cancel(principal, decodeURIComponent(cancel[1]!)) });
        return;
      }
      sendJson(response, 404, { error: "AI 规划接口不存在。" });
    } catch (error) {
      const status = error instanceof AiAuthorizationError
        ? error.status
        : error instanceof Error && /not found|access denied/i.test(error.message) ? 404 : 400;
      sendJson(response, status, { error: error instanceof Error ? error.message : "AI 规划请求失败。" });
    }
  };
}
