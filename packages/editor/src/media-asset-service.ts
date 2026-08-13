import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { finished } from "node:stream/promises";
import Busboy from "busboy";
import {
  OwnerMediaResolverError,
  TenantMediaStore,
  type MediaAssetPurpose,
  type OwnerContext,
  type TenantMediaRecord
} from "@codemotion/exporter";
import {
  AuthHttpError,
  type ApplicationScope,
  type AuthenticatedSessionPrincipal
} from "./auth-session-service.js";

export const MAX_UPLOAD_BODY_BYTES = 536_936_448;
export const MAX_MULTIPART_BOUNDARY_BYTES = 70;
export const MAX_PART_HEADER_BYTES = 8 * 1024;
export const MAX_COMBINED_HEADER_BYTES = 16 * 1024;
export const MAX_MULTIPART_BUFFER_BYTES = 64 * 1024;
const MAX_IMAGE_FILE_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_VIDEO_FILE_BYTES = 512 * 1024 * 1024;

export const UPLOAD_MIME_SUFFIX = Object.freeze({
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "audio/wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/flac": ".flac",
  "audio/ogg": ".ogg",
  "audio/aac": ".aac",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv"
} as const);

type CanonicalMime = keyof typeof UPLOAD_MIME_SUFFIX;
type BrowserMediaKind = "image" | "svg" | "audio" | "video";

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
  readonly allowedPurposes: readonly MediaAssetPurpose[];
}

export interface MediaAssetAuthorization {
  authorize(
    request: IncomingMessage,
    response: ServerResponse,
    scope: ApplicationScope,
    stateChanging?: boolean
  ): Promise<AuthenticatedSessionPrincipal>;
}

export interface MediaAssetServiceOptions {
  readonly store: TenantMediaStore;
  readonly auth: MediaAssetAuthorization;
  readonly uploadTempRoot: string;
  readonly cursorSecret: Uint8Array;
  readonly now?: () => number;
  readonly bodyBytes?: number;
  readonly observeMultipartBufferBytes?: (bytes: number) => void;
  readonly observeMultipartBufferSnapshot?: (snapshot: MultipartBufferSnapshot) => void;
  readonly observeMultipartPumpSliceBytes?: (bytes: number) => void;
  readonly observeMultipartRequestReadBytes?: (bytes: number) => void;
  readonly createUploadWriteStream?: (path: string) => Writable;
  readonly isAssetInUse?: (owner: OwnerContext, assetId: string) => boolean | Promise<boolean>;
}

export interface MultipartBufferSnapshot {
  readonly sourceViewBytes: number;
  readonly sourceBackingBytes: number;
  readonly sourceBackingCount: number;
  readonly guardPending: number;
  readonly guardPendingView: number;
  readonly guardPendingBacking: number;
  readonly guardReplacementBackingBytes: number;
  readonly guardRetiredBackingBytes: number;
  readonly guardReadable: 0;
  readonly parserWritable: number;
  readonly parserReservedBytes: number;
  readonly fileReadable: number;
  readonly fileReservedBytes: number;
  readonly outputWritable: number;
  readonly outputReservedBytes: number;
  readonly pumpSlice: number;
  readonly pumpSliceView: number;
  readonly pumpSliceBacking: number;
  readonly inFlight: number;
  readonly inFlightView: number;
  readonly inFlightBacking: number;
  readonly reservedParserBytes: number;
  readonly middlewareActualBackingBytes: number;
  readonly middlewareActualBackingCount: number;
  readonly middlewareReservedBytes: number;
  readonly P: number;
  readonly R: number;
  readonly total: number;
}

class MediaHttpError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 415 | 422 | 429 | 499 | 500 | 503,
    readonly code: string,
    message: string
  ) { super(message); }
}

interface RawPart {
  readonly name: "file" | "purpose";
  readonly filename?: string;
  readonly mime?: CanonicalMime;
}

function multipartError(status: 400 | 413 | 415, code: string): MediaHttpError {
  const messages = {
    MALFORMED_MULTIPART: "The multipart upload is malformed.",
    PAYLOAD_TOO_LARGE: "The upload exceeds an allowed limit.",
    UNSUPPORTED_MEDIA_TYPE: "The uploaded media type is not supported."
  } as const;
  return new MediaHttpError(status, code, messages[code as keyof typeof messages]);
}

function parseBoundary(contentType: string | undefined): string {
  if (contentType === undefined) throw multipartError(400, "MALFORMED_MULTIPART");
  const match = /^multipart\/form-data;[ \t]*boundary=(?:"([\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]{1,70})"|([\x21-\x2b\x2d-\x39\x3b-\x7e]{1,70}))$/i.exec(contentType);
  if (match === null) {
    const raw = /boundary=(?:"([^"]*)"|([^;\s]*))/i.exec(contentType)?.[1]
      ?? /boundary=(?:"([^"]*)"|([^;\s]*))/i.exec(contentType)?.[2];
    if (raw !== undefined && Buffer.byteLength(raw, "utf8") > MAX_MULTIPART_BOUNDARY_BYTES) {
      throw multipartError(413, "PAYLOAD_TOO_LARGE");
    }
    throw multipartError(400, "MALFORMED_MULTIPART");
  }
  return match[1] ?? match[2]!;
}

