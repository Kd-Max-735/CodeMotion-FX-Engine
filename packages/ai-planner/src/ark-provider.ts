import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { effectCardForEffectId } from "@codemotion/effects-2d";
import { verifyStoredMediaAsset, type VerifiedStoredMedia } from "@codemotion/exporter";
import {
  ARK_V1_MODEL,
  ProviderError,
  type AiTaskPrincipal,
  type LocalResourceInput,
  type ModelProvider,
  type ModelIntentDto,
  type PlanningContext,
  type ProviderAuditRecord,
  type ProviderAuditSink,
  type ProviderErrorCode,
  type ProviderFailureReason,
  type ProviderProgress,
  type UnderstandingRequest,
  type UnderstandingResult
} from "./provider.js";
import { buildDeterministicPlanStructure } from "./deterministic-plan.js";
import { intentTargetKind, resolveIntentCandidates } from "./intent-planning.js";
import { MODEL_INTENT_JSON_SCHEMA, STRUCTURE_INSTRUCTION } from "./understanding-schema.js";
import { fingerprintProviderRequestId, sanitizeUserText } from "./security.js";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const FILES_LIMIT = 512 * 1024 * 1024;
const IMAGE_LIMIT = 10 * 1024 * 1024;
const ACTIVE = "active";
const PROCESSING = "processing";
const GENERATION_ATTEMPTS = 2;
const GENERATION_RETRY_DELAY_MS = 250;

interface SafeDiagnosticCounts {
  readonly outputCharacters?: number;
  readonly validationErrors?: number;
}

class PlanningResponseError extends ProviderError {
  constructor(
    readonly reason: ProviderFailureReason,
    message: string,
    readonly safeCounts: SafeDiagnosticCounts = {},
    code: "provider_response" | "security" = "provider_response"
  ) {
    super(code, message);
  }
}

interface ArkProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly audit?: ProviderAuditSink;
  readonly fetchImpl?: typeof fetch;
  readonly maxConcurrency?: number;
  readonly requestsPerMinute?: number;
  readonly maxTenantConcurrency?: number;
  readonly tenantRequestsPerMinute?: number;
  readonly maxUserConcurrency?: number;
  readonly userRequestsPerMinute?: number;
  readonly tenantCostCnyPerMinute?: number;
  readonly userCostCnyPerMinute?: number;
  readonly maxRetries?: number;
  readonly processingPollMs?: number;
  readonly allowVerifiedSampleCards?: boolean;
}

interface ArkFile {
  readonly id: string;
  readonly object: "file";
  readonly purpose: "user_data";
  readonly filename: string;
  readonly bytes: number;
  readonly mime_type: string;
  readonly created_at: number;
  readonly expire_at: number;
  readonly status: string;
}

interface HttpResult {
  readonly status: number;
  readonly body: unknown;
  readonly latencyMs: number;
  readonly requestFingerprint: string;
}

interface AuditScope {
  readonly ownerFingerprint: string;
  readonly taskFingerprint: string;
}

interface PreparedResource {
  readonly input: LocalResourceInput;
  readonly imported: VerifiedStoredMedia;
  readonly transferPath: string;
  readonly transferBytes: number;
  readonly transferMime: string;
  readonly transferHash: string;
}

interface GateState {
  active: number;
  readonly starts: number[];
  readonly costs: Array<{ readonly at: number; readonly value: number }>;
}

interface GatePrincipal {
  readonly tenantId: string;
  readonly userId: string;
}

class RequestGate {
  private readonly global: GateState = { active: 0, starts: [], costs: [] };
  private readonly tenants = new Map<string, GateState>();
  private readonly users = new Map<string, GateState>();
  private readonly waiters: Array<{
    readonly principal: GatePrincipal;
    readonly signal: AbortSignal;
    readonly resolve: () => void;
    readonly reject: (error: ProviderError) => void;
    readonly onAbort: () => void;
  }> = [];
  constructor(private readonly limits: {
    readonly globalConcurrency: number;
    readonly globalPerMinute: number;
    readonly tenantConcurrency: number;
    readonly tenantPerMinute: number;
    readonly userConcurrency: number;
    readonly userPerMinute: number;
    readonly tenantCostPerMinute: number;
    readonly userCostPerMinute: number;
  }) {}

  async run<T>(
    principal: GatePrincipal,
    signal: AbortSignal,
    task: () => Promise<T>,
    costOf: (value: T) => number
  ): Promise<T> {
    await this.enter(principal, signal);
    let cost = 0;
    try {
      const value = await task();
      cost = Math.max(0, costOf(value));
      return value;
    } finally {
      this.release(principal, cost);
    }
  }

