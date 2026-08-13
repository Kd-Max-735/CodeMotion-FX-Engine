import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import {
  MediaPreviewDecodeError,
  OwnedTaskStore,
  type OwnerContext,
  type VerifiedStoredMedia
} from "@codemotion/exporter";
import {
  ProviderError,
  VolcengineArkProvider,
  parseExplicitDuration,
  parseAiPlanningInputV1,
  planAnimation,
  serializeAiPlanCompletedResultV2,
  type AiAssetReference,
  type AiPlanningInputV1,
  type AiTaskPrincipal,
  type LocalResourceInput,
  type ModelProvider,
  type PlannedAnimation,
  type ProviderErrorCode,
  type ProviderFailureReason,
  type ProviderProgress,
  type UnderstandingResult
} from "@codemotion/ai-planner";
import type { AiPlanCompletedResultV2 } from "@codemotion/schema";
import { effectCardForEffectId, explicitEffectCardRequests, explicitP0EffectRequest } from "@codemotion/effects-2d";
import { AuthHttpError } from "./auth-session-service.js";

export interface AiSessionPrincipal {
  readonly tenantId: string;
  readonly userId: string;
  readonly scopes: readonly string[];
}

export interface AiAssetResolver {
  resolve(owner: OwnerContext, assetId: string, signal?: AbortSignal): Promise<VerifiedStoredMedia>;
}

type AiPlanStatus = "running" | "cancelling" | "completed" | "failed" | "cancelled";

interface AiPlanSafeError {
  readonly code: ProviderErrorCode | "planning" | "media_preview_failed";
  readonly message: string;
  readonly retryable: boolean;
  readonly problemCode?: ProviderFailureReason;
}

interface InternalAiPlanTaskView {
  readonly id: string;
  readonly status: AiPlanStatus;
  readonly phase: ProviderProgress["phase"] | "accepted" | "plan";
  readonly progress?: ProviderProgress;
  readonly events: readonly ProviderProgress[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly modalities: readonly ("text" | "image" | "audio" | "video")[];
  readonly result?: PlannedAnimation;
  readonly error?: AiPlanSafeError;
}

export interface AiPlanBrowserTaskView {
  readonly id: string;
  readonly status: AiPlanStatus;
  readonly phase: ProviderProgress["phase"] | "accepted" | "plan";
  readonly progress?: ProviderProgress;
  readonly events: readonly ProviderProgress[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly modalities: readonly ("text" | "image" | "audio" | "video")[];
  readonly result?: AiPlanCompletedResultV2;
  readonly error?: AiPlanSafeError;
}

interface InternalTask {
  view: InternalAiPlanTaskView;
  controller: AbortController;
  input: AiPlanningInputV1;
  principal: AiTaskPrincipal;
  resources: readonly LocalResourceInput[];
  durationSeconds: number;
}

export interface AiPlanDiagnosticRecord {
  readonly taskId: string;
  readonly stage: InternalAiPlanTaskView["phase"];
  readonly code: AiPlanSafeError["code"];
  readonly reason?: ProviderFailureReason;
  readonly retryable: boolean;
}

export type AiPlanDiagnosticSink = (record: AiPlanDiagnosticRecord) => void;

const MAX_BODY_BYTES = 5 * 1024 * 1024;

const safeErrors: Record<ProviderErrorCode | "planning" | "media_preview_failed", string> = {
  cancelled: "分析已取消。",
  timeout: "分析超过设定时限。",
  rate_limited: "服务请求频率已达上限，请稍后重试。",
  invalid_input: "输入格式、大小、时长或素材完整性校验失败。",
  authentication: "服务端 Provider 认证失败。",
  unsupported: "所选输入格式不受支持。",
  provider_unavailable: "理解服务暂时不可用。",
  provider_response: "模型返回未通过结构化校验。",
  security: "模型响应未通过安全校验。",
  planning: "生成结构未通过安全校验，请重试。",
  media_preview_failed: "上传素材无法生成预览，请重新上传受支持的图片或视频。"
};

class AiAuthorizationError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message);
  }
}