function splitDisposition(value: string): Map<string, string> {
  const segments: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index];
    if (escaped) escaped = false;
    else if (character === "\\" && quoted) escaped = true;
    else if (character === "\"") quoted = !quoted;
    else if ((character === ";" && !quoted) || index === value.length) {
      segments.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quoted || escaped || segments.shift()?.toLowerCase() !== "form-data") {
    throw multipartError(400, "MALFORMED_MULTIPART");
  }
  const parameters = new Map<string, string>();
  for (const segment of segments) {
    const match = /^([A-Za-z0-9!#$%&'*+.^_`|~-]+)="((?:[^"\\]|\\["\\])*)"$/.exec(segment);
    if (match === null) throw multipartError(400, "MALFORMED_MULTIPART");
    const key = match[1]!.toLowerCase();
    if (parameters.has(key)) throw multipartError(400, "MALFORMED_MULTIPART");
    parameters.set(key, match[2]!.replace(/\\(["\\])/g, "$1"));
  }
  return parameters;
}

function canonicalMime(value: string): CanonicalMime {
  if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(value)) {
    throw multipartError(415, "UNSUPPORTED_MEDIA_TYPE");
  }
  const normalized = value.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(UPLOAD_MIME_SUFFIX, normalized)) {
    throw multipartError(415, "UNSUPPORTED_MEDIA_TYPE");
  }
  return normalized as CanonicalMime;
}

function parseRawPart(block: Buffer): RawPart {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(block); }
  catch { throw multipartError(400, "MALFORMED_MULTIPART"); }
  const headers = new Map<string, string>();
  for (const line of text.split("\r\n")) {
    if (/^[ \t]/.test(line)) throw multipartError(400, "MALFORMED_MULTIPART");
    const separator = line.indexOf(":");
    if (separator <= 0) throw multipartError(400, "MALFORMED_MULTIPART");
    const name = line.slice(0, separator).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name)) throw multipartError(400, "MALFORMED_MULTIPART");
    if (headers.has(name)) {
      if (name === "content-type") throw multipartError(415, "UNSUPPORTED_MEDIA_TYPE");
      throw multipartError(400, "MALFORMED_MULTIPART");
    }
    headers.set(name, line.slice(separator + 1).trim());
  }
  if (headers.has("content-transfer-encoding")) throw multipartError(400, "MALFORMED_MULTIPART");
  const disposition = headers.get("content-disposition");
  if (disposition === undefined) throw multipartError(400, "MALFORMED_MULTIPART");
  const parameters = splitDisposition(disposition);
  const name = parameters.get("name");
  if (name === "file") {
    if (parameters.size !== 2 || !parameters.has("filename")) throw multipartError(400, "MALFORMED_MULTIPART");
    const filename = parameters.get("filename")!;
    const filenameBytes = Buffer.byteLength(filename, "utf8");
    if (filenameBytes > 255) throw multipartError(413, "PAYLOAD_TOO_LARGE");
    if (filenameBytes === 0 || /[\u0000\r\n/\\]/.test(filename)) throw multipartError(400, "MALFORMED_MULTIPART");
    const mediaType = headers.get("content-type");
    if (mediaType === undefined) throw multipartError(415, "UNSUPPORTED_MEDIA_TYPE");
    if (mediaType.toLowerCase().startsWith("multipart/")) throw multipartError(400, "MALFORMED_MULTIPART");
    return { name: "file", filename, mime: canonicalMime(mediaType) };
  }
  if (name === "purpose") {
    if (parameters.size !== 1) throw multipartError(400, "MALFORMED_MULTIPART");
    if (headers.get("content-type")?.toLowerCase().startsWith("multipart/")) {
      throw multipartError(400, "MALFORMED_MULTIPART");
    }
    return { name: "purpose" };
  }
  throw multipartError(400, "MALFORMED_MULTIPART");
}

class MultipartProtocolGuard {
  private pending: Buffer<ArrayBuffer> = Buffer.allocUnsafeSlow(0);
  private state: "start" | "headers" | "body" | "after-boundary" | "closed" = "start";
  private readonly opening: Buffer;
  private readonly marker: Buffer;
  private readonly crlf: Buffer;
  private headerBytes = 0;
  private readonly parts: RawPart[] = [];

  constructor(boundary: string) {
    this.opening = exactAscii(`--${boundary}\r\n`);
    this.marker = exactAscii(`\r\n--${boundary}`);
    this.crlf = exactAscii("\r\n");
  }

  takePart(): RawPart | undefined { return this.parts.shift(); }

  get bufferedBytes(): number { return this.pending.byteLength; }
  get bufferedAllocationBytes(): number { return this.pending.buffer.byteLength; }
  get bufferedBuffer(): Buffer { return this.pending; }
  get retainedBuffers(): readonly Buffer[] { return [this.pending, this.opening, this.marker, this.crlf]; }

  accept(chunk: Buffer, budget: MultipartBufferBudget): void { this.inspect(chunk, budget); }

  finish(budget: MultipartBufferBudget): void {
    this.inspect(Buffer.alloc(0), budget, true);
    if (this.state !== "closed" || (this.pending.length !== 0 && !this.pending.equals(this.crlf))) {
      throw multipartError(400, "MALFORMED_MULTIPART");
    }
  }

  private inspect(chunk: Buffer, budget: MultipartBufferBudget, final = false): void {
    this.replacePending([this.pending, chunk], budget);
    this.assertPendingLimit();
    while (true) {
      if (this.state === "start") {
        if (this.pending.length < this.opening.length && !final) return;
        if (!this.pending.subarray(0, this.opening.length).equals(this.opening)) throw multipartError(400, "MALFORMED_MULTIPART");
        this.replacePending([this.pending.subarray(this.opening.length)], budget);
        this.state = "headers";
      } else if (this.state === "headers") {
        const end = this.pending.indexOf("\r\n\r\n");
        if (end < 0) {
          if (this.pending.length > MAX_PART_HEADER_BYTES) throw multipartError(413, "PAYLOAD_TOO_LARGE");
          return;
        }
        if (end > MAX_PART_HEADER_BYTES) throw multipartError(413, "PAYLOAD_TOO_LARGE");
        this.headerBytes += end;
        if (this.headerBytes > MAX_COMBINED_HEADER_BYTES) throw multipartError(413, "PAYLOAD_TOO_LARGE");
        if (this.parts.length >= 2) throw multipartError(400, "MALFORMED_MULTIPART");
        const part = parseRawPart(this.pending.subarray(0, end));
        if (this.parts.some((existing) => existing.name === part.name)) throw multipartError(400, "MALFORMED_MULTIPART");
        this.parts.push(part);
        this.replacePending([this.pending.subarray(end + 4)], budget);
        this.state = "body";
      } else if (this.state === "body") {
        const end = this.pending.indexOf(this.marker);
        if (end < 0) {
          const retain = Math.min(this.pending.length, this.marker.length - 1);
          this.replacePending([this.pending.subarray(this.pending.length - retain)], budget);
          return;
        }
        this.replacePending([this.pending.subarray(end + this.marker.length)], budget);
        this.state = "after-boundary";
      } else if (this.state === "after-boundary") {
        if (this.pending.length < 2) return;
        const ending = this.pending.subarray(0, 2).toString("ascii");
        this.replacePending([this.pending.subarray(2)], budget);
        if (ending === "--") this.state = "closed";
        else if (ending === "\r\n") this.state = "headers";
        else throw multipartError(400, "MALFORMED_MULTIPART");
      } else {
        if (this.pending.length > 2 || (this.pending.length > 0 && !this.crlf.subarray(0, this.pending.length).equals(this.pending))) {
          throw multipartError(400, "MALFORMED_MULTIPART");
        }
        return;
      }
    }
  }