  private async enter(principal: GatePrincipal, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new ProviderError("cancelled", "Provider request was cancelled.");
    const now = Date.now();
    this.reapAll(now);
    this.assertRateAndCost(principal);
    if (this.canAcquire(principal)) {
      this.acquire(principal, now);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiter = {
        principal,
        signal,
        resolve: (): void => {
          signal.removeEventListener("abort", waiter.onAbort);
          resolve();
        },
        reject,
        onAbort: (): void => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new ProviderError("cancelled", "Provider request was cancelled."));
          this.cleanup(Date.now());
        }
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
    });
  }

  private tenant(principal: GatePrincipal): GateState {
    return this.state(this.tenants, principal.tenantId);
  }

  private user(principal: GatePrincipal): GateState {
    return this.state(this.users, JSON.stringify([principal.tenantId, principal.userId]));
  }

  private state(map: Map<string, GateState>, key: string): GateState {
    let state = map.get(key);
    if (state === undefined) {
      state = { active: 0, starts: [], costs: [] };
      map.set(key, state);
    }
    return state;
  }

  private canAcquire(principal: GatePrincipal): boolean {
    return this.global.active < this.limits.globalConcurrency
      && this.tenant(principal).active < this.limits.tenantConcurrency
      && this.user(principal).active < this.limits.userConcurrency;
  }

  private acquire(principal: GatePrincipal, now: number): void {
    for (const state of [this.global, this.tenant(principal), this.user(principal)]) {
      state.active += 1;
      state.starts.push(now);
    }
  }

  private release(principal: GatePrincipal, cost: number): void {
    const now = Date.now();
    const tenant = this.tenant(principal);
    const user = this.user(principal);
    for (const state of [this.global, tenant, user]) state.active -= 1;
    if (Number.isFinite(cost) && cost > 0) {
      tenant.costs.push({ at: now, value: cost });
      user.costs.push({ at: now, value: cost });
    }
    this.reapAll(now);
    this.wakeEligible(now);
    this.cleanup(now);
  }

  private assertRateAndCost(principal: GatePrincipal): void {
    const tenant = this.tenant(principal);
    const user = this.user(principal);
    if (this.global.starts.length >= this.limits.globalPerMinute
      || tenant.starts.length >= this.limits.tenantPerMinute
      || user.starts.length >= this.limits.userPerMinute
      || this.totalCost(tenant) >= this.limits.tenantCostPerMinute
      || this.totalCost(user) >= this.limits.userCostPerMinute) {
      throw new ProviderError("rate_limited", "Server-side provider quota exceeded.", { retryable: true });
    }
  }

  private wakeEligible(now: number): void {
    let advanced = true;
    while (advanced && this.global.active < this.limits.globalConcurrency) {
      advanced = false;
      for (let index = 0; index < this.waiters.length; index += 1) {
        const waiter = this.waiters[index]!;
        if (waiter.signal.aborted) {
          waiter.signal.removeEventListener("abort", waiter.onAbort);
          this.waiters.splice(index, 1);
          index -= 1;
          continue;
        }
        try {
          this.assertRateAndCost(waiter.principal);
        } catch (error) {
          this.waiters.splice(index, 1);
          waiter.signal.removeEventListener("abort", waiter.onAbort);
          waiter.reject(error as ProviderError);
          advanced = true;
          break;
        }
        if (!this.canAcquire(waiter.principal)) continue;
        this.waiters.splice(index, 1);
        this.acquire(waiter.principal, now);
        waiter.resolve();
        advanced = true;
        break;
      }
    }
  }

  private reapAll(now: number): void {
    this.reap(this.global, now);
    for (const state of this.tenants.values()) this.reap(state, now);
    for (const state of this.users.values()) this.reap(state, now);
  }

  private reap(state: GateState, now: number): void {
    while (state.starts[0] !== undefined && state.starts[0] <= now - 60_000) state.starts.shift();
    while (state.costs[0] !== undefined && state.costs[0].at <= now - 60_000) state.costs.shift();
  }

  private totalCost(state: GateState): number {
    return state.costs.reduce((sum, entry) => sum + entry.value, 0);
  }

  private cleanup(now: number): void {
    const waitingTenants = new Set(this.waiters.map((waiter) => waiter.principal.tenantId));
    const waitingUsers = new Set(this.waiters.map((waiter) =>
      JSON.stringify([waiter.principal.tenantId, waiter.principal.userId])));
    for (const [key, state] of this.tenants) {
      this.reap(state, now);
      if (state.active === 0 && state.starts.length === 0 && state.costs.length === 0
        && !waitingTenants.has(key)) this.tenants.delete(key);
    }
    for (const [key, state] of this.users) {
      this.reap(state, now);
      if (state.active === 0 && state.starts.length === 0 && state.costs.length === 0
        && !waitingUsers.has(key)) this.users.delete(key);
    }
  }
}

function safeMessage(status: number): string {
  if (status === 401 || status === 403) return "Provider authentication failed.";
  if (status === 408 || status === 504) return "Provider request timed out.";
  if (status === 429) return "Provider rate limit was reached.";
  if (status >= 500) return "Provider is temporarily unavailable.";
  return "Provider rejected the request.";
}

function errorCode(status: number): ProviderErrorCode {
  if (status === 401 || status === 403) return "authentication";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 413 || status === 422) return "invalid_input";
  if (status >= 500) return "provider_unavailable";
  return "provider_response";
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function requestFingerprint(headers: Headers, body: unknown): string {
  const header = headers.get("x-request-id") ?? headers.get("x-tt-logid");
  if (header) return fingerprintProviderRequestId(header);
  if (typeof body === "object" && body !== null && "id" in body && typeof body.id === "string") {
    return fingerprintProviderRequestId(body.id);
  }
  return fingerprintProviderRequestId(`local-${randomUUID()}`);
}

function auditScope(principal: AiTaskPrincipal): AuditScope {
  const digest = (domain: string, value: string) =>
    `sha256:${createHash("sha256").update(domain).update("\0").update(value).digest("hex").slice(0, 32)}`;
  return {
    ownerFingerprint: digest("codemotion-ai-owner", JSON.stringify([principal.tenantId, principal.userId])),
    taskFingerprint: digest("codemotion-ai-task", JSON.stringify([
      principal.tenantId,
      principal.userId,
      principal.taskId
    ]))
  };
}

