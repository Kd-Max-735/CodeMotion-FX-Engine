import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { VerifiedStoredMedia } from "@codemotion/exporter";
import { PNG } from "pngjs";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_MASK_PIXELS = 16_777_216;
const TARGET_PROMPT = /^[A-Za-z0-9][A-Za-z0-9 ,.'()/-]{0,79}$/u;

export interface Sam31MaskBinding {
  readonly version: "sam31-mask-v1";
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly score: number;
  readonly bbox: readonly [number, number, number, number];
}

export interface Sam31SegmentationOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly threshold?: number;
}

export type Sam31SegmentationErrorCode =
  | "invalid_input"
  | "unsupported_media"
  | "target_not_found"
  | "unavailable";

export class Sam31SegmentationError extends Error {
  constructor(
    readonly code: Sam31SegmentationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "Sam31SegmentationError";
  }
}

interface Sam31Detection {
  readonly score: number;
  readonly bbox: readonly [number, number, number, number];
  readonly maskBase64: string;
}

interface Sam3GatewayTask {
  readonly taskId: string;
  readonly status: "queued" | "provisioning" | "running" | "succeeded" | "failed";
  readonly result?: Record<string, unknown>;
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 192 && octets[1] === 168
    || octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31;
}

function checkedBaseUrl(value: string): URL {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const privateHost = hostname === "localhost" || hostname === "[::1]" || hostname === "::1"
    || isPrivateIpv4(hostname);
  if (url.protocol !== "http:" || !privateHost || url.username || url.password || url.search || url.hash
    || (url.pathname !== "/" && url.pathname !== "")) {
    throw new TypeError("SAM31_API_BASE_URL must be a private or loopback HTTP origin.");
  }
  url.pathname = "/";
  return url;
}

async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new Error("SAM31_RESPONSE_TOO_LARGE");
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("SAM31_RESPONSE_TOO_LARGE");
    }
    chunks.push(next.value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error("SAM3_GATEWAY_REQUEST_FAILED");
  const bytes = await boundedResponseBytes(response);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("SAM3_GATEWAY_RESPONSE_INVALID");
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function taskId(value: unknown): string | undefined {
  const record = objectValue(value);
  const id = record?.task_id;
  return typeof id === "string" && /^[A-Za-z0-9_-]{8,128}$/u.test(id) ? id : undefined;
}

function gatewayTask(value: unknown, expectedTaskId: string): Sam3GatewayTask | undefined {
  const record = objectValue(value);
  if (record === undefined) return undefined;
  const id = typeof record.id === "string"
    ? record.id
    : typeof record.task_id === "string" ? record.task_id : undefined;
  const status = record?.status;
  if (id !== expectedTaskId || typeof status !== "string"
    || !["queued", "provisioning", "running", "succeeded", "failed"].includes(status)) return undefined;
  const result = objectValue(record.result);
  return {
    taskId: id,
    status: status as Sam3GatewayTask["status"],
    ...(result === undefined ? {} : { result })
  };
}

async function waitForPoll(milliseconds: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const complete = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(complete, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function detection(value: unknown): Sam31Detection | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  const bbox = item.bbox_xyxy;
  const mask = item.mask_png_base64;
  if (typeof item.score !== "number" || !Number.isFinite(item.score) || item.score < 0 || item.score > 1
    || !Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(finiteCoordinate)
    || typeof mask !== "string" || mask.length === 0 || mask.length > MAX_RESPONSE_BYTES
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(mask)) return undefined;
  return {
    score: item.score,
    bbox: bbox as [number, number, number, number],
    maskBase64: mask
  };
}

function checkedPngDimensions(pngBytes: Uint8Array): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (pngBytes.byteLength < 24 || signature.some((value, index) => pngBytes[index] !== value)
    || String.fromCharCode(...pngBytes.subarray(12, 16)) !== "IHDR") {
    throw new Error("SAM31_MASK_INVALID");
  }
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width < 1 || height < 1 || width > MAX_MASK_PIXELS || height > MAX_MASK_PIXELS
    || width * height > MAX_MASK_PIXELS) {
    throw new Error("SAM31_MASK_DIMENSIONS_INVALID");
  }
}

function resizedMask(pngBytes: Uint8Array, width: number, height: number): Uint8Array {
  checkedPngDimensions(pngBytes);
  const decoded = PNG.sync.read(Buffer.from(pngBytes), { checkCRC: true });
  if (decoded.width < 1 || decoded.height < 1 || decoded.width * decoded.height > MAX_MASK_PIXELS) {
    throw new Error("SAM31_MASK_DIMENSIONS_INVALID");
  }
  const hasTransparency = decoded.data.some((value, index) => index % 4 === 3 && value < 250);
  const output = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(decoded.height - 1, Math.floor((y + 0.5) / height * decoded.height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(decoded.width - 1, Math.floor((x + 0.5) / width * decoded.width));
      const offset = (sourceY * decoded.width + sourceX) * 4;
      output[y * width + x] = hasTransparency
        ? decoded.data[offset + 3]!
        : Math.round(decoded.data[offset]! * 0.2126 + decoded.data[offset + 1]! * 0.7152
          + decoded.data[offset + 2]! * 0.0722);
    }
  }
  if (!output.some((value) => value >= 128)) throw new Error("SAM31_MASK_EMPTY");
  return output;
}

export class Sam31SegmentationService {
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #threshold: number;