  private assertPendingLimit(): void {
    if (this.pending.byteLength > MAX_MULTIPART_BUFFER_BYTES) {
      throw multipartError(413, "PAYLOAD_TOO_LARGE");
    }
  }

  private replacePending(parts: readonly Uint8Array[], budget: MultipartBufferBudget): void {
    const previous = this.pending;
    const bytes = parts.reduce((total, part) => total + part.byteLength, 0);
    const compact = budget.allocateGuardReplacement(bytes);
    try {
      let offset = 0;
      for (const part of parts) {
        compact.set(part, offset);
        offset += part.byteLength;
      }
      this.pending = compact;
      budget.adoptGuardReplacement(compact, previous);
    } catch (cause) {
      budget.discardGuardReplacement(compact);
      throw cause;
    }
  }
}

function exactAscii(value: string): Buffer<ArrayBuffer> {
  const result = Buffer.allocUnsafeSlow(Buffer.byteLength(value, "ascii"));
  result.write(value, "ascii");
  return result;
}

const MULTIPART_PUMP_SLICE_BYTES = 4 * 1024;
const RESERVED_PARSER_BYTES = MAX_PART_HEADER_BYTES + MAX_MULTIPART_BOUNDARY_BYTES
  + 8;

function uniqueBackings(values: readonly (ArrayBufferView | undefined)[]): { readonly bytes: number; readonly count: number } {
  const identities = new Set<ArrayBufferLike>();
  for (const value of values) {
    if (value !== undefined) identities.add(value.buffer);
  }
  let total = 0;
  for (const backing of identities) total += backing.byteLength;
  return { bytes: total, count: identities.size };
}

class MultipartBufferBudget {
  fileStream: Readable | undefined;
  output: Writable | undefined;
  private source: Buffer | undefined;
  private pumpSlice: Buffer | undefined;
  private inFlight: Buffer | undefined;
  private guardReplacement: Buffer | undefined;
  private guardRetired: Buffer | undefined;

  constructor(
    private readonly guard: MultipartProtocolGuard,
    private readonly parser: Writable,
    private readonly observeTotal: ((bytes: number) => void) | undefined,
    private readonly observeSnapshot: ((snapshot: MultipartBufferSnapshot) => void) | undefined
  ) {}

  setSource(value: Buffer): void {
    if (this.source !== undefined) throw new Error("Multipart source ownership overlap.");
    this.source = value;
    try { this.assertWithinLimit(); }
    catch (cause) { this.source = undefined; throw cause; }
  }

  clearSource(): void {
    this.source = undefined;
    this.assertWithinLimit();
  }

  copySourceToPump(value: Buffer): Buffer<ArrayBuffer> {
    this.assertCanAllocateMiddleware(value.byteLength);
    const compact = Buffer.allocUnsafeSlow(value.byteLength);
    this.pumpSlice = compact;
    this.assertWithinLimit();
    compact.set(value);
    this.assertWithinLimit();
    return compact;
  }

  clearPumpSlice(): void {
    this.pumpSlice = undefined;
    this.assertWithinLimit();
  }

  setInFlight(value: Buffer | undefined): void {
    this.inFlight = value;
    this.assertWithinLimit();
  }

  setTransferStreams(stream: Readable, output: Writable): void {
    this.fileStream = stream;
    this.output = output;
    this.assertWithinLimit();
  }

  clearTransferStreams(): void {
    this.fileStream = undefined;
    this.output = undefined;
    this.assertWithinLimit();
  }

  allocateGuardReplacement(bytes: number): Buffer<ArrayBuffer> {
    this.guardRetired = undefined;
    this.assertCanAllocateMiddleware(bytes);
    const compact = Buffer.allocUnsafeSlow(bytes);
    this.guardReplacement = compact;
    this.assertWithinLimit();
    return compact;
  }

  adoptGuardReplacement(value: Buffer, retired: Buffer): void {
    if (this.guardReplacement?.buffer !== value.buffer) throw new Error("Multipart guard allocation ownership mismatch.");
    this.guardRetired = retired;
    this.assertWithinLimit();
    this.guardReplacement = undefined;
    this.assertWithinLimit();
  }

  discardGuardReplacement(value: Buffer): void {
    if (this.guardReplacement?.buffer === value.buffer) this.guardReplacement = undefined;
  }

  releaseGuardRetired(): void {
    this.guardRetired = undefined;
    this.assertWithinLimit();
  }