function stripResponseIdentifier(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)
    || !("id" in body) || typeof body.id !== "string") {
    return body;
  }
  const { id: _requestIdentifier, ...rest } = body as Record<string, unknown>;
  return rest;
}

function parseArkFile(value: unknown): ArkFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderError("provider_response", "Files API returned an invalid file object.");
  }
  const item = value as Record<string, unknown>;
  if (item.object !== "file" || item.purpose !== "user_data"
    || typeof item.id !== "string" || !/^file-[A-Za-z0-9_-]+$/.test(item.id)
    || typeof item.filename !== "string" || typeof item.mime_type !== "string"
    || typeof item.bytes !== "number" || typeof item.created_at !== "number"
    || typeof item.expire_at !== "number" || typeof item.status !== "string") {
    throw new ProviderError("provider_response", "Files API file contract validation failed.");
  }
  return item as unknown as ArkFile;
}

function extractOutputText(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PlanningResponseError("RESPONSE_ENVELOPE", "Responses API returned an invalid response object.");
  }
  const root = body as Record<string, unknown>;
  if (typeof root.output_text === "string") return root.output_text;
  if (!Array.isArray(root.output)) throw new PlanningResponseError("NO_OUTPUT", "Responses API returned no output.");
  for (const output of root.output) {
    if (typeof output !== "object" || output === null || !("content" in output) || !Array.isArray(output.content)) continue;
    for (const content of output.content) {
      if (typeof content === "object" && content !== null && "type" in content
        && content.type === "output_text" && "text" in content && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  throw new PlanningResponseError("NO_OUTPUT", "Responses API returned no output text.");
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function schemaObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Internal planning Schema shape is invalid.");
  }
  return value as Record<string, unknown>;
}

function requestPlanningSchema(
  effectIds: readonly string[],
  expectedAddedText: string | null
): typeof MODEL_INTENT_JSON_SCHEMA {
  const schema = structuredClone(MODEL_INTENT_JSON_SCHEMA);
  const properties = schemaObject(schemaObject(schema).properties);
  schemaObject(properties.effectId).enum = [...effectIds];
  schemaObject(properties.targetKind).enum = [...new Set(effectIds.map(intentTargetKind))];
  properties.addedText = expectedAddedText === null
    ? { const: null }
    : { anyOf: [{ const: null }, { const: expectedAddedText }] };
  return deepFreeze(schema);
}

function usage(body: unknown, hasAudio: boolean): UnderstandingResult["trace"]["usage"] {
  const pricingSource = "https://www.volcengine.com/docs/82379/1544106";
  if (typeof body !== "object" || body === null || !("usage" in body)
    || typeof body.usage !== "object" || body.usage === null) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostCny: {
        lowerBound: 0,
        upperBound: 0,
        pricingSource,
        note: "No token usage was returned; zero is not a billing assertion."
      }
    };
  }
  const value = body.usage as Record<string, unknown>;
  const inputTokens = typeof value.input_tokens === "number" ? value.input_tokens : 0;
  const outputTokens = typeof value.output_tokens === "number" ? value.output_tokens : 0;
  const totalTokens = typeof value.total_tokens === "number" ? value.total_tokens : 0;
  const nonAudio = (inputTokens * 0.6 + outputTokens * 3.6) / 1_000_000;
  const audioUpper = (inputTokens * 9 + outputTokens * 3.6) / 1_000_000;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCostCny: {
      lowerBound: Number(nonAudio.toFixed(8)),
      upperBound: Number((hasAudio ? audioUpper : nonAudio).toFixed(8)),
      pricingSource,
      note: hasAudio
        ? "Range uses all input tokens at non-audio versus audio price because Ark usage does not split mixed input tokens."
        : "Estimate uses regular online inference under the 32k input tier; actual billing prevails."
    }
  };
}

function combineSignal(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ProviderError("timeout", "Provider request timed out.")), timeoutMs);
  const onAbort = (): void => controller.abort(parent?.reason);
  parent?.addEventListener("abort", onAbort, { once: true });
  if (parent?.aborted) onAbort();
  return {
    signal: controller.signal,
    dispose(): void {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    }
  };
}

function throwIfProviderAborted(signal: AbortSignal, cause?: unknown): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof ProviderError) throw signal.reason;
  throw new ProviderError("cancelled", "Provider request was cancelled.", { cause });
}

async function providerDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(milliseconds, undefined, { signal });
  } catch (cause) {
    throwIfProviderAborted(signal, cause);
    throw cause;
  }
}

function assertStringArray(
  value: unknown,
  name: string,
  maxItems: number,
  maxLength: number,
  pattern?: RegExp
): asserts value is string[] {
  if (!Array.isArray(value) || value.length > maxItems
    || value.some((item) => typeof item !== "string" || item.length > maxLength || (pattern !== undefined && !pattern.test(item)))) {
    throw new ProviderError("invalid_input", `${name} is outside ai-task/v1 limits.`);
  }
}