  constructor(options: Sam31SegmentationOptions) {
    this.#baseUrl = checkedBaseUrl(options.baseUrl);
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = Math.max(1_000, Math.min(600_000, options.timeoutMs ?? 300_000));
    this.#pollIntervalMs = Math.max(100, Math.min(10_000, options.pollIntervalMs ?? 1_000));
    this.#threshold = Math.max(0.1, Math.min(0.95, options.threshold ?? 0.3));
  }

  async segment(
    media: VerifiedStoredMedia,
    target: string,
    width: number,
    height: number,
    signal?: AbortSignal
  ): Promise<Sam31MaskBinding> {
    if (!TARGET_PROMPT.test(target) || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 1 || height < 1 || width * height > MAX_MASK_PIXELS) {
      throw new Sam31SegmentationError("invalid_input", "SAM3 segmentation input is invalid.");
    }
    const mime = media.asset.metadata.mime;
    if (media.asset.type !== "image" || typeof mime !== "string"
      || !["image/png", "image/jpeg", "image/webp"].includes(mime)) {
      throw new Sam31SegmentationError(
        "unsupported_media",
        "SAM3 requires an authorized PNG, JPEG, or WebP image."
      );
    }
    const bytes = await readFile(media.storedPath, signal === undefined ? undefined : { signal });
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_SOURCE_BYTES) {
      throw new Sam31SegmentationError("invalid_input", "SAM3 source image size is invalid.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("SAM31_TIMEOUT")), this.#timeoutMs);
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const uploadBody = new FormData();
      uploadBody.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), basename(media.storedPath));
      const upload = objectValue(await boundedJson(await this.#fetch(new URL("api/uploads", this.#baseUrl), {
        method: "POST",
        body: uploadBody,
        signal: controller.signal,
        redirect: "error"
      })));
      const fileId = upload?.file_id;
      if (typeof fileId !== "string" || !/^[A-Za-z0-9._-]{8,192}$/u.test(fileId)) {
        throw new Error("SAM3_UPLOAD_RESPONSE_INVALID");
      }
      const submitted = await boundedJson(await this.#fetch(new URL("api/tasks", this.#baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "sam3",
          operation: "segment",
          inputs: { file_id: fileId, prompt: target, threshold: this.#threshold, include_masks: true }
        }),
        signal: controller.signal,
        redirect: "error"
      }));
      const submittedTaskId = taskId(submitted);
      if (submittedTaskId === undefined) throw new Error("SAM3_TASK_RESPONSE_INVALID");

      let completed: Sam3GatewayTask | undefined;
      while (completed === undefined) {
        const task = gatewayTask(await boundedJson(await this.#fetch(
          new URL(`api/tasks/${encodeURIComponent(submittedTaskId)}`, this.#baseUrl),
          { signal: controller.signal, redirect: "error" }
        )), submittedTaskId);
        if (task === undefined) throw new Error("SAM3_TASK_RESPONSE_INVALID");
        if (task.status === "failed") throw new Error("SAM3_TASK_FAILED");
        if (task.status === "succeeded") completed = task;
        else await waitForPoll(this.#pollIntervalMs, controller.signal);
      }
      const detections = completed.result?.detections;
      const candidates = Array.isArray(detections)
        ? detections.map(detection)
          .filter((item): item is Sam31Detection => item !== undefined)
        : [];
      const selected = candidates.sort((left, right) => right.score - left.score)[0];
      if (selected === undefined) throw new Error("SAM31_TARGET_NOT_FOUND");
      const maskBytes = Buffer.from(selected.maskBase64, "base64");
      if (maskBytes.byteLength < 1 || maskBytes.byteLength > MAX_RESPONSE_BYTES) {
        throw new Error("SAM31_MASK_INVALID");
      }
      return Object.freeze({
        version: "sam31-mask-v1" as const,
        width,
        height,
        data: resizedMask(maskBytes, width, height),
        score: selected.score,
        bbox: Object.freeze([...selected.bbox]) as readonly [number, number, number, number]
      });
    } catch (error) {
      if (signal?.aborted === true) throw signal.reason;
      if (error instanceof Sam31SegmentationError) throw error;
      if (error instanceof Error && error.message === "SAM31_TARGET_NOT_FOUND") {
        throw new Sam31SegmentationError(
          "target_not_found",
          "SAM3 could not find the requested visible target."
        );
      }
      throw new Sam31SegmentationError(
        "unavailable",
        "SAM3 segmentation service is unavailable or returned an invalid response."
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}

export function createSam31SegmentationService(
  env: NodeJS.ProcessEnv,
  fetchImpl?: typeof fetch
): Sam31SegmentationService {
  const threshold = Number(env.SAM3_THRESHOLD ?? env.SAM31_THRESHOLD ?? 0.3);
  const timeoutMs = Number(env.SAM3_TIMEOUT_MS ?? 300_000);
  const pollIntervalMs = Number(env.SAM3_POLL_INTERVAL_MS ?? 1_000);
  return new Sam31SegmentationService({
    baseUrl: env.SAM3_API_BASE_URL?.trim() || env.SAM31_API_BASE_URL?.trim()
      || "http://192.168.1.31:9100",
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
    threshold: Number.isFinite(threshold) ? threshold : 0.3,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 300_000,
    pollIntervalMs: Number.isFinite(pollIntervalMs) ? pollIntervalMs : 1_000
  });
}