  sample(): MultipartBufferSnapshot {
    const sourceBackings = uniqueBackings([this.source]);
    const middlewareBackings = uniqueBackings([
      ...this.guard.retainedBuffers,
      this.guardReplacement,
      this.guardRetired,
      this.pumpSlice,
      this.inFlight
    ]);
    const parserReservedBytes = Math.max(this.parser.writableHighWaterMark, MULTIPART_PUMP_SLICE_BYTES);
    const fileReservedBytes = (this.fileStream?.readableHighWaterMark ?? MULTIPART_PUMP_SLICE_BYTES)
      + MULTIPART_PUMP_SLICE_BYTES;
    const outputReservedBytes = this.output === undefined
      ? 0
      : Math.max(this.output.writableHighWaterMark, MULTIPART_PUMP_SLICE_BYTES);
    const middlewareReservedBytes = RESERVED_PARSER_BYTES + parserReservedBytes + fileReservedBytes + outputReservedBytes;
    const P = middlewareBackings.bytes + middlewareReservedBytes;
    const R = sourceBackings.bytes + P;
    const snapshot: MultipartBufferSnapshot = {
      sourceViewBytes: this.source?.byteLength ?? 0,
      sourceBackingBytes: sourceBackings.bytes,
      sourceBackingCount: sourceBackings.count,
      guardPending: this.guard.bufferedAllocationBytes,
      guardPendingView: this.guard.bufferedBytes,
      guardPendingBacking: this.guard.bufferedAllocationBytes,
      guardReplacementBackingBytes: this.guardReplacement?.buffer.byteLength ?? 0,
      guardRetiredBackingBytes: this.guardRetired?.buffer.byteLength ?? 0,
      guardReadable: 0,
      parserWritable: this.parser.writableLength,
      parserReservedBytes,
      fileReadable: this.fileStream?.readableLength ?? 0,
      fileReservedBytes,
      outputWritable: this.output?.writableLength ?? 0,
      outputReservedBytes,
      pumpSlice: this.pumpSlice?.buffer.byteLength ?? 0,
      pumpSliceView: this.pumpSlice?.byteLength ?? 0,
      pumpSliceBacking: this.pumpSlice?.buffer.byteLength ?? 0,
      inFlight: this.inFlight?.buffer.byteLength ?? 0,
      inFlightView: this.inFlight?.byteLength ?? 0,
      inFlightBacking: this.inFlight?.buffer.byteLength ?? 0,
      reservedParserBytes: RESERVED_PARSER_BYTES,
      middlewareActualBackingBytes: middlewareBackings.bytes,
      middlewareActualBackingCount: middlewareBackings.count,
      middlewareReservedBytes,
      P,
      R,
      total: P
    };
    this.observeTotal?.(P);
    this.observeSnapshot?.(snapshot);
    return snapshot;
  }

  assertWithinLimit(): MultipartBufferSnapshot {
    const snapshot = this.sample();
    if (snapshot.sourceBackingBytes > MAX_MULTIPART_BUFFER_BYTES
      || snapshot.P > MAX_MULTIPART_BUFFER_BYTES
      || snapshot.R > 2 * MAX_MULTIPART_BUFFER_BYTES) {
      throw multipartError(413, "PAYLOAD_TOO_LARGE");
    }
    return snapshot;
  }

  private assertCanAllocateMiddleware(bytes: number): void {
    const snapshot = this.assertWithinLimit();
    if (snapshot.P + bytes > MAX_MULTIPART_BUFFER_BYTES
      || snapshot.R + bytes > 2 * MAX_MULTIPART_BUFFER_BYTES) {
      throw multipartError(413, "PAYLOAD_TOO_LARGE");
    }
  }

  async readAllowance(maxBytes: number, signal: AbortSignal): Promise<number> {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const room = MAX_MULTIPART_BUFFER_BYTES - this.assertWithinLimit().P;
      const allowed = Math.min(maxBytes, room);
      if (allowed > 0) return allowed;
      await this.waitForProgress(signal);
    }
  }

  private async waitForProgress(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const file = this.fileStream;
      const output = this.output;
      let settled = false;
      const cleanup = (): void => {
        this.parser.off("drain", progressed);
        this.parser.off("close", closed);
        this.parser.off("error", failed);
        file?.off("readable", progressed);
        file?.off("end", progressed);
        file?.off("close", progressed);
        file?.off("error", failed);
        output?.off("drain", progressed);
        output?.off("finish", progressed);
        output?.off("close", progressed);
        output?.off("error", failed);
        signal.removeEventListener("abort", aborted);
      };
      const settle = (complete: () => void): void => {
        if (settled) return;
        settled = true;
        cleanup();
        complete();
      };
      const progressed = (): void => settle(resolve);
      const closed = (): void => settle(() => reject(new Error("Multipart parser closed before completion.")));
      const failed = (error: Error): void => settle(() => reject(error));
      const aborted = (): void => settle(() => reject(signal.reason));
      this.parser.once("drain", progressed);
      this.parser.once("close", closed);
      this.parser.once("error", failed);
      file?.once("readable", progressed);
      file?.once("end", progressed);
      file?.once("close", progressed);
      file?.once("error", failed);
      output?.once("drain", progressed);
      output?.once("finish", progressed);
      output?.once("close", progressed);
      output?.once("error", failed);
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
    });
  }
}