function snapshotPlanning(value: UnderstandingRequest["planning"]): PlanningContext {
  const source = value ?? {
    width: 1280,
    height: 720,
    fps: 24,
    durationSeconds: 6,
    style: [],
    brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  };
  try {
    const brand = source.brand;
    const style = source.style;
    const colors = brand.colors;
    const tone = brand.tone;
    const requiredText = brand.requiredText;
    const forbiddenContent = brand.forbiddenContent;
    const logoAssetIds = brand.logoAssetIds;
    const selectedEffectId = source.selectedEffectId;
    assertStringArray(style, "Planning style", 16, 200);
    assertStringArray(colors, "Planning brand colors", 16, 9, /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
    assertStringArray(tone, "Planning brand tone", 16, 200);
    assertStringArray(requiredText, "Planning required text", 16, 500);
    assertStringArray(forbiddenContent, "Planning forbidden content", 16, 500);
    assertStringArray(logoAssetIds, "Planning logo asset IDs", 8, 128);
    if (selectedEffectId !== undefined
      && (typeof selectedEffectId !== "string" || effectCardForEffectId(selectedEffectId) === undefined)) {
      throw new ProviderError("invalid_input", "Planning selectedEffectId is not an eligible sample card.");
    }
    return deepFreeze({
      width: source.width,
      height: source.height,
      fps: source.fps,
      durationSeconds: source.durationSeconds,
      style: [...style],
      ...(source.selectedEffectId === undefined ? {} : { selectedEffectId: source.selectedEffectId }),
      brand: {
        colors: [...colors],
        tone: [...tone],
        requiredText: [...requiredText],
        forbiddenContent: [...forbiddenContent],
        logoAssetIds: [...logoAssetIds]
      }
    });
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause;
    throw new ProviderError("invalid_input", "Planning constraints could not be read safely.", { cause });
  }
}

function assertInput(request: UnderstandingRequest, planning: PlanningContext): void {
  const principal = request.principal;
  if (typeof principal !== "object" || principal === null
    || !/^[\s\S]{1,256}$/.test(principal.tenantId)
    || !/^[\s\S]{1,256}$/.test(principal.userId)
    || !/^[\s\S]{1,256}$/.test(principal.taskId)
    || !Array.isArray(principal.scopes)
    || !principal.scopes.includes("ai:plan")) {
    throw new ProviderError("security", "A trusted ai:plan task principal is required.");
  }
  if (request.prompt.length === 0 || request.prompt.length > 20_000) {
    throw new ProviderError("invalid_input", "Prompt length must be between 1 and 20000 characters.");
  }
  if ((request.resources?.length ?? 0) > 8) throw new ProviderError("invalid_input", "At most 8 media resources are accepted.");
  const ids = new Set<string>();
  for (const resource of request.resources ?? []) {
    if (!/^asset_[a-f0-9]{24}$/i.test(resource.localAssetId) || resource.asset.id !== resource.localAssetId) {
      throw new ProviderError("invalid_input", "A verified Stage 6 local asset ID is required.");
    }
    if (ids.has(resource.localAssetId)) throw new ProviderError("invalid_input", "Duplicate local resource ID.");
    ids.add(resource.localAssetId);
    if (resource.asset.type !== resource.modality
      && !(resource.modality === "image" && resource.asset.type === "svg")) {
      throw new ProviderError("invalid_input", "Resource modality and asset type disagree.");
    }
    if (resource.videoFps !== undefined && (resource.modality !== "video"
      || resource.videoFps < 0.2 || resource.videoFps > 5)) {
      throw new ProviderError("invalid_input", "Video fps must be in [0.2, 5].");
    }
  }
  if (!Number.isInteger(planning.width) || planning.width < 2 || planning.width > 8192
    || !Number.isInteger(planning.height) || planning.height < 2 || planning.height > 8192
    || planning.width * planning.height > 33_554_432
    || !Number.isInteger(planning.fps) || planning.fps < 1 || planning.fps > 60
    || !Number.isFinite(planning.durationSeconds)
    || planning.durationSeconds < 0.5 || planning.durationSeconds > 60) {
    throw new ProviderError("invalid_input", "Planning canvas, fps, or duration is outside ai-task/v1 limits.");
  }
}

function modelEffectCatalog(
  prompt: string,
  resources: readonly LocalResourceInput[],
  planning: PlanningContext,
  allowVerifiedSampleCards: boolean,
) {
  const resolved = resolveIntentCandidates(prompt, resources, planning, allowVerifiedSampleCards);
  return Object.freeze({
    expectedAddedText: resolved.expectedAddedText,
    catalog: Object.freeze(resolved.definitions.map((effect) => Object.freeze({
      effectId: effect.effectId,
      displayName: effect.displayName,
      description: effect.description,
      category: effect.category,
      aliases: effectCardForEffectId(effect.effectId)?.ai.aliases ?? [],
      targetKind: intentTargetKind(effect.effectId)
    })))
  });
}

function planningInstruction(
  planning: PlanningContext,
  catalog: ReturnType<typeof modelEffectCatalog>["catalog"],
  resources: readonly LocalResourceInput[]
): string {
  return [
    `Server-authoritative target context: ${JSON.stringify({
      selectedEffectId: planning.selectedEffectId ?? null,
      visualCount: resources.filter((resource) => resource.modality === "image" || resource.modality === "video").length,
      hasAudio: resources.some((resource) => resource.modality === "audio")
    })}`,
    `Authoritative compatible effect candidates: ${JSON.stringify(catalog)}`,
    "When the candidate list has one item, return that exact effectId.",
    "When multiple candidates remain, choose the single best semantic match for the user request.",
    "Do not infer editable effect parameters; the server applies the authoritative P0 card preset."
  ].join("\n");
}

function repairInstruction(reason: ProviderFailureReason | undefined): string {
  const corrections: Partial<Record<ProviderFailureReason, string>> = {
    NO_OUTPUT: "Return one non-empty JSON object.",
    INVALID_JSON: "Return syntactically valid JSON without Markdown or prose.",
    SCHEMA_INVALID: "Return exactly the required DTO fields and no extra fields.",
    EFFECT_ID_INVALID: "Use one exact effectId from the supplied Schema enum.",
    TEXT_REQUIRED: "Preserve the complete explicitly requested addedText and matching targetKind.",
    ASSET_COUNT_INCOMPATIBLE: "Choose only an effect compatible with the supplied visual count."
  };
  return corrections[reason ?? "SCHEMA_INVALID"] ?? "Return a DTO that exactly matches the supplied Schema.";
}

function emit(callback: UnderstandingRequest["onProgress"], event: ProviderProgress): void {
  callback?.(event);
}

function escapeMultipart(value: string): string {
  return value.replace(/[\r\n"]/g, "_");
}

async function multipartFileBody(
  path: string,
  mime: string,
  fields: Readonly<Record<string, string>>,
  trustedBytes: number,
  signal: AbortSignal,
  onBytes: (loaded: number, total: number) => void
): Promise<{ body: () => AsyncIterable<Uint8Array>; contentType: string; contentLength: number }> {
  const boundary = `----codemotion-${randomUUID()}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${escapeMultipart(name)}"\r\n\r\n${value}\r\n`));
  }
  const filename = escapeMultipart(basename(path));
  chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`));
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const fileInfo = await stat(path);
  if (!fileInfo.isFile() || fileInfo.size !== trustedBytes) {
    throw new ProviderError("security", "Verified media changed before upload.");
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0) + trustedBytes + suffix.byteLength;
  async function* stream(): AsyncGenerator<Uint8Array> {
    let fileBytes = 0;
    for (const chunk of chunks) {
      signal.throwIfAborted();
      yield chunk;
    }
    for await (const value of createReadStream(path, { signal })) {
      const chunk = value as Buffer;
      fileBytes += chunk.byteLength;
      if (fileBytes > trustedBytes) throw new ProviderError("security", "Verified media changed during upload.");
      onBytes(fileBytes, trustedBytes);
      yield chunk;
    }
    if (fileBytes !== trustedBytes) throw new ProviderError("security", "Verified media changed during upload.");
    yield suffix;
  }
  return {
    body: stream,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: total
  };
}

export class VolcengineArkProvider implements ModelProvider {
  readonly id = "volcengine-ark";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly gate: RequestGate;
  private readonly audit: ProviderAuditSink | undefined;
  private readonly maxRetries: number;
  private readonly processingPollMs: number;
  private readonly allowVerifiedSampleCards: boolean;

  constructor(private readonly options: ArkProviderOptions) {
    if (options.apiKey.trim().length < 10) throw new ProviderError("authentication", "A server-side Ark API key is required.");
    const limits = {
      globalConcurrency: options.maxConcurrency ?? 4,
      globalPerMinute: options.requestsPerMinute ?? 20,
      tenantConcurrency: options.maxTenantConcurrency ?? 3,
      tenantPerMinute: options.tenantRequestsPerMinute ?? 12,
      userConcurrency: options.maxUserConcurrency ?? 2,
      userPerMinute: options.userRequestsPerMinute ?? 8,
      tenantCostPerMinute: options.tenantCostCnyPerMinute ?? 5,
      userCostPerMinute: options.userCostCnyPerMinute ?? 2
    };
    if (Object.values(limits).some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new ProviderError("invalid_input", "Provider quota limits must be finite positive numbers.");
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.audit = options.audit;
    this.gate = new RequestGate(limits);
    this.maxRetries = options.maxRetries ?? 2;
    this.processingPollMs = options.processingPollMs ?? 2_000;
    this.allowVerifiedSampleCards = options.allowVerifiedSampleCards ?? process.env.NODE_ENV !== "production";
  }

  async understand(request: UnderstandingRequest): Promise<UnderstandingResult> {
    const planning = snapshotPlanning(request.planning);
    assertInput(request, planning);
    const intentCandidates = modelEffectCatalog(
      request.prompt,
      request.resources ?? [],
      planning,
      this.allowVerifiedSampleCards,
    );
    const effectCatalog = intentCandidates.catalog;
    if (effectCatalog.length === 0) {
      throw new ProviderError("unsupported", "No published effect candidate matches this request.");
    }
    const schema = requestPlanningSchema(
      effectCatalog.map((effect) => effect.effectId),
      intentCandidates.expectedAddedText
    );
    const linked = combineSignal(request.signal, request.timeoutMs ?? 120_000);
    const scope = auditScope(request.principal);
    const operation = this.gate.run<UnderstandingResult>(request.principal, linked.signal, async () => {
      const started = Date.now();
      const prepared: PreparedResource[] = [];
      const remoteByLocalId = new Map<string, string>();
      try {
        for (const input of request.resources ?? []) {
          emit(request.onProgress, { phase: "validate", localAssetId: input.localAssetId });
          const imported = await verifyStoredMediaAsset({
            asset: input.asset,
            storageDirectory: input.storageDirectory,
            signal: linked.signal
          });
          const preparedResource = await this.prepareResource(input, imported, linked.signal);
          this.enforceLimits(preparedResource);
          prepared.push(preparedResource);
        }
        const content: Array<Record<string, unknown>> = [{
          type: "input_text",
          text: `${STRUCTURE_INSTRUCTION}\n${planningInstruction(planning, effectCatalog, request.resources ?? [])}\nUser request: ${sanitizeUserText(request.prompt)}`
        }];
        for (const resource of prepared) {
          content.push({
            type: "input_text",
            text: `Direct ${resource.input.modality} input localAssetId: ${resource.input.localAssetId}`
          });
          if (resource.input.modality === "image") {
            const bytes = await readFile(resource.transferPath, { signal: linked.signal });
            if (bytes.byteLength !== resource.transferBytes) {
              throw new ProviderError("security", "Verified image changed before request construction.");
            }
            if (bytes.byteLength > IMAGE_LIMIT) {
              throw new ProviderError("invalid_input", "Image exceeds the server-side size limit.");
            }
            const actualHash = createHash("sha256").update(bytes).digest("hex");
            if (actualHash !== resource.transferHash) {
              throw new ProviderError("security", "Verified image content changed before request construction.");
            }
            content.push({
              type: "input_image",
              image_url: `data:${resource.transferMime};base64,${bytes.toString("base64")}`
            });
          } else {
            const remote = await this.uploadAndWait(resource, request, linked.signal, remoteByLocalId);
            content.push({
              type: resource.input.modality === "audio" ? "input_audio" : "input_video",
              file_id: remote
            });
          }
        }
        emit(request.onProgress, { phase: "infer" });
        const usageRecords: UnderstandingResult["trace"]["usage"][] = [];
        let retryReason: ProviderFailureReason | undefined;
        for (let attempt = 1 as 1 | 2; attempt <= GENERATION_ATTEMPTS; attempt = (attempt + 1) as 1 | 2) {
          throwIfProviderAborted(linked.signal);
          const attemptContent = attempt === 1 ? content : [
            ...content,
            {
              type: "input_text",
              text: `Correction request. Safe failure category: ${retryReason ?? "SCHEMA_INVALID"}. ${repairInstruction(retryReason)} Regenerate only the minimum intent DTO. Do not quote or discuss the previous response.`
            }
          ];
          const response = await this.jsonRequest("responses.create", `${this.baseUrl}/responses`, {
            method: "POST",
            body: JSON.stringify({
              model: ARK_V1_MODEL,
              max_output_tokens: 500,
              input: [{ role: "user", content: attemptContent }],
              text: {
                format: {
                  type: "json_schema",
                  name: "codemotion_ai_intent_v1",
                  strict: true,
                  schema
                }
              }
            }),
            headers: { "content-type": "application/json" }
          }, linked.signal, scope, ARK_V1_MODEL, undefined, undefined, attempt);
          usageRecords.push(usage(response.body, prepared.some((item) => item.input.modality === "audio")));
          try {
            const model = typeof response.body === "object" && response.body !== null && "model" in response.body
              ? response.body.model : undefined;
            if (model !== ARK_V1_MODEL) {
              throw new PlanningResponseError(
                "MODEL_MISMATCH",
                "Provider response model did not match the V1 model.",
                {},
                "security"
              );
            }
            const outputText = extractOutputText(response.body);
            let parsed: unknown;
            try {
              parsed = JSON.parse(outputText);
            } catch {
              throw new PlanningResponseError(
                "INVALID_JSON",
                "Model output was not valid JSON.",
                { outputCharacters: outputText.length }
              );
            }
            const intent = this.validateIntent(
              parsed,
              schema,
              new Set(effectCatalog.map((effect) => effect.effectId)),
              intentCandidates.expectedAddedText
            );
            const planned = buildDeterministicPlanStructure(request, planning, intent);
            const combinedUsage = usageRecords.reduce<UnderstandingResult["trace"]["usage"]>((total, item) => ({
              inputTokens: total.inputTokens + item.inputTokens,
              outputTokens: total.outputTokens + item.outputTokens,
              totalTokens: total.totalTokens + item.totalTokens,
              estimatedCostCny: {
                lowerBound: Number((total.estimatedCostCny.lowerBound + item.estimatedCostCny.lowerBound).toFixed(8)),
                upperBound: Number((total.estimatedCostCny.upperBound + item.estimatedCostCny.upperBound).toFixed(8)),
                pricingSource: item.estimatedCostCny.pricingSource,
                note: usageRecords.length > 1
                  ? "Estimate includes both bounded structured-generation attempts; actual billing prevails."
                  : item.estimatedCostCny.note
              }
            }), {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              estimatedCostCny: {
                lowerBound: 0,
                upperBound: 0,
                pricingSource: "https://www.volcengine.com/docs/82379/1544106",
                note: "No token usage was returned; zero is not a billing assertion."
              }
            });
            return {
              contract: "ai-task/v1",
              understanding: planned.understanding,
              storyboard: planned.storyboard,
              trace: {
                provider: this.id,
                modelId: ARK_V1_MODEL,
                requestFingerprint: response.requestFingerprint,
                inputHash: this.inputHash(request, prepared),
                latencyMs: Date.now() - started,
                usage: combinedUsage
              }
            };
          } catch (cause) {
            if (!(cause instanceof PlanningResponseError)) throw cause;
            this.audit?.({
              ...scope,
              endpoint: "responses.create",
              modelId: ARK_V1_MODEL,
              status: response.status,
              latencyMs: response.latencyMs,
              requestFingerprint: response.requestFingerprint,
              errorCode: cause.code,
              reason: cause.reason,
              attempt,
              safeCounts: cause.safeCounts
            });
            const repairable = cause.code === "provider_response"
              || cause.code === "security" && cause.reason === "ASSET_BINDING";
            if (!repairable || attempt === GENERATION_ATTEMPTS) {
              throw new ProviderError(cause.code, cause.message, { cause, reason: cause.reason });
            }
            retryReason = cause.reason;
            await providerDelay(GENERATION_RETRY_DELAY_MS, linked.signal);
          }
        }
        throw new ProviderError("provider_response", "Structured model output failed validation.");
      } finally {
        const cleanupSignal = AbortSignal.timeout(30_000);
        for (const localAssetId of remoteByLocalId.keys()) {
          emit(request.onProgress, { phase: "cleanup", localAssetId });
          try {
            await this.deleteRemote(localAssetId, remoteByLocalId, cleanupSignal, scope);
          } catch {
            // Cleanup failure is audited without exposing the remote identifier.
          }
        }
      }
    }, (result) => result.trace.usage.estimatedCostCny.upperBound);
    return operation.finally(() => linked.dispose());
  }

  private async prepareResource(
    input: LocalResourceInput,
    imported: VerifiedStoredMedia,
    signal: AbortSignal
  ): Promise<PreparedResource> {
    if (input.modality === "image" && imported.asset.type === "svg") {
      const proxyPath = imported.rasterProxyPath;
      const proxyHash = imported.asset.metadata.rasterProxyHash;
      if (imported.asset.metadata.sanitized !== true
        || proxyPath === undefined
        || typeof proxyHash !== "string"
        || !/^sha256:[a-f0-9]{64}$/i.test(proxyHash)) {
        throw new ProviderError("security", "SVG image input requires a verified sanitized PNG raster proxy.");
      }
      const bytes = await readFile(proxyPath, { signal });
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash !== proxyHash.slice(7).toLowerCase()) {
        throw new ProviderError("security", "SVG raster proxy failed transfer integrity verification.");
      }
      return {
        input,
        imported,
        transferPath: proxyPath,
        transferBytes: bytes.byteLength,
        transferMime: "image/png",
        transferHash: actualHash
      };
    }
    const hash = imported.asset.hash?.replace(/^sha256:/, "");
    const mime = imported.asset.metadata.mime;
    if (typeof hash !== "string" || typeof mime !== "string") {
      throw new ProviderError("security", "Verified media transfer metadata is incomplete.");
    }
    return {
      input,
      imported,
      transferPath: imported.storedPath,
      transferBytes: imported.trustedBytes,
      transferMime: mime,
      transferHash: hash
    };
  }

  private enforceLimits(resource: PreparedResource): void {
    const { input, imported } = resource;
    const bytes = resource.transferBytes;
    const duration = Number(imported.asset.metadata.duration ?? 0);
    const width = Number(imported.asset.metadata.width ?? 0);
    const height = Number(imported.asset.metadata.height ?? 0);
    const mime = resource.transferMime;
    if (!Number.isFinite(bytes) || bytes <= 0 || typeof mime !== "string") {
      throw new ProviderError("invalid_input", "Verified media metadata is incomplete.");
    }
    if (input.modality === "image" && (bytes > IMAGE_LIMIT || width > 8192 || height > 8192)) {
      throw new ProviderError("invalid_input", "Image exceeds the server-side size or dimension limit.");
    }
    if ((input.modality === "audio" || input.modality === "video") && bytes > FILES_LIMIT) {
      throw new ProviderError("invalid_input", "Ordinary Files API media exceeds 512 MB.");
    }
    if (duration < 0 || duration > 6 * 60 * 60) {
      throw new ProviderError("invalid_input", "Media duration exceeds the 6 hour server-side limit.");
    }
  }

  private async uploadAndWait(
    resource: PreparedResource,
    request: UnderstandingRequest,
    signal: AbortSignal,
    remoteByLocalId: Map<string, string>
  ): Promise<string> {
    const fields: Record<string, string> = { purpose: "user_data" };
    if (resource.input.modality === "video") {
      fields["preprocess_configs[video][model]"] = ARK_V1_MODEL;
      fields["preprocess_configs[video][fps]"] = String(resource.input.videoFps ?? 1);
    }
    const scope = auditScope(request.principal);
    const multipart = await multipartFileBody(
      resource.transferPath,
      resource.transferMime,
      fields,
      resource.transferBytes,
      signal,
      (loaded, total) => emit(request.onProgress, {
        phase: "upload",
        localAssetId: resource.input.localAssetId,
        loaded,
        total
      })
    );
    const created = await this.jsonRequest("files.create", `${this.baseUrl}/files`, {
      method: "POST",
      headers: {
        "content-type": multipart.contentType,
        "content-length": String(multipart.contentLength)
      },
      duplex: "half"
    } as RequestInit, signal, scope, undefined, resource.input.localAssetId, () => multipart.body() as never);
    let file = parseArkFile(created.body);
    remoteByLocalId.set(resource.input.localAssetId, file.id);
    while (file.status === PROCESSING) {
      emit(request.onProgress, { phase: "process", localAssetId: resource.input.localAssetId });
      await delay(this.processingPollMs, undefined, { signal });
      const retrieved = await this.jsonRequest(
        "files.retrieve",
        `${this.baseUrl}/files/${encodeURIComponent(file.id)}`,
        { method: "GET" },
        signal,
        scope,
        undefined,
        resource.input.localAssetId
      );
      file = parseArkFile(retrieved.body);
    }
    if (file.status !== ACTIVE) throw new ProviderError("provider_response", "Uploaded file did not become active.");
    return file.id;
  }

  private async deleteRemote(
    localAssetId: string,
    remoteByLocalId: Map<string, string>,
    signal: AbortSignal,
    scope: AuditScope
  ): Promise<void> {
    const remote = remoteByLocalId.get(localAssetId);
    if (!remote) return;
    try {
      const result = await this.jsonRequest(
        "files.delete",
        `${this.baseUrl}/files/${encodeURIComponent(remote)}`,
        { method: "DELETE" },
        signal,
        scope,
        undefined,
        localAssetId
      );
      const body = result.body as Record<string, unknown>;
      if (body.deleted !== true || body.object !== "file") {
        throw new ProviderError("provider_response", "Files API did not confirm deletion.");
      }
    } finally {
      remoteByLocalId.delete(localAssetId);
    }
  }

  private async jsonRequest(
    endpoint: ProviderAuditRecord["endpoint"],
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    scope: AuditScope,
    modelId?: typeof ARK_V1_MODEL,
    localAssetId?: string,
    bodyFactory?: () => NonNullable<RequestInit["body"]>,
    generationAttempt?: 1 | 2
  ): Promise<HttpResult> {
    let lastCause: unknown;
    const requestRetries = endpoint === "responses.create" ? 0 : this.maxRetries;
    for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
      const started = Date.now();
      try {
        const response = await this.fetchImpl(url, {
          ...init,
          ...(bodyFactory === undefined ? {} : { body: bodyFactory() }),
          headers: { authorization: `Bearer ${this.options.apiKey}`, ...init.headers },
          signal
        });
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          body = undefined;
        }
        const latencyMs = Date.now() - started;
        const fingerprint = requestFingerprint(response.headers, body);
        if (response.ok) {
          const publicBody = endpoint === "responses.create" ? stripResponseIdentifier(body) : body;
          this.audit?.({
            ...scope,
            endpoint,
            status: response.status,
            latencyMs,
            requestFingerprint: fingerprint,
            ...(modelId === undefined ? {} : { modelId }),
            ...(localAssetId === undefined ? {} : { localAssetId }),
            ...(generationAttempt === undefined ? {} : { attempt: generationAttempt })
          });
          return {
            status: response.status,
            body: publicBody,
            latencyMs,
            requestFingerprint: fingerprint
          };
        }
        const code = errorCode(response.status);
        this.audit?.({
          ...scope,
          endpoint,
          status: response.status,
          latencyMs,
          requestFingerprint: fingerprint,
          errorCode: code,
          ...(code === "provider_unavailable" ? { reason: "ARK_UNAVAILABLE" as const } : {}),
          ...(modelId === undefined ? {} : { modelId }),
          ...(localAssetId === undefined ? {} : { localAssetId }),
          ...(generationAttempt === undefined ? {} : { attempt: generationAttempt })
        });
        if (!isRetryable(response.status) || attempt === requestRetries) {
          throw new ProviderError(code, safeMessage(response.status), {
            retryable: isRetryable(response.status),
            status: response.status,
            ...(code === "provider_unavailable" ? { reason: "ARK_UNAVAILABLE" as const } : {})
          });
        }
      } catch (cause) {
        if (signal.aborted) {
          const reason = signal.reason;
          if (reason instanceof ProviderError) throw reason;
          throw new ProviderError("cancelled", "Provider request was cancelled.", { cause });
        }
        if (cause instanceof ProviderError && !cause.retryable) throw cause;
        lastCause = cause;
        if (attempt === requestRetries) {
          if (cause instanceof ProviderError) throw cause;
          throw new ProviderError("provider_unavailable", "Provider network request failed.", {
            retryable: true,
            cause,
            reason: "ARK_UNAVAILABLE"
          });
        }
      }
      await delay(250 * (2 ** attempt), undefined, { signal });
    }
    throw new ProviderError("provider_unavailable", "Provider network request failed.", {
      cause: lastCause,
      reason: "ARK_UNAVAILABLE"
    });
  }

  private validateIntent(
    value: unknown,
    schema: typeof MODEL_INTENT_JSON_SCHEMA,
    allowedEffectIds: ReadonlySet<string>,
    expectedAddedText: string | null
  ): ModelIntentDto {
    const rawEffectId = typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>).effectId
      : undefined;
    if (typeof rawEffectId === "string" && !allowedEffectIds.has(rawEffectId)) {
      throw new PlanningResponseError("EFFECT_ID_INVALID", "Model selected an effect outside the dynamic enum.");
    }
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(schema);
    if (!validate(value)) {
      throw new PlanningResponseError(
        "SCHEMA_INVALID",
        "Structured AI plan failed schema validation.",
        { validationErrors: validate.errors?.length ?? 0 }
      );
    }
    const intent = structuredClone(value) as ModelIntentDto;
    if (!allowedEffectIds.has(intent.effectId)) {
      throw new PlanningResponseError("EFFECT_ID_INVALID", "Model selected an effect outside the dynamic enum.");
    }
    const expectedKind = intentTargetKind(intent.effectId);
    if (intent.targetKind !== expectedKind) {
      throw new PlanningResponseError(
        expectedKind === "added-text" ? "TEXT_REQUIRED" : "SCHEMA_INVALID",
        "Model returned a target kind incompatible with the selected effect."
      );
    }
    if (expectedKind === "added-text" && (expectedAddedText === null || intent.addedText !== expectedAddedText)) {
      throw new PlanningResponseError("TEXT_REQUIRED", "Model omitted or changed the explicit new text.");
    }
    if (expectedKind === "visual" && intent.addedText !== null) {
      throw new PlanningResponseError("SCHEMA_INVALID", "Model returned unrequested added text.");
    }
    return intent;
  }

  private inputHash(request: UnderstandingRequest, resources: readonly PreparedResource[]): string {
    const hash = createHash("sha256");
    hash.update(request.prompt);
    for (const resource of [...resources].sort((a, b) => a.input.localAssetId.localeCompare(b.input.localAssetId))) {
      hash.update(resource.input.localAssetId);
      hash.update(resource.input.asset.hash ?? "");
      hash.update(resource.input.modality);
    }
    return `sha256:${hash.digest("hex")}`;
  }
}