class AiDurationRequestError extends Error {
  readonly status = 422;
  constructor(readonly code: "AI_DURATION_INVALID" | "AI_DURATION_OUT_OF_RANGE" | "AI_DURATION_AMBIGUOUS" | "AI_DURATION_EXCEEDS_VIDEO", message: string) {
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

function authoritativeDuration(
  input: AiPlanningInputV1,
  resources: readonly LocalResourceInput[]
): number {
  const explicit = parseExplicitDuration(input.prompt);
  if (explicit.kind === "invalid") {
    const code = explicit.code === "DURATION_OUT_OF_RANGE"
      ? "AI_DURATION_OUT_OF_RANGE"
      : explicit.code === "DURATION_AMBIGUOUS" ? "AI_DURATION_AMBIGUOUS" : "AI_DURATION_INVALID";
    throw new AiDurationRequestError(code, `Description duration is invalid: ${explicit.code}.`);
  }
  const duration = explicit.kind === "valid" ? explicit.seconds : input.durationSeconds;
  if (!Number.isFinite(duration) || duration < 0.5 || duration > 60) {
    throw new AiDurationRequestError("AI_DURATION_OUT_OF_RANGE", "Requested duration is outside the supported range.");
  }
  const videoDurations = resources.filter((resource) => resource.modality === "video")
    .map((resource) => Number(resource.asset.metadata.duration))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (videoDurations.length > 0 && duration > Math.min(...videoDurations)) {
    throw new AiDurationRequestError("AI_DURATION_EXCEEDS_VIDEO", "Requested duration exceeds the verified source video duration.");
  }
  return duration;
}

function errorView(error: unknown): AiPlanSafeError {
  if (error instanceof MediaPreviewDecodeError) {
    return {
      code: "media_preview_failed",
      message: safeErrors.media_preview_failed,
      retryable: false,
      problemCode: "MEDIA_PREVIEW_FAILED"
    };
  }
  if (error instanceof ProviderError) {
    return { code: error.code, message: safeErrors[error.code], retryable: error.retryable,
      ...(error.reason ? { problemCode: error.reason } : {}) };
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
  private readonly pendingCreations = new Map<AbortController, Promise<void>>();
  private readonly activeRuns = new Map<InternalTask, Promise<void>>();
  private closing = false;
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly provider: ModelProvider | undefined,
    private readonly assets: AiAssetResolver,
    private readonly planner: typeof planAnimation = planAnimation,
    private readonly diagnostics?: AiPlanDiagnosticSink
  ) {}

  get configured(): boolean { return this.provider !== undefined; }

  usesAsset(owner: OwnerContext, assetId: string): boolean {
    return this.tasks.list(owner).some(({ value }) =>
      (value.view.status === "running" || value.view.status === "cancelling")
      && value.input.assets.some((asset) => asset.assetId === assetId));
  }

  private browserView(task: InternalTask): AiPlanBrowserTaskView {
    const view = task.view;
    return structuredClone({
      id: view.id,
      status: view.status,
      phase: view.phase,
      events: view.events,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      modalities: view.modalities,
      ...(view.progress === undefined ? {} : { progress: view.progress }),
      ...(view.error === undefined ? {} : { error: view.error }),
      ...(view.status === "completed" && view.result !== undefined
        ? { result: serializeAiPlanCompletedResultV2(view.result) }
        : {})
    });
  }

  list(rawPrincipal: AiSessionPrincipal): AiPlanBrowserTaskView[] {
    const owner = ownerOf(authorizedPrincipal(rawPrincipal));
    return this.tasks.list(owner).map(({ value }) => this.browserView(value))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(rawPrincipal: AiSessionPrincipal, id: string): AiPlanBrowserTaskView {
    const owner = ownerOf(authorizedPrincipal(rawPrincipal));
    return this.browserView(this.tasks.get(owner, id).value);
  }

  async create(rawPrincipal: AiSessionPrincipal, rawInput: unknown): Promise<AiPlanBrowserTaskView> {
    this.assertAccepting();
    const session = authorizedPrincipal(rawPrincipal);
    if (!this.provider) throw new Error("服务端 Provider 未配置。");
    const input = parseAiPlanningInputV1(rawInput);
    const explicitCards = explicitEffectCardRequests(input.prompt);
    if (explicitCards.length > 1) {
      throw new ProviderError("invalid_input", "当前版本一次只能使用一个特效。", { retryable: false });
    }
    const explicitP0 = explicitP0EffectRequest(input.prompt);
    if (explicitP0 && explicitCards.length === 0) {
      throw new ProviderError("unsupported", "该特效暂未开放生成入口。", { retryable: false });
    }
    if (input.selectedEffectId && explicitCards.some((card) => card.effectId !== input.selectedEffectId)) {
      throw new ProviderError("invalid_input", "所选特效与自然语言要求冲突。", { retryable: false });
    }
    const id = randomUUID();
    const principal: AiTaskPrincipal = {
      tenantId: session.tenantId,
      userId: session.userId,
      taskId: id,
      scopes: ["ai:plan"]
    };
    const controller = new AbortController();
    let settleCreation!: () => void;
    const settled = new Promise<void>((resolve) => { settleCreation = resolve; });
    this.pendingCreations.set(controller, settled);
    try {
      const resources = await this.resolveResources(ownerOf(session), input.assets, controller.signal);
      const durationSeconds = authoritativeDuration(input, resources);
      this.assertAccepting(controller.signal);
      const now = new Date().toISOString();
      const modalities = [
        ...(input.prompt.trim() ? ["text" as const] : []),
        ...resources.map((item) => item.modality)
      ];
      const task: InternalTask = {
        input,
        principal,
        resources,
        durationSeconds,
        controller,
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
      this.start(task);
      return this.browserView(task);
    } finally {
      this.pendingCreations.delete(controller);
      settleCreation();
    }
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closing = true;
    this.closePromise = this.finishClose();
    return this.closePromise;
  }

  dispose(): Promise<void> { return this.close(); }

  cancel(rawPrincipal: AiSessionPrincipal, id: string): AiPlanBrowserTaskView {
    const owner = ownerOf(authorizedPrincipal(rawPrincipal));
    const task = this.tasks.get(owner, id).value;
    if (task.view.status !== "running") throw new Error("只有运行中的任务可以取消。");
    task.view = { ...task.view, status: "cancelling", updatedAt: new Date().toISOString() };
    task.controller.abort(new ProviderError("cancelled", "Provider request was cancelled."));
    return this.browserView(task);
  }

  private async resolveResources(
    owner: OwnerContext,
    references: readonly AiAssetReference[],
    signal: AbortSignal
  ): Promise<LocalResourceInput[]> {
    const resources: LocalResourceInput[] = [];
    for (const reference of references) {
      signal.throwIfAborted();
      const verified = await this.assets.resolve(owner, reference.assetId, signal);
      signal.throwIfAborted();
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

  private assertAccepting(signal?: AbortSignal): void {
    if (this.closing || signal?.aborted) {
      throw new ProviderError("cancelled", "AI planning service is closing.");
    }
  }

  private start(task: InternalTask): void {
    const execution = Promise.resolve().then(() => this.run(task));
    this.activeRuns.set(task, execution);
    void execution.then(
      () => { this.activeRuns.delete(task); },
      () => { this.activeRuns.delete(task); }
    );
  }

  private abortTask(task: InternalTask, reason: ProviderError): void {
    if (task.view.status !== "running" && task.view.status !== "cancelling") return;
    if (task.view.status === "running") {
      task.view = { ...task.view, status: "cancelling", updatedAt: new Date().toISOString() };
    }
    if (!task.controller.signal.aborted) task.controller.abort(reason);
  }

  private async finishClose(): Promise<void> {
    const reason = new ProviderError("cancelled", "AI planning service is closing.");
    for (const controller of this.pendingCreations.keys()) {
      if (!controller.signal.aborted) controller.abort(reason);
    }
    for (const task of this.activeRuns.keys()) this.abortTask(task, reason);
    await Promise.all([...this.pendingCreations.values()]);
    for (const task of this.activeRuns.keys()) this.abortTask(task, reason);
    while (this.activeRuns.size > 0) {
      await Promise.all([...this.activeRuns.values()]);
    }
  }

  private async run(task: InternalTask): Promise<void> {
    let providerProgressOpen = true;
    const progress = (event: ProviderProgress): void => {
      if (!providerProgressOpen || this.closing || task.controller.signal.aborted || task.view.status !== "running") return;
      task.view = {
        ...task.view,
        phase: event.phase,
        progress: event,
        events: [...task.view.events, event].slice(-100),
        updatedAt: new Date().toISOString()
      };
    };
    try {
      task.controller.signal.throwIfAborted();
      let result: UnderstandingResult;
      try {
        result = await this.provider!.understand({
          principal: task.principal,
          prompt: task.input.prompt.trim() || "请仅依据所选素材生成可编辑动画规划。",
          resources: task.resources,
          planning: {
            width: task.input.canvas.width,
            height: task.input.canvas.height,
            fps: task.input.canvas.fps,
            durationSeconds: task.durationSeconds,
            style: task.input.style,
            ...(task.input.selectedEffectId === undefined
              ? {}
              : { selectedEffectId: task.input.selectedEffectId }),
            brand: task.input.brand
          },
          timeoutMs: 120_000,
          signal: task.controller.signal,
          onProgress: progress
        });
      } finally {
        providerProgressOpen = false;
      }
      task.controller.signal.throwIfAborted();
      const visualCount = task.resources.filter((resource) =>
        resource.modality === "image" || resource.modality === "video").length;
      const selectedByModel = new Set(result.storyboard.shots.flatMap((shot) =>
        shot.effects.map((effect) => effect.effectId)));
      if (selectedByModel.size !== 1) {
        throw new ProviderError("provider_response", "模型必须且只能选择一个特效。", {
          retryable: true,
          reason: "SCHEMA_INVALID"
        });
      }
      const modelEffectId = [...selectedByModel][0]!;
      const effectiveEffectId = task.input.selectedEffectId ?? modelEffectId;
      const card = effectCardForEffectId(effectiveEffectId);
      if (!card) {
        throw new ProviderError("provider_response", "模型选择了未开放的特效。", {
          retryable: true,
          reason: "EFFECT_ID_INVALID"
        });
      }
      if (visualCount > 0 && visualCount !== (card.fixture.secondaryInput ? 2 : 1)) {
        throw new ProviderError("invalid_input", card.fixture.secondaryInput
          ? "该特效需要且只能使用两个视觉素材。"
          : "该特效需要且只能使用一个视觉素材。", {
          retryable: false,
          reason: "ASSET_COUNT_INCOMPATIBLE"
        });
      }
      const { progress: _progress, ...viewWithoutProgress } = task.view;
      task.view = { ...viewWithoutProgress, phase: "plan", updatedAt: new Date().toISOString() };
      const planned = await this.planner(result, {
        resources: task.resources,
        width: task.input.canvas.width,
        height: task.input.canvas.height,
        fps: task.input.canvas.fps,
        duration: task.durationSeconds,
        style: task.input.style,
        brand: task.input.brand,
        prompt: task.input.prompt,
        ...(task.input.selectedEffectId === undefined ? {} : { effectIds: [task.input.selectedEffectId] }),
        signal: task.controller.signal
      });
      task.controller.signal.throwIfAborted();
      task.view = {
        ...task.view,
        status: "completed",
        phase: "plan",
        result: planned,
        updatedAt: new Date().toISOString()
      };
    } catch (error) {
      const failure = errorView(error);
      this.diagnostics?.({
        taskId: task.principal.taskId,
        stage: task.view.phase,
        code: failure.code,
        ...(failure.problemCode === undefined ? {} : { reason: failure.problemCode }),
        retryable: failure.retryable
      });
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
  assets: AiAssetResolver,
  allowVerifiedSampleCards = false,
  env: NodeJS.ProcessEnv = process.env
): AiPlanService {
  const apiKey = env.ARK_API_KEY;
  const writeDiagnostic = (record: Readonly<Record<string, unknown>>): void => {
    process.stderr.write(`[ai-planner] ${JSON.stringify(record)}\n`);
  };
  return new AiPlanService(
    apiKey && apiKey.trim().length >= 10 ? new VolcengineArkProvider({
      apiKey,
      allowVerifiedSampleCards,
      audit: (record) => writeDiagnostic({ kind: "provider", ...record })
    }) : undefined,
    assets,
    planAnimation,
    (record) => writeDiagnostic({ kind: "task", ...record })
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
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

export function createAiPlanApi(
  service: AiPlanService,
  resolvePrincipal?: (
    request: IncomingMessage,
    response: ServerResponse
  ) => AiSessionPrincipal | Promise<AiSessionPrincipal>,
  verifyStateChange?: (
    request: IncomingMessage,
    response: ServerResponse,
    principal: AiSessionPrincipal
  ) => void | Promise<void>
) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const collection = url.pathname === "/api/ai-plans";
    const item = /^\/api\/ai-plans\/([^/]+)$/.exec(url.pathname);
    const cancellation = /^\/api\/ai-plans\/([^/]+)\/cancel$/.exec(url.pathname);
    const matched = request.method === "GET" && (collection || item !== null)
      || request.method === "POST" && (collection || cancellation !== null);
    if (!matched) return next();
    try {
      if (resolvePrincipal === undefined) {
        throw new AiAuthorizationError(401, "Authenticated AI principal resolver is not configured.");
      }
      let resolved: unknown;
      try {
        resolved = await resolvePrincipal(request, response);
      } catch {
        throw new AiAuthorizationError(401, "AI principal resolution failed.");
      }
      const principal = authorizedPrincipal(resolved);
      if (request.method === "POST") {
        if (verifyStateChange === undefined) throw new AuthHttpError(403, "REQUEST_ORIGIN_REJECTED");
        await verifyStateChange(request, response, principal);
      }
      if (request.method === "GET" && url.pathname === "/api/ai-plans") {
        sendJson(response, 200, { configured: service.configured, tasks: service.list(principal) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/ai-plans") {
        const body = await jsonBody(request);
        const parsed = parseAiPlanningInputV1(body);
        const visualCount = parsed.assets.filter((asset) => asset.purpose !== "reference-audio").length;
        if (parsed.prompt.trim().length === 0 || visualCount < 1 || visualCount > 2) {
          throw new ProviderError("invalid_input", visualCount > 2
            ? "首轮最多使用两个视觉素材。"
            : "自然语言说明和视觉素材必须同时存在。", { retryable: false });
        }
        sendJson(response, 202, { task: await service.create(principal, body) });
        return;
      }
      if (request.method === "GET" && item) {
        sendJson(response, 200, { task: service.get(principal, decodeURIComponent(item[1]!)) });
        return;
      }
      if (request.method === "POST" && cancellation) {
        sendJson(response, 200, { task: service.cancel(principal, decodeURIComponent(cancellation[1]!)) });
        return;
      }
      sendJson(response, 404, { error: "AI 规划接口不存在。" });
    } catch (error) {
      const status = error instanceof AiAuthorizationError
        ? error.status
        : error instanceof AiDurationRequestError ? error.status
        : error instanceof AuthHttpError ? error.status
        : error instanceof Error && /not found|access denied/i.test(error.message) ? 404 : 400;
      const code = error instanceof AiAuthorizationError
        ? error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN"
        : error instanceof AiDurationRequestError ? error.code
        : error instanceof AuthHttpError ? error.code : "AI_PLAN_REQUEST_REJECTED";
      const messages: Readonly<Record<string, string>> = Object.freeze({
        UNAUTHENTICATED: "Authentication is required.",
        FORBIDDEN: "The required permission is missing.",
        REQUEST_ORIGIN_REJECTED: "The request origin was rejected.",
        NOT_FOUND: "The requested object was not found.",
        AI_DURATION_INVALID: "The duration in the description is invalid.",
        AI_DURATION_OUT_OF_RANGE: "The requested duration is outside the supported range.",
        AI_DURATION_AMBIGUOUS: "The description contains conflicting durations.",
        AI_DURATION_EXCEEDS_VIDEO: "The requested duration exceeds the verified source video duration.",
        AI_PLAN_REQUEST_REJECTED: "The AI planning request was rejected."
      });
      sendJson(response, status, {
        error: {
          code,
          message: messages[code] ?? "The AI planning request was rejected.",
          retryable: false,
          requestId: `req_${randomUUID()}`
        }
      });
    }
  };
}