async function waitForParserDrain(parser: Writable, budget: MultipartBufferBudget, signal: AbortSignal): Promise<void> {
  if (!parser.writableNeedDrain) {
    budget.assertWithinLimit();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      parser.off("drain", drained);
      parser.off("close", closed);
      parser.off("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const checked = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try { budget.assertWithinLimit(); complete(); }
      catch (cause) { reject(cause); }
    };
    const drained = (): void => checked(resolve);
    const closed = (): void => checked(() => reject(new Error("Multipart parser closed before completion.")));
    const failed = (error: Error): void => checked(() => reject(error));
    const aborted = (): void => checked(() => reject(signal.reason));
    parser.once("drain", drained);
    parser.once("close", closed);
    parser.once("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

async function waitForRequestReadable(
  request: IncomingMessage,
  budget: MultipartBufferBudget,
  signal: AbortSignal
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      request.off("readable", ready);
      request.off("end", ready);
      request.off("aborted", aborted);
      request.off("close", closed);
      request.off("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const checked = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try { budget.assertWithinLimit(); complete(); }
      catch (cause) { reject(cause); }
    };
    const ready = (): void => checked(resolve);
    const closed = (): void => checked(() => reject(new Error("Upload request closed before completion.")));
    const failed = (error: Error): void => checked(() => reject(error));
    const aborted = (): void => checked(() => reject(signal.reason));
    request.once("readable", ready);
    request.once("end", ready);
    request.once("aborted", aborted);
    request.once("close", closed);
    request.once("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

async function writeFileChunk(
  output: Writable,
  value: Buffer,
  budget: MultipartBufferBudget,
  signal: AbortSignal
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      output.off("close", closed);
      output.off("error", failed);
      signal.removeEventListener("abort", aborted);
    };
    const checked = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      try { budget.assertWithinLimit(); complete(); }
      catch (cause) { reject(cause); }
    };
    const completed = (error?: Error | null): void => error === undefined || error === null
      ? checked(resolve)
      : checked(() => reject(error));
    const closed = (): void => checked(() => reject(new Error("Upload output closed before completion.")));
    const failed = (error: Error): void => checked(() => reject(error));
    const aborted = (): void => checked(() => reject(signal.reason));
    output.once("close", closed);
    output.once("error", failed);
    signal.addEventListener("abort", aborted, { once: true });
    try {
      output.write(value, completed);
      budget.assertWithinLimit();
    } catch (cause) {
      cleanup();
      reject(cause);
    }
  });
}

async function transferFile(
  stream: Readable,
  output: Writable,
  cap: number,
  budget: MultipartBufferBudget,
  signal: AbortSignal
): Promise<void> {
  let fileBytes = 0;
  budget.setTransferStreams(stream, output);
  const stop = (): void => {
    budget.sample();
    const reason = signal.reason instanceof Error ? signal.reason : new Error("Upload was stopped.");
    stream.destroy(reason);
    output.destroy(reason);
    budget.sample();
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    for await (const raw of stream) {
      if (signal.aborted) throw signal.reason;
      budget.assertWithinLimit();
      const chunk = raw as Buffer;
      for (let offset = 0; offset < chunk.byteLength; offset += MULTIPART_PUMP_SLICE_BYTES) {
        const source = chunk.subarray(offset, Math.min(offset + MULTIPART_PUMP_SLICE_BYTES, chunk.byteLength));
        budget.setInFlight(source);
        fileBytes += source.byteLength;
        if (fileBytes > cap) throw multipartError(413, "PAYLOAD_TOO_LARGE");
        budget.assertWithinLimit();
        await writeFileChunk(output, source, budget, signal);
        budget.setInFlight(undefined);
        budget.assertWithinLimit();
      }
    }
    output.end();
    await finished(output);
    budget.assertWithinLimit();
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error("Upload transfer failed.");
    stream.destroy(error);
    output.destroy(error);
    await Promise.all([finished(stream).catch(() => undefined), finished(output).catch(() => undefined)]);
    throw cause;
  } finally {
    signal.removeEventListener("abort", stop);
    budget.setInFlight(undefined);
    budget.clearTransferStreams();
  }
}

function pullRequestSourceSlice(
  request: IncomingMessage,
  size: number,
  budget: MultipartBufferBudget,
  observeRead: ((bytes: number) => void) | undefined
): Buffer | null {
  let source = request.read(size) as Buffer | null;
  if (source === null) return null;
  if (source.byteLength > size) throw multipartError(413, "PAYLOAD_TOO_LARGE");
  budget.setSource(source);
  observeRead?.(source.byteLength);
  return source;
}

function deliverRequestSlice(
  value: Buffer,
  parser: Writable,
  guard: MultipartProtocolGuard,
  budget: MultipartBufferBudget,
  observeSlice: ((bytes: number) => void) | undefined
): { readonly delivered: number; readonly accepted: boolean } {
  observeSlice?.(value.byteLength);
  try {
    budget.assertWithinLimit();
    guard.accept(value, budget);
    budget.releaseGuardRetired();
    budget.assertWithinLimit();
    const accepted = parser.write(value);
    return { delivered: value.byteLength, accepted };
  } finally {
    budget.releaseGuardRetired();
    budget.clearPumpSlice();
  }
}

async function pumpMultipartInput(
  request: IncomingMessage,
  parser: Writable,
  guard: MultipartProtocolGuard,
  budget: MultipartBufferBudget,
  bodyLimit: number,
  observeSlice: ((bytes: number) => void) | undefined,
  observeRead: ((bytes: number) => void) | undefined,
  signal: AbortSignal
): Promise<void> {
  let bodyBytes = 0;
  request.pause();
  try {
    while (!request.readableEnded) {
      if (signal.aborted) throw signal.reason;
      const remaining = bodyLimit - bodyBytes;
      if (remaining === 0) {
        if (request.readableLength > 0) throw multipartError(413, "PAYLOAD_TOO_LARGE");
        await waitForRequestReadable(request, budget, signal);
        continue;
      }
      if (request.readableLength === 0) {
        await waitForRequestReadable(request, budget, signal);
        continue;
      }
      const maximum = Math.min(MULTIPART_PUMP_SLICE_BYTES, request.readableLength, remaining);
      const allowed = await budget.readAllowance(maximum, signal);
      let source = pullRequestSourceSlice(request, allowed, budget, observeRead);
      if (source === null) continue;
      let value: Buffer<ArrayBuffer>;
      try {
        value = budget.copySourceToPump(source);
      } finally {
        source = null;
        budget.clearSource();
      }
      const result = deliverRequestSlice(value, parser, guard, budget, observeSlice);
      bodyBytes += result.delivered;
      if (!result.accepted) await waitForParserDrain(parser, budget, signal);
    }
    guard.finish(budget);
    budget.releaseGuardRetired();
    budget.assertWithinLimit();
    parser.end();
    await finished(parser);
    budget.assertWithinLimit();
  } catch (cause) {
    budget.clearPumpSlice();
    request.pause();
    if (!parser.destroyed) parser.destroy(cause instanceof Error ? cause : multipartError(400, "MALFORMED_MULTIPART"));
    throw cause;
  }
}

class UploadRateLimiter {
  private readonly userConcurrent = new Map<string, number>();
  private readonly tenantConcurrent = new Map<string, number>();
  private readonly userStarts = new Map<string, number[]>();
  private readonly tenantStarts = new Map<string, number[]>();
  constructor(private readonly now: () => number) {}

  acquire(owner: OwnerContext): () => void {
    const user = JSON.stringify([owner.tenantId, owner.userId]);
    const tenant = owner.tenantId;
    const now = this.now();
    const userStarts = (this.userStarts.get(user) ?? []).filter((time) => time > now - 60_000);
    const tenantStarts = (this.tenantStarts.get(tenant) ?? []).filter((time) => time > now - 60_000);
    if ((this.userConcurrent.get(user) ?? 0) >= 2 || (this.tenantConcurrent.get(tenant) ?? 0) >= 8
      || userStarts.length >= 10 || tenantStarts.length >= 60) {
      throw new MediaHttpError(429, "UPLOAD_RATE_LIMITED", "The upload rate limit was reached.");
    }
    userStarts.push(now); tenantStarts.push(now);
    this.userStarts.set(user, userStarts); this.tenantStarts.set(tenant, tenantStarts);
    this.userConcurrent.set(user, (this.userConcurrent.get(user) ?? 0) + 1);
    this.tenantConcurrent.set(tenant, (this.tenantConcurrent.get(tenant) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.userConcurrent.set(user, Math.max(0, (this.userConcurrent.get(user) ?? 1) - 1));
      this.tenantConcurrent.set(tenant, Math.max(0, (this.tenantConcurrent.get(tenant) ?? 1) - 1));
    };
  }
}

function ownerOf(principal: AuthenticatedSessionPrincipal): OwnerContext {
  return { tenantId: principal.tenantId, userId: principal.userId };
}

function fileLimit(mime: CanonicalMime, store: TenantMediaStore): number {
  if (mime.startsWith("image/")) return Math.min(MAX_IMAGE_FILE_BYTES, store.limits.imageBytes);
  if (mime.startsWith("audio/")) return Math.min(MAX_AUDIO_VIDEO_FILE_BYTES, store.limits.audioBytes);
  return Math.min(MAX_AUDIO_VIDEO_FILE_BYTES, store.limits.videoBytes);
}

function displayName(filename: string): string {
  const cleaned = [...filename.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "")].slice(0, 128).join("").trim();
  return cleaned || "upload";
}

function summary(record: TenantMediaRecord): BrowserAssetSummaryV1 {
  const metadata = record.imported.asset.metadata;
  const number = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const result: BrowserAssetSummaryV1 = {
    assetId: record.imported.asset.id,
    displayName: record.displayName,
    kind: record.imported.asset.type as BrowserMediaKind,
    mime: String(metadata.mime),
    codec: String(metadata.codec),
    bytes: number(metadata.bytes) ?? 0,
    uploadedAt: record.uploadedAt,
    allowedPurposes: record.allowedPurposes
  };
  const width = number(metadata.width);
  const height = number(metadata.height);
  const durationSeconds = number(metadata.duration);
  return {
    ...result,
    ...(width !== undefined && width > 0 ? { width } : {}),
    ...(height !== undefined && height > 0 ? { height } : {}),
    ...(durationSeconds !== undefined && durationSeconds > 0 ? { durationSeconds } : {})
  };
}

function safeJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value));
}

