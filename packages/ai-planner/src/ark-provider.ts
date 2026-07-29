import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { verifyStoredMediaAsset, type VerifiedStoredMedia } from "@codemotion/exporter";
import {
  ARK_V1_MODEL,
  ProviderError,
  type LocalResourceInput,
  type ModelProvider,
  type NormalizedUnderstanding,
  type ProviderAuditRecord,
  type ProviderAuditSink,
  type ProviderErrorCode,
  type ProviderProgress,
  type UnderstandingRequest,
  type UnderstandingResult
} from "./provider.js";
import { STRUCTURE_INSTRUCTION, UNDERSTANDING_JSON_SCHEMA } from "./understanding-schema.js";
import { fingerprintProviderRequestId, sanitizeUserText } from "./security.js";

const DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const FILES_LIMIT = 512 * 1024 * 1024;
const IMAGE_LIMIT = 10 * 1024 * 1024;
const ACTIVE = "active";
const PROCESSING = "processing";

interface ArkProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly audit?: ProviderAuditSink;
  readonly fetchImpl?: typeof fetch;
  readonly maxConcurrency?: number;
  readonly requestsPerMinute?: number;
  readonly maxRetries?: number;
  readonly processingPollMs?: number;
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

interface PreparedResource {
  readonly input: LocalResourceInput;
  readonly imported: VerifiedStoredMedia;
}

class RequestGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly starts: number[] = [];

  constructor(private readonly concurrency: number, private readonly perMinute: number) {}

  async run<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    await this.enter(signal);
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }

  private async enter(signal: AbortSignal): Promise<void> {
    while (this.active >= this.concurrency) {
      await new Promise<void>((resolve, reject) => {
        const onAbort = (): void => reject(new ProviderError("cancelled", "Provider request was cancelled."));
        signal.addEventListener("abort", onAbort, { once: true });
        this.waiters.push(() => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        });
      });
    }
    const now = Date.now();
    while (this.starts[0] !== undefined && this.starts[0] <= now - 60_000) this.starts.shift();
    if (this.starts.length >= this.perMinute) {
      throw new ProviderError("rate_limited", "Server-side provider rate limit exceeded.", { retryable: true });
    }
    this.starts.push(now);
    this.active += 1;
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
    throw new ProviderError("provider_response", "Responses API returned an invalid response object.");
  }
  const root = body as Record<string, unknown>;
  if (typeof root.output_text === "string") return root.output_text;
  if (!Array.isArray(root.output)) throw new ProviderError("provider_response", "Responses API returned no output.");
  for (const output of root.output) {
    if (typeof output !== "object" || output === null || !("content" in output) || !Array.isArray(output.content)) continue;
    for (const content of output.content) {
      if (typeof content === "object" && content !== null && "type" in content
        && content.type === "output_text" && "text" in content && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  throw new ProviderError("provider_response", "Responses API returned no output text.");
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

function assertInput(request: UnderstandingRequest): void {
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
    if (resource.asset.type !== resource.modality) throw new ProviderError("invalid_input", "Resource modality and asset type disagree.");
    if (resource.videoFps !== undefined && (resource.modality !== "video"
      || resource.videoFps < 0.2 || resource.videoFps > 5)) {
      throw new ProviderError("invalid_input", "Video fps must be in [0.2, 5].");
    }
  }
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

  constructor(private readonly options: ArkProviderOptions) {
    if (options.apiKey.trim().length < 10) throw new ProviderError("authentication", "A server-side Ark API key is required.");
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.audit = options.audit;
    this.gate = new RequestGate(options.maxConcurrency ?? 4, options.requestsPerMinute ?? 20);
    this.maxRetries = options.maxRetries ?? 2;
    this.processingPollMs = options.processingPollMs ?? 2_000;
  }

  async understand(request: UnderstandingRequest): Promise<UnderstandingResult> {
    assertInput(request);
    const linked = combineSignal(request.signal, request.timeoutMs ?? 120_000);
    return this.gate.run(linked.signal, async () => {
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
          this.enforceLimits(input, imported);
          prepared.push({ input, imported });
        }
        const content: Array<Record<string, unknown>> = [{
          type: "input_text",
          text: `${STRUCTURE_INSTRUCTION}\nUser request: ${sanitizeUserText(request.prompt)}`
        }];
        for (const resource of prepared) {
          content.push({
            type: "input_text",
            text: `Direct ${resource.input.modality} input localAssetId: ${resource.input.localAssetId}`
          });
          if (resource.input.modality === "image") {
            const bytes = await readFile(resource.imported.storedPath, { signal: linked.signal });
            if (bytes.byteLength !== resource.imported.trustedBytes) {
              throw new ProviderError("security", "Verified image changed before request construction.");
            }
            if (bytes.byteLength > IMAGE_LIMIT) {
              throw new ProviderError("invalid_input", "Image exceeds the server-side size limit.");
            }
            const expectedHash = resource.input.asset.hash?.replace(/^sha256:/, "");
            const actualHash = createHash("sha256").update(bytes).digest("hex");
            if (expectedHash === undefined || actualHash !== expectedHash) {
              throw new ProviderError("security", "Verified image content changed before request construction.");
            }
            const mime = String(resource.input.asset.metadata.mime);
            content.push({ type: "input_image", image_url: `data:${mime};base64,${bytes.toString("base64")}` });
          } else {
            const remote = await this.uploadAndWait(resource, request, linked.signal, remoteByLocalId);
            content.push({
              type: resource.input.modality === "audio" ? "input_audio" : "input_video",
              file_id: remote
            });
          }
        }
        emit(request.onProgress, { phase: "infer" });
        const response = await this.jsonRequest("responses.create", `${this.baseUrl}/responses`, {
          method: "POST",
          body: JSON.stringify({
            model: ARK_V1_MODEL,
            input: [{ role: "user", content }],
            text: {
              format: {
                type: "json_schema",
                name: "codemotion_understanding",
                strict: true,
                schema: UNDERSTANDING_JSON_SCHEMA
              }
            }
          }),
          headers: { "content-type": "application/json" }
        }, linked.signal, ARK_V1_MODEL);
        const text = extractOutputText(response.body);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new ProviderError("provider_response", "Model output was not valid JSON.");
        }
        const understanding = this.validateUnderstanding(parsed, prepared);
        const model = typeof response.body === "object" && response.body !== null && "model" in response.body
          ? response.body.model : undefined;
        if (model !== ARK_V1_MODEL) throw new ProviderError("security", "Provider response model did not match the V1 model.");
        return {
          understanding,
          trace: {
            provider: this.id,
            modelId: ARK_V1_MODEL,
            requestFingerprint: response.requestFingerprint,
            inputHash: this.inputHash(request, prepared),
            latencyMs: Date.now() - started,
            usage: usage(response.body, prepared.some((item) => item.input.modality === "audio"))
          }
        };
      } finally {
        const cleanupSignal = AbortSignal.timeout(30_000);
        for (const localAssetId of remoteByLocalId.keys()) {
          emit(request.onProgress, { phase: "cleanup", localAssetId });
          try {
            await this.deleteRemote(localAssetId, remoteByLocalId, cleanupSignal);
          } catch {
            // Cleanup failure is audited without exposing the remote identifier.
          }
        }
        linked.dispose();
      }
    });
  }

  private enforceLimits(input: LocalResourceInput, imported: VerifiedStoredMedia): void {
    const bytes = imported.trustedBytes;
    const duration = Number(imported.asset.metadata.duration ?? 0);
    const width = Number(imported.asset.metadata.width ?? 0);
    const height = Number(imported.asset.metadata.height ?? 0);
    const mime = imported.asset.metadata.mime;
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
    const mime = String(resource.input.asset.metadata.mime);
    const multipart = await multipartFileBody(
      resource.imported.storedPath,
      mime,
      fields,
      resource.imported.trustedBytes,
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
    } as RequestInit, signal, undefined, resource.input.localAssetId, () => multipart.body() as never);
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
    signal: AbortSignal
  ): Promise<void> {
    const remote = remoteByLocalId.get(localAssetId);
    if (!remote) return;
    try {
      const result = await this.jsonRequest(
        "files.delete",
        `${this.baseUrl}/files/${encodeURIComponent(remote)}`,
        { method: "DELETE" },
        signal,
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
    modelId?: typeof ARK_V1_MODEL,
    localAssetId?: string,
    bodyFactory?: () => NonNullable<RequestInit["body"]>
  ): Promise<HttpResult> {
    let lastCause: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
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
            endpoint,
            status: response.status,
            latencyMs,
            requestFingerprint: fingerprint,
            ...(modelId === undefined ? {} : { modelId }),
            ...(localAssetId === undefined ? {} : { localAssetId })
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
          endpoint,
          status: response.status,
          latencyMs,
          requestFingerprint: fingerprint,
          errorCode: code,
          ...(modelId === undefined ? {} : { modelId }),
          ...(localAssetId === undefined ? {} : { localAssetId })
        });
        if (!isRetryable(response.status) || attempt === this.maxRetries) {
          throw new ProviderError(code, safeMessage(response.status), {
            retryable: isRetryable(response.status),
            status: response.status
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
        if (attempt === this.maxRetries) {
          if (cause instanceof ProviderError) throw cause;
          throw new ProviderError("provider_unavailable", "Provider network request failed.", {
            retryable: true,
            cause
          });
        }
      }
      await delay(250 * (2 ** attempt), undefined, { signal });
    }
    throw new ProviderError("provider_unavailable", "Provider network request failed.", { cause: lastCause });
  }

  private validateUnderstanding(value: unknown, resources: readonly PreparedResource[]): NormalizedUnderstanding {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(UNDERSTANDING_JSON_SCHEMA);
    if (!validate(value)) throw new ProviderError("provider_response", "Structured understanding failed schema validation.");
    const result = value as NormalizedUnderstanding;
    const expectedImages = resources.filter((item) => item.input.modality === "image").map((item) => item.input.localAssetId);
    const expectedAudio = resources.filter((item) => item.input.modality === "audio").map((item) => item.input.localAssetId);
    const expectedVideo = resources.filter((item) => item.input.modality === "video").map((item) => item.input.localAssetId);
    if (result.images.length !== expectedImages.length
      || result.audio.length !== expectedAudio.length
      || result.video.length !== expectedVideo.length) {
      throw new ProviderError("security", "Model output modality counts did not match the verified inputs.");
    }
    const images = result.images.map((image, index) => ({ ...image, localAssetId: expectedImages[index]! }));
    const audio = result.audio.map((item, index) => ({ ...item, localAssetId: expectedAudio[index]! }));
    const video = result.video.map((item, index) => ({ ...item, localAssetId: expectedVideo[index]! }));
    for (const item of video) {
      for (const shot of item.shots) {
        if (shot.range.end < shot.range.start) throw new ProviderError("provider_response", "Video time range is reversed.");
      }
    }
    return { ...result, images, audio, video };
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