async function removeExplicit(path: string | undefined): Promise<void> {
  if (path === undefined) return;
  try { await unlink(path); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) throw multipartError(400, "MALFORMED_MULTIPART");
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw multipartError(413, "PAYLOAD_TOO_LARGE");
  return number;
}

export class MediaAssetService {
  private readonly tempRoot: string;
  private readonly limiter: UploadRateLimiter;
  private readonly cursorSecret: Buffer;
  private readonly bodyBytes: number;
  private acceptingUploads = true;
  private readonly activeUploads = new Map<Promise<void>, AbortController>();
  private closePromise: Promise<void> | undefined;

  constructor(private readonly options: MediaAssetServiceOptions) {
    this.tempRoot = resolve(options.uploadTempRoot);
    this.cursorSecret = Buffer.from(options.cursorSecret);
    if (this.cursorSecret.byteLength < 32) throw new Error("Media cursor secret must contain at least 32 bytes.");
    this.bodyBytes = options.bodyBytes ?? MAX_UPLOAD_BODY_BYTES;
    if (!Number.isSafeInteger(this.bodyBytes) || this.bodyBytes < 1 || this.bodyBytes > MAX_UPLOAD_BODY_BYTES) {
      throw new Error("Media body limit must be a positive integer no larger than the protocol maximum.");
    }
    this.limiter = new UploadRateLimiter(options.now ?? Date.now);
  }

  handle() {
    return (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const item = /^\/api\/media-assets\/(asset_[a-fA-F0-9]{24})$/.exec(url.pathname);
      if (url.pathname !== "/api/media-assets" && item === null) {
        next();
        return Promise.resolve();
      }
      if (request.method === "DELETE" && item !== null) {
        return this.handleFailure(request, response, () => this.delete(request, response, item[1]!));
      }
      if (request.method === "POST") return this.startUpload(request, response);
      if (request.method === "GET") {
        return this.handleFailure(request, response, () => this.list(request, response, url));
      }
      return this.handleFailure(request, response, () => {
        safeJson(response, 404, this.error("NOT_FOUND", "The media route was not found."));
        return Promise.resolve();
      });
    };
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.acceptingUploads = false;
    for (const controller of this.activeUploads.values()) {
      controller.abort(new MediaHttpError(499, "UPLOAD_CANCELLED", "The upload was cancelled."));
    }
    const active = [...this.activeUploads.keys()];
    this.closePromise = (async () => {
      const results = await Promise.allSettled(active);
      const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (failures.length > 0) throw new AggregateError(failures, "Media upload shutdown failed.");
    })();
    return this.closePromise;
  }

  private startUpload(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.acceptingUploads) return this.handleFailure(request, response, () => {
      throw new MediaHttpError(503, "MEDIA_STORAGE_FAILED", "The media request is unavailable.");
    });
    const controller = new AbortController();
    const tracked = this.handleFailure(request, response, () => this.upload(request, response, controller));
    this.activeUploads.set(tracked, controller);
    const remove = (): void => { this.activeUploads.delete(tracked); };
    void tracked.then(remove, remove);
    return tracked;
  }

  private async handleFailure(
    request: IncomingMessage,
    response: ServerResponse,
    run: () => Promise<void>
  ): Promise<void> {
    try { await run(); }
    catch (cause) {
      const error = cause instanceof AuthHttpError ? cause
        : cause instanceof MediaHttpError ? cause
          : new MediaHttpError(500, "MEDIA_STORAGE_FAILED", "The media request failed.");
      if (!request.readableEnded && !response.destroyed && !response.writableEnded) {
        response.shouldKeepAlive = false;
        response.setHeader("connection", "close");
      }
      if (!response.destroyed && !response.writableEnded) {
        safeJson(response, error.status, this.error(error.code, error.message));
      }
    }
  }

  private async upload(request: IncomingMessage, response: ServerResponse, abort: AbortController): Promise<void> {
    const principal = await this.options.auth.authorize(request, response, "assets:write", true);
    if (abort.signal.aborted) throw abort.signal.reason;
    const release = this.limiter.acquire(ownerOf(principal));
    let tempPath: string | undefined;
    let uploaded: BrowserAssetSummaryV1 | undefined;
    const abortRequest = (): void => abort.abort(new MediaHttpError(499, "UPLOAD_CANCELLED", "The upload was cancelled."));
    const closeRequest = (): void => {
      if (!request.complete) abortRequest();
    };
    const closeResponse = (): void => {
      if (!response.writableEnded) abortRequest();
    };
    const errorRequest = (): void => abortRequest();
    const errorResponse = (): void => abortRequest();
    request.once("aborted", abortRequest);
    request.once("close", closeRequest);
    request.once("error", errorRequest);
    response.once("close", closeResponse);
    response.once("error", errorResponse);
    try {
      const contentLength = parseContentLength(request.headers["content-length"]);
      if (contentLength !== undefined && contentLength > this.bodyBytes) throw multipartError(413, "PAYLOAD_TOO_LARGE");
      const boundary = parseBoundary(request.headers["content-type"]);
      const guard = new MultipartProtocolGuard(boundary);
      const parser = Busboy({
        headers: request.headers,
        highWaterMark: MULTIPART_PUMP_SLICE_BYTES,
        fileHwm: MULTIPART_PUMP_SLICE_BYTES,
        defCharset: "utf8",
        defParamCharset: "utf8",
        preservePath: true,
        // Busboy emits *Limit at equality, so the raw guard owns the frozen 1/1/2 limits.
        limits: {
          files: 2,
          fields: 2,
          parts: 3,
          fieldSize: 33,
          fileSize: MAX_AUDIO_VIDEO_FILE_BYTES + 1,
          headerPairs: 64
        }
      });
      const budget = new MultipartBufferBudget(
        guard,
        parser,
        this.options.observeMultipartBufferBytes,
        this.options.observeMultipartBufferSnapshot
      );
      budget.assertWithinLimit();
      let purpose: MediaAssetPurpose | undefined;
      let filePart: RawPart | undefined;
      let filePromise: Promise<void> | undefined;
      let parserError: unknown;
      const fail = (error: unknown): void => {
        parserError ??= error;
        if (!abort.signal.aborted) abort.abort(error);
        parser.destroy(error instanceof Error ? error : multipartError(400, "MALFORMED_MULTIPART"));
      };
      parser.on("error", (error) => {
        parserError ??= error;
        if (!abort.signal.aborted) abort.abort(error);
      });
      parser.on("file", (name, stream, info) => {
        const raw = guard.takePart();
        if (raw?.name !== "file" || name !== "file" || raw.mime === undefined || raw.filename === undefined
          || info.encoding !== "7bit") {
          stream.resume(); fail(multipartError(400, "MALFORMED_MULTIPART")); return;
        }
        filePart = raw;
        const cap = fileLimit(raw.mime, this.options.store);
        tempPath = join(this.tempRoot, `${randomUUID()}${UPLOAD_MIME_SUFFIX[raw.mime]}`);
        budget.fileStream = stream;
        budget.assertWithinLimit();
        filePromise = (async () => {
          await mkdir(this.tempRoot, { recursive: true });
          stream.once("limit", () => fail(multipartError(413, "PAYLOAD_TOO_LARGE")));
          const output = this.options.createUploadWriteStream?.(tempPath!)
            ?? createWriteStream(tempPath!, { flags: "wx", highWaterMark: MULTIPART_PUMP_SLICE_BYTES });
          await transferFile(stream, output, cap, budget, abort.signal);
          if (stream.truncated) throw multipartError(413, "PAYLOAD_TOO_LARGE");
        })();
        filePromise.catch(fail);
      });
      parser.on("field", (name, value, info) => {
        const raw = guard.takePart();
        if (raw?.name !== "purpose" || name !== "purpose") { fail(multipartError(400, "MALFORMED_MULTIPART")); return; }
        if (info.valueTruncated || Buffer.byteLength(value, "utf8") > 32) { fail(multipartError(413, "PAYLOAD_TOO_LARGE")); return; }
        if (!["reference-image", "reference-video", "reference-audio", "logo"].includes(value)) {
          fail(multipartError(400, "MALFORMED_MULTIPART")); return;
        }
        purpose = value as MediaAssetPurpose;
      });
      parser.on("partsLimit", () => fail(multipartError(400, "MALFORMED_MULTIPART")));
      parser.on("filesLimit", () => fail(multipartError(400, "MALFORMED_MULTIPART")));
      parser.on("fieldsLimit", () => fail(multipartError(400, "MALFORMED_MULTIPART")));
      try {
        await pumpMultipartInput(
          request,
          parser,
          guard,
          budget,
          this.bodyBytes,
          this.options.observeMultipartPumpSliceBytes,
          this.options.observeMultipartRequestReadBytes,
          abort.signal
        );
        if (filePromise !== undefined) await filePromise;
      } catch (cause) {
        if (!abort.signal.aborted) abort.abort(cause);
        if (filePromise !== undefined) await filePromise.catch(() => undefined);
        if (parserError !== undefined) throw parserError;
        if (cause instanceof MediaHttpError) throw cause;
        if (abort.signal.reason instanceof MediaHttpError) throw abort.signal.reason;
        throw cause;
      }
      if (parserError !== undefined) throw parserError;
      if (filePart === undefined || tempPath === undefined) throw multipartError(400, "MALFORMED_MULTIPART");
      const imported = await this.options.store.import(ownerOf(principal), {
        sourcePath: tempPath,
        claimedMime: filePart.mime!,
        displayName: displayName(filePart.filename!),
        signal: abort.signal
      }).catch((cause: unknown) => {
        if (abort.signal.aborted) throw new MediaHttpError(499, "UPLOAD_CANCELLED", "The upload was cancelled.");
        if (cause instanceof Error && /exceed|too large|size limit|dimensions exceed|duration exceeds/i.test(cause.message)) {
          throw multipartError(413, "PAYLOAD_TOO_LARGE");
        }
        throw new MediaHttpError(422, "MEDIA_VALIDATION_FAILED", "The uploaded media did not pass validation.");
      });
      const record = this.options.store.listRecords(ownerOf(principal)).find((item) => item.imported.asset.id === imported.asset.id);
      if (record === undefined) throw new MediaHttpError(500, "MEDIA_STORAGE_FAILED", "The media request failed.");
      uploaded = summary(record);
    } finally {
      request.off("aborted", abortRequest);
      request.off("close", closeRequest);
      request.off("error", errorRequest);
      response.off("close", closeResponse);
      response.off("error", errorResponse);
      release();
      await removeExplicit(tempPath);
    }
    safeJson(response, 201, { asset: uploaded! });
  }

  private async list(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
    const principal = await this.options.auth.authorize(request, response, "assets:read");
    if ([...url.searchParams.keys()].some((key) => !["limit", "cursor", "kind"].includes(key))) {
      throw new MediaHttpError(400, "MALFORMED_QUERY", "The media query is invalid.");
    }
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new MediaHttpError(400, "MALFORMED_QUERY", "The media query is invalid.");
    const kind = url.searchParams.get("kind");
    if (kind !== null && !["image", "svg", "audio", "video"].includes(kind)) {
      throw new MediaHttpError(400, "MALFORMED_QUERY", "The media query is invalid.");
    }
    const owner = ownerOf(principal);
    let items = this.options.store.listRecords(owner).map(summary)
      .filter((item) => kind === null || item.kind === kind)
      .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt) || left.assetId.localeCompare(right.assetId));
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null) {
      const value = this.readCursor(cursor, owner, kind);
      items = items.filter((item) => item.uploadedAt < value.uploadedAt
        || item.uploadedAt === value.uploadedAt && item.assetId > value.assetId);
    }
    const page = items.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = items.length > limit && last !== undefined ? this.makeCursor(owner, kind, last) : null;
    safeJson(response, 200, { items: page, nextCursor });
  }

  private async delete(request: IncomingMessage, response: ServerResponse, assetId: string): Promise<void> {
    const principal = await this.options.auth.authorize(request, response, "assets:write", true);
    if (request.headers["transfer-encoding"] !== undefined
      || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")) {
      throw new MediaHttpError(400, "MALFORMED_REQUEST", "The media delete request must not contain a body.");
    }
    const owner = ownerOf(principal);
    if (await this.options.isAssetInUse?.(owner, assetId)) {
      throw new MediaHttpError(409, "ASSET_IN_USE", "The media asset is referenced by a project or task.");
    }
    try {
      await this.options.store.delete(owner, assetId);
    } catch (cause) {
      if (cause instanceof OwnerMediaResolverError && cause.code === "OWNER_NOT_FOUND") {
        throw new MediaHttpError(404, "NOT_FOUND", "The media asset was not found.");
      }
      throw cause;
    }
    response.statusCode = 204;
    response.setHeader("cache-control", "no-store");
    response.end();
  }

  private ownerDigest(owner: OwnerContext): string {
    return createHmac("sha256", this.cursorSecret).update("codemotion-media-owner-v1\0")
      .update(owner.tenantId).update("\0").update(owner.userId).digest("base64url");
  }

  private makeCursor(owner: OwnerContext, kind: string | null, last: BrowserAssetSummaryV1): string {
    const payload = Buffer.from(JSON.stringify({ v: 1, o: this.ownerDigest(owner), k: kind, t: last.uploadedAt, a: last.assetId }));
    const encoded = payload.toString("base64url");
    const signature = createHmac("sha256", this.cursorSecret).update("codemotion-media-cursor-v1\0").update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  private readCursor(cursor: string, owner: OwnerContext, kind: string | null): { uploadedAt: string; assetId: string } {
    const [encoded, signature, extra] = cursor.split(".");
    if (!encoded || !signature || extra !== undefined || cursor.length > 2_048) throw new MediaHttpError(400, "MALFORMED_QUERY", "The media query is invalid.");
    const expected = createHmac("sha256", this.cursorSecret).update("codemotion-media-cursor-v1\0").update(encoded).digest();
    let supplied: Buffer;
    try { supplied = Buffer.from(signature, "base64url"); }
    catch { throw new MediaHttpError(400, "MALFORMED_QUERY", "The media query is invalid."); }
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
      throw new MediaHttpError(400, "MALFORMED_QUERY", "The media query is invalid.");
    }
    try {
      const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
      if (value.v !== 1 || value.o !== this.ownerDigest(owner) || value.k !== kind
        || typeof value.t !== "string" || !Number.isFinite(Date.parse(value.t)) || typeof value.a !== "string") throw new Error();
      return { uploadedAt: value.t, assetId: value.a };
    } catch { throw new MediaHttpError(400, "MALFORMED_QUERY", "The media query is invalid."); }
  }

  private error(code: string, message: string): unknown {
    return { error: { code, message, retryable: false, requestId: `req_${createHash("sha256").update(randomUUID()).digest("base64url").slice(0, 16)}` } };
  }
}
