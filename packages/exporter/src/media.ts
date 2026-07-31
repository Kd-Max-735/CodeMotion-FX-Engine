import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import type { AssetDefinition, JsonObject, MotionProject } from "@codemotion/core";
import type { ResourceDescriptor } from "@codemotion/resource-manager";
import type { FrameProducer, FrameRequest } from "./export.js";
import { runProcess } from "./process.js";
import { assertOwnerContext, type OwnerContext } from "./task-store.js";

export type MediaKind = "image" | "audio" | "video" | "svg";

export interface MediaLimits {
  readonly imageBytes: number;
  readonly audioBytes: number;
  readonly videoBytes: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_MEDIA_LIMITS: MediaLimits = Object.freeze({
  imageBytes: 100 * 1024 * 1024,
  audioBytes: 512 * 1024 * 1024,
  videoBytes: 512 * 1024 * 1024,
  durationSeconds: 6 * 60 * 60,
  width: 8192,
  height: 8192
});

export const AAC_PCM_SAMPLE_RATE = 48_000;
export const AAC_PCM_CHANNELS = 2;
export const AAC_PCM_BITS_PER_SAMPLE = 16;
export const AAC_WAV_HEADER_ALLOWANCE_BYTES = 4_096;
const AAC_PCM_BYTES_PER_SAMPLE = AAC_PCM_BITS_PER_SAMPLE / 8;
const AAC_PCM_BYTES_PER_SECOND = AAC_PCM_SAMPLE_RATE * AAC_PCM_CHANNELS * AAC_PCM_BYTES_PER_SAMPLE;

export interface MediaImportOptions {
  readonly sourcePath: string;
  readonly claimedMime: string;
  readonly allowedRoots: readonly string[];
  readonly storageDirectory: string;
  readonly ffprobePath?: string;
  readonly ffmpegPath?: string;
  readonly svgRasterizerPath?: string;
  readonly limits?: Partial<MediaLimits>;
  readonly signal?: AbortSignal;
}

export interface ArkTransferEligibility extends JsonObject {
  filesApi: boolean;
  videoTos: boolean;
  base64OrUrl: boolean;
  reason: string;
}

export interface ImportedMedia {
  readonly asset: AssetDefinition;
  readonly descriptor: ResourceDescriptor;
  readonly storedPath: string;
  readonly rasterProxyPath?: string;
  readonly arkEligibility: ArkTransferEligibility;
}

export interface VerifiedStoredMedia extends ImportedMedia {
  readonly trustedBytes: number;
}

export interface StoredMediaVerificationOptions {
  readonly asset: AssetDefinition;
  readonly storageDirectory: string;
  readonly signal?: AbortSignal;
}

const formats = {
  ".png": { kind: "image", mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47], codecs: ["png"] },
  ".jpg": { kind: "image", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff], codecs: ["mjpeg"] },
  ".jpeg": { kind: "image", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff], codecs: ["mjpeg"] },
  ".gif": { kind: "image", mime: "image/gif", magic: [0x47, 0x49, 0x46, 0x38], codecs: ["gif"] },
  ".webp": { kind: "image", mime: "image/webp", magic: [0x52, 0x49, 0x46, 0x46], codecs: ["webp"] },
  ".avif": { kind: "image", mime: "image/avif", magic: null, codecs: ["av1"] },
  ".svg": { kind: "svg", mime: "image/svg+xml", magic: null, codecs: [] },
  ".wav": { kind: "audio", mime: "audio/wav", magic: [0x52, 0x49, 0x46, 0x46], codecs: ["pcm_"] },
  ".mp3": { kind: "audio", mime: "audio/mpeg", magic: null, codecs: ["mp3"] },
  ".flac": { kind: "audio", mime: "audio/flac", magic: [0x66, 0x4c, 0x61, 0x43], codecs: ["flac"] },
  ".ogg": { kind: "audio", mime: "audio/ogg", magic: [0x4f, 0x67, 0x67, 0x53], codecs: ["vorbis", "opus", "flac"] },
  ".aac": { kind: "audio", mime: "audio/aac", magic: null, codecs: ["aac"] },
  ".mp4": { kind: "video", mime: "video/mp4", magic: null, codecs: ["h264", "hevc", "av1", "vp9", "mpeg4"] },
  ".mov": { kind: "video", mime: "video/quicktime", magic: null, codecs: ["h264", "hevc", "prores", "qtrle", "png", "mpeg4"] },
  ".webm": { kind: "video", mime: "video/webm", magic: [0x1a, 0x45, 0xdf, 0xa3], codecs: ["vp8", "vp9", "av1"] },
  ".mkv": { kind: "video", mime: "video/x-matroska", magic: [0x1a, 0x45, 0xdf, 0xa3], codecs: ["h264", "hevc", "vp8", "vp9", "av1"] }
} as const;

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  sample_rate?: string;
  channels?: number;
}

interface ProbeResult {
  format?: { duration?: string; format_name?: string };
  streams?: ProbeStream[];
}

const SVG_ELEMENTS = new Set([
  "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "clipPath", "mask", "linearGradient", "radialGradient", "stop", "pattern",
  "filter", "feGaussianBlur", "feOffset", "feBlend", "feColorMatrix", "title", "desc"
]);

const SVG_ATTRIBUTES = new Set([
  "xmlns", "id", "width", "height", "viewBox", "x", "y", "x1", "y1", "x2", "y2",
  "cx", "cy", "r", "rx", "ry", "fx", "fy", "d", "points", "fill", "fill-opacity",
  "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "opacity", "transform", "preserveAspectRatio",
  "clip-path", "clip-rule", "mask", "filter", "gradientUnits", "gradientTransform", "offset",
  "stop-color", "stop-opacity", "patternUnits", "patternContentUnits", "patternTransform",
  "font-family", "font-size", "font-weight", "text-anchor", "dominant-baseline", "dx", "dy",
  "stdDeviation", "in", "in2", "result", "mode", "type", "values"
]);

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    if (entity.toLowerCase() === "amp") return "&";
    if (entity.toLowerCase() === "lt") return "<";
    if (entity.toLowerCase() === "gt") return ">";
    if (entity.toLowerCase() === "quot") return "\"";
    if (entity.toLowerCase() === "apos") return "'";
    const codePoint = entity[1]?.toLowerCase() === "x"
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    if (!Number.isSafeInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff
      || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw new Error("SVG contains an invalid character reference.");
    }
    return String.fromCodePoint(codePoint);
  }).replace(/&[^;\s]{0,64};/g, () => {
    throw new Error("SVG contains a disallowed entity reference.");
  });
}

function escapeXml(value: string, attribute = false): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(attribute ? /"/g : /$^/g, "&quot;");
}

function tagEnd(markup: string, start: number): number {
  let quote = "";
  for (let index = start; index < markup.length; index += 1) {
    const character = markup[index]!;
    if (quote !== "") {
      if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  throw new Error("SVG contains an unterminated tag.");
}

function parseSvgAttributes(source: string): [string, string][] {
  const attributes: [string, string][] = [];
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (index >= source.length) break;
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(source.slice(index));
    if (nameMatch === null) throw new Error("SVG contains a malformed attribute.");
    const name = nameMatch[0];
    index += name.length;
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (source[index] !== "=") throw new Error("SVG attributes must have explicit values.");
    index += 1;
    while (/\s/.test(source[index] ?? "")) index += 1;
    const quote = source[index];
    if (quote !== "\"" && quote !== "'") throw new Error("SVG attribute values must be quoted.");
    const end = source.indexOf(quote, index + 1);
    if (end < 0) throw new Error("SVG contains an unterminated attribute.");
    const value = decodeXml(source.slice(index + 1, end));
    index = end + 1;
    if (!SVG_ATTRIBUTES.has(name) || /^on/i.test(name) || name === "style") {
      throw new Error(`SVG attribute ${name} is not allowed.`);
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      throw new Error("SVG contains control characters.");
    }
    if (name === "xmlns" && value !== "http://www.w3.org/2000/svg") {
      throw new Error("SVG namespace is invalid.");
    }
    if (name !== "xmlns" && /(?:javascript|data|https?|file|ftp)\s*:/i.test(value)) {
      throw new Error("SVG active content or external references are not allowed.");
    }
    const urls = value.match(/url\s*\(([^)]*)\)/gi) ?? [];
    if (urls.some((url) => !/^url\s*\(\s*#[A-Za-z_][A-Za-z0-9_.:-]*\s*\)$/i.test(url))) {
      throw new Error("SVG external URL references are not allowed.");
    }
    if (attributes.some(([existing]) => existing === name)) throw new Error("SVG attributes must be unique.");
    attributes.push([name, value]);
  }
  return attributes.sort(([left], [right]) => left.localeCompare(right));
}

function svgDimension(value: string | undefined, fallback: number | undefined): number {
  if (value === undefined) {
    if (fallback === undefined) throw new Error("SVG width and height must be explicit or derivable from viewBox.");
    return fallback;
  }
  const match = /^(\d+(?:\.\d+)?)(?:px)?$/.exec(value);
  if (match === null) throw new Error("SVG dimensions must use positive pixel values.");
  const dimension = Number(match[1]);
  if (!Number.isFinite(dimension) || dimension <= 0) throw new Error("SVG dimensions must be positive.");
  return Math.ceil(dimension);
}

function sanitizeSvg(bytes: Buffer, limits: MediaLimits): { markup: string; width: number; height: number } {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("SVG must be valid UTF-8.");
  }
  if (/<!DOCTYPE|<!ENTITY|<\?|<!\[CDATA\[/i.test(source)) {
    throw new Error("SVG declarations, entities, and processing instructions are not allowed.");
  }
  source = source.replace(/<!--[\s\S]*?-->/g, "");
  if (source.includes("<!--") || source.includes("-->")) throw new Error("SVG contains a malformed comment.");

  const stack: string[] = [];
  const output: string[] = [];
  let rootAttributes: [string, string][] | undefined;
  let cursor = 0;
  let elements = 0;
  let attributeCount = 0;
  while (cursor < source.length) {
    const open = source.indexOf("<", cursor);
    const text = source.slice(cursor, open < 0 ? source.length : open);
    if (text.length > 0) {
      if (stack.length === 0 && text.trim() !== "") throw new Error("SVG contains text outside its root.");
      output.push(escapeXml(decodeXml(text)));
    }
    if (open < 0) break;
    const close = tagEnd(source, open + 1);
    let body = source.slice(open + 1, close).trim();
    if (body.startsWith("!")) throw new Error("SVG declarations are not allowed.");
    if (body.startsWith("/")) {
      const name = body.slice(1).trim();
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name) || stack.pop() !== name) {
        throw new Error("SVG tags are not correctly nested.");
      }
      output.push(`</${name}>`);
    } else {
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1).trimEnd();
      const nameMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(body);
      if (nameMatch === null || !SVG_ELEMENTS.has(nameMatch[0])) {
        throw new Error("SVG contains an unsupported or active element.");
      }
      const name = nameMatch[0];
      elements += 1;
      if (elements > 10_000 || stack.length > 64) throw new Error("SVG structural limits were exceeded.");
      const attributes = parseSvgAttributes(body.slice(name.length));
      attributeCount += attributes.length;
      if (attributeCount > 100_000) throw new Error("SVG attribute limit was exceeded.");
      if (elements === 1) {
        if (name !== "svg") throw new Error("SVG root element is missing.");
        rootAttributes = attributes;
      } else if (stack.length === 0) {
        throw new Error("SVG must contain exactly one root element.");
      }
      output.push(`<${name}${attributes.map(([key, value]) => ` ${key}="${escapeXml(value, true)}"`).join("")}${selfClosing ? "/" : ""}>`);
      if (!selfClosing) stack.push(name);
    }
    cursor = close + 1;
  }
  if (stack.length !== 0 || rootAttributes === undefined) throw new Error("SVG tags are not correctly nested.");

  const root = new Map(rootAttributes);
  const viewBox = root.get("viewBox")?.trim().split(/[\s,]+/).map(Number);
  const viewBoxWidth = viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 ? viewBox[2] : undefined;
  const viewBoxHeight = viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[3]! > 0 ? viewBox[3] : undefined;
  const width = svgDimension(root.get("width"), viewBoxWidth);
  const height = svgDimension(root.get("height"), viewBoxHeight);
  if (width > limits.width || height > limits.height || width * height > 33_554_432) {
    throw new Error("SVG dimensions exceed the configured limit.");
  }
  return { markup: output.join(""), width, height };
}

function inside(path: string, root: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

async function hashFile(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function arkEligibility(kind: MediaKind, bytes: number, duration: number): ArkTransferEligibility {
  const filesApi = (kind === "audio" || kind === "video") && bytes <= 512 * 1024 * 1024;
  const videoTos = kind === "video" && bytes <= 2 * 1024 * 1024 * 1024;
  const base64OrUrl = kind === "audio"
    ? bytes <= 25 * 1024 * 1024 && duration <= 120 * 60
    : kind === "video" && bytes <= 50 * 1024 * 1024 && Math.ceil(bytes * 4 / 3) <= 64 * 1024 * 1024;
  return {
    filesApi,
    videoTos,
    base64OrUrl,
    reason: "Eligibility only; Stage 6 performs no model call or upload."
  };
}

async function commitTempFile(tempPath: string, storedPath: string, expectedHash: string): Promise<boolean> {
  try {
    await rename(tempPath, storedPath);
    return true;
  } catch (cause) {
    let existing;
    try {
      existing = await stat(storedPath);
    } catch {
      throw cause;
    }
    if (!existing.isFile() || await hashFile(storedPath) !== expectedHash) {
      throw new Error("Existing content-addressed media failed integrity verification.");
    }
    await unlink(tempPath);
    return false;
  }
}

async function cleanupFailedArtifact(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }
}

function defaultSvgRasterizer(): string {
  if (process.env.CMFX_SVG_RASTERIZER) return process.env.CMFX_SVG_RASTERIZER;
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
    ];
    return candidates.find(existsSync) ?? "msedge";
  }
  return "chromium";
}

async function importSvg(
  source: string,
  infoSize: number,
  limits: MediaLimits,
  options: MediaImportOptions
): Promise<ImportedMedia> {
  const sourceBytes = await readFile(source);
  const sanitized = sanitizeSvg(sourceBytes, limits);
  const sanitizedBytes = Buffer.from(sanitized.markup, "utf8");
  const hash = createHash("sha256").update(sanitizedBytes).digest("hex");
  const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
  const storage = resolve(options.storageDirectory);
  await mkdir(storage, { recursive: true });
  const storedPath = join(storage, `${hash}.svg`);
  const svgTemp = join(storage, `.${hash}.${process.pid}.${randomUUID()}.svg`);
  const proxyTemp = join(storage, `.${hash}.${process.pid}.${randomUUID()}.png`);
  let storedCreated = false;
  let rasterProxyPath: string | undefined;
  let proxyCreated = false;
  try {
    await writeFile(svgTemp, sanitizedBytes, { flag: "wx" });
    await runProcess(options.svgRasterizerPath ?? defaultSvgRasterizer(), [
      "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-proxy-server",
      "--host-resolver-rules=MAP * 0.0.0.0", "--force-device-scale-factor=1",
      `--window-size=${sanitized.width},${sanitized.height}`,
      `--screenshot=${proxyTemp}`, pathToFileURL(svgTemp).href
    ], options.signal === undefined ? {} : { signal: options.signal }).catch(() => {
      throw new Error("SVG raster proxy generation failed.");
    });
    const proxyHeader = (await readFile(proxyTemp)).subarray(0, 4);
    if (!proxyHeader.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
      throw new Error("SVG rasterizer did not produce a PNG proxy.");
    }
    const proxyHash = await hashFile(proxyTemp, options.signal);
    rasterProxyPath = join(storage, `${hash}.${proxyHash}.png`);
    storedCreated = await commitTempFile(svgTemp, storedPath, hash);
    proxyCreated = await commitTempFile(proxyTemp, rasterProxyPath, proxyHash);
    const metadata: JsonObject = {
      mime: "image/svg+xml",
      bytes: sanitizedBytes.byteLength,
      sourceBytes: infoSize,
      sourceHash: `sha256:${sourceHash}`,
      duration: 0,
      width: sanitized.width,
      height: sanitized.height,
      codec: "svg",
      container: "svg",
      sampleRate: 0,
      channels: 0,
      decodeVerified: true,
      sanitized: true,
      rasterProxyHash: `sha256:${proxyHash}`,
      rasterProxyUri: `media-proxy://${hash}.${proxyHash}.png`
    };
    const eligibility = arkEligibility("svg", sanitizedBytes.byteLength, 0);
    const asset: AssetDefinition = {
      id: `asset_${hash.slice(0, 24)}`,
      type: "svg",
      uri: `media://${hash}.svg`,
      hash: `sha256:${hash}`,
      metadata: { ...metadata, arkEligibility: eligibility }
    };
    return {
      asset,
      storedPath,
      rasterProxyPath,
      descriptor: { id: asset.id, type: "media/svg", cacheKey: hash, metadata },
      arkEligibility: eligibility
    };
  } catch (cause) {
    const cleanupFailures: unknown[] = [];
    await cleanupFailedArtifact(svgTemp).catch((cleanupCause: unknown) => cleanupFailures.push(cleanupCause));
    await cleanupFailedArtifact(proxyTemp).catch((cleanupCause: unknown) => cleanupFailures.push(cleanupCause));
    if (proxyCreated && rasterProxyPath !== undefined) {
      await cleanupFailedArtifact(rasterProxyPath).catch((cleanupCause: unknown) => cleanupFailures.push(cleanupCause));
    }
    if (storedCreated) {
      await cleanupFailedArtifact(storedPath).catch((cleanupCause: unknown) => cleanupFailures.push(cleanupCause));
    }
    if (cleanupFailures.length > 0) {
      throw new AggregateError([cause, ...cleanupFailures], "SVG import failed and cleanup was incomplete.");
    }
    throw cause;
  }
}

export function estimateAacWavUpperBound(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("AAC duration must be a finite positive number.");
  }
  const pcmBytes = Math.ceil(duration * AAC_PCM_BYTES_PER_SECOND);
  const upperBound = AAC_WAV_HEADER_ALLOWANCE_BYTES + pcmBytes;
  if (!Number.isSafeInteger(pcmBytes) || !Number.isSafeInteger(upperBound)) {
    throw new Error("AAC duration is too large for a reliable PCM output bound.");
  }
  return upperBound;
}

function assertAacTranscodeBudget(duration: number, audioByteLimit: number): void {
  const upperBound = estimateAacWavUpperBound(duration);
  if (!Number.isSafeInteger(audioByteLimit) || audioByteLimit <= 0) {
    throw new Error("AAC output byte limit must be a positive safe integer.");
  }
  if (upperBound > audioByteLimit) {
    throw new Error("Predicted AAC PCM output exceeds the configured audio limit.");
  }
}

export function boundedAacTranscodeArgs(
  source: string,
  output: string,
  duration: number,
  audioByteLimit: number
): readonly string[] {
  assertAacTranscodeBudget(duration, audioByteLimit);
  return [
    "-v", "error", "-xerror", "-nostdin", "-y", "-i", source,
    "-map", "0:a:0", "-vn", "-sn", "-dn",
    "-t", String(duration), "-fs", String(audioByteLimit),
    "-c:a", "pcm_s16le", "-ar", String(AAC_PCM_SAMPLE_RATE), "-ac", String(AAC_PCM_CHANNELS),
    "-f", "wav", output
  ];
}

async function importAac(
  source: string,
  sourceBytes: number,
  duration: number,
  primary: ProbeStream,
  probe: ProbeResult,
  limits: MediaLimits,
  options: MediaImportOptions
): Promise<ImportedMedia> {
  assertAacTranscodeBudget(duration, limits.audioBytes);
  const storage = resolve(options.storageDirectory);
  await mkdir(storage, { recursive: true });
  const tempPath = join(storage, `.aac-${process.pid}.${randomUUID()}.wav`);
  try {
    await runProcess(
      options.ffmpegPath ?? "ffmpeg",
      boundedAacTranscodeArgs(source, tempPath, duration, limits.audioBytes),
      options.signal === undefined ? {} : { signal: options.signal }
    );
    const converted = await stat(tempPath);
    if (!converted.isFile() || converted.size <= 0 || converted.size > limits.audioBytes) {
      throw new Error("Converted AAC size is outside the configured audio limit.");
    }
    const hash = await hashFile(tempPath, options.signal);
    const sourceHash = await hashFile(source, options.signal);
    const storedPath = join(storage, `${hash}.wav`);
    await commitTempFile(tempPath, storedPath, hash);
    const metadata: JsonObject = {
      mime: "audio/wav",
      bytes: converted.size,
      sourceMime: "audio/aac",
      sourceBytes,
      sourceHash: `sha256:${sourceHash}`,
      duration,
      width: 0,
      height: 0,
      codec: "pcm_s16le",
      sourceCodec: primary.codec_name ?? "aac",
      container: "wav",
      sourceContainer: probe.format?.format_name ?? "aac",
      sampleRate: AAC_PCM_SAMPLE_RATE,
      channels: AAC_PCM_CHANNELS,
      bitsPerSample: AAC_PCM_BITS_PER_SAMPLE,
      decodeVerified: true,
      transcoded: true
    };
    const eligibility = arkEligibility("audio", converted.size, duration);
    const asset: AssetDefinition = {
      id: `asset_${hash.slice(0, 24)}`,
      type: "audio",
      uri: `media://${hash}.wav`,
      hash: `sha256:${hash}`,
      metadata: { ...metadata, arkEligibility: eligibility }
    };
    return {
      asset,
      storedPath,
      descriptor: { id: asset.id, type: "media/audio", cacheKey: hash, metadata },
      arkEligibility: eligibility
    };
  } catch (cause) {
    try {
      await cleanupFailedArtifact(tempPath);
    } catch (cleanupCause) {
      throw new AggregateError([cause, cleanupCause], "AAC import failed and temporary WAV cleanup was incomplete.");
    }
    throw cause;
  }
}

export async function importMedia(options: MediaImportOptions): Promise<ImportedMedia> {
  options.signal?.throwIfAborted();
  const requestedSource = resolve(options.sourcePath);
  const source = await realpath(requestedSource);
  const roots = await Promise.all(options.allowedRoots.map((root) => realpath(resolve(root))));
  if (!roots.some((root) => inside(source, root))) throw new Error("Source path escapes the allowed roots.");
  if (source.toLowerCase() !== requestedSource.toLowerCase()) throw new Error("Symlinked media input is not accepted.");

  const extension = extname(source).toLowerCase() as keyof typeof formats;
  const format = formats[extension];
  if (format === undefined) throw new Error(`Unsupported media extension: ${extension || "(none)"}`);
  if (format.mime !== options.claimedMime.toLowerCase()) throw new Error("Claimed MIME does not match the extension.");
  const info = await stat(source);
  if (!info.isFile()) throw new Error("Media input must be a regular file.");
  const limits: MediaLimits = {
    imageBytes: options.limits?.imageBytes ?? DEFAULT_MEDIA_LIMITS.imageBytes,
    audioBytes: options.limits?.audioBytes ?? DEFAULT_MEDIA_LIMITS.audioBytes,
    videoBytes: options.limits?.videoBytes ?? DEFAULT_MEDIA_LIMITS.videoBytes,
    durationSeconds: options.limits?.durationSeconds ?? DEFAULT_MEDIA_LIMITS.durationSeconds,
    width: options.limits?.width ?? DEFAULT_MEDIA_LIMITS.width,
    height: options.limits?.height ?? DEFAULT_MEDIA_LIMITS.height
  };
  if (Object.values(limits).some((limit) => !Number.isFinite(limit) || limit <= 0)) {
    throw new RangeError("Every media limit must be a positive finite number.");
  }
  const byteLimit = format.kind === "image" || format.kind === "svg"
    ? limits.imageBytes
    : format.kind === "audio" ? limits.audioBytes : limits.videoBytes;
  if (info.size <= 0 || info.size > byteLimit) throw new Error("Media size is outside the configured limit.");

  if (format.magic !== null) {
    const handle = await open(source, "r");
    try {
      const header = Buffer.alloc(format.magic.length);
      await handle.read(header, 0, header.length, 0);
      if (!format.magic.every((byte, index) => header[index] === byte)) throw new Error("File signature does not match the extension.");
    } finally {
      await handle.close();
    }
  }
  if (extension === ".webp" || extension === ".wav") {
    const handle = await open(source, "r");
    try {
      const header = Buffer.alloc(12);
      await handle.read(header, 0, header.length, 0);
      const marker = extension === ".webp" ? "WEBP" : "WAVE";
      if (header.subarray(8, 12).toString("ascii") !== marker) {
        throw new Error("RIFF media signature does not match the extension.");
      }
    } finally {
      await handle.close();
    }
  }
  if (extension === ".mp4" || extension === ".mov") {
    const handle = await open(source, "r");
    try {
      const header = Buffer.alloc(64);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const brands = header.subarray(8, bytesRead).toString("ascii");
      if (header.subarray(4, 8).toString("ascii") !== "ftyp" || /(?:avif|avis)/.test(brands)) {
        throw new Error("ISO media signature or brand does not match the extension.");
      }
    } finally {
      await handle.close();
    }
  }
  if (extension === ".avif") {
    const handle = await open(source, "r");
    try {
      const header = Buffer.alloc(64);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const brands = header.subarray(8, bytesRead).toString("ascii");
      if (header.subarray(4, 8).toString("ascii") !== "ftyp" || !/(?:avif|avis)/.test(brands)) {
        throw new Error("AVIF ISO media brand is missing.");
      }
    } finally {
      await handle.close();
    }
  }
  if (extension === ".aac") {
    const handle = await open(source, "r");
    try {
      const header = Buffer.alloc(2);
      await handle.read(header, 0, header.length, 0);
      if (header[0] !== 0xff || (header[1]! & 0xf6) !== 0xf0) {
        throw new Error("AAC ADTS signature is missing.");
      }
    } finally {
      await handle.close();
    }
  }
  if (extension === ".svg") return importSvg(source, info.size, limits, options);

  const probeProcess = await runProcess(options.ffprobePath ?? "ffprobe", [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", source
  ], options.signal === undefined ? {} : { signal: options.signal });
  const probe = JSON.parse(probeProcess.stdout.toString("utf8")) as ProbeResult;
  const streamType = format.kind === "image" ? "video" : format.kind;
  const primary = probe.streams?.find((stream) => stream.codec_type === streamType);
  if (primary === undefined) throw new Error(`No ${format.kind} stream was found.`);
  const codec = primary.codec_name ?? "";
  if (!format.codecs.some((expected) => expected.endsWith("_") ? codec.startsWith(expected) : codec === expected)) {
    throw new Error("Decoded codec does not match the extension and MIME.");
  }
  const duration = Number(primary.duration ?? probe.format?.duration ?? 0);
  if (!Number.isFinite(duration) || duration < 0 || duration > limits.durationSeconds) {
    throw new Error("Media duration is invalid or exceeds the configured limit.");
  }
  if (extension === ".aac" && duration <= 0) {
    throw new Error("AAC duration must be a finite positive number.");
  }
  const width = primary.width ?? 0;
  const height = primary.height ?? 0;
  if ((format.kind === "image" || format.kind === "video")
    && (width < 1 || height < 1 || width > limits.width || height > limits.height)) {
    throw new Error("Media dimensions are invalid or exceed the configured limit.");
  }
  await runProcess(options.ffmpegPath ?? "ffmpeg", [
    "-v", "error", "-i", source, ...(format.kind === "audio" ? ["-t", "0.1"] : ["-frames:v", "1"]), "-f", "null", "-"
  ], options.signal === undefined ? {} : { signal: options.signal });
  if (extension === ".aac") {
    return importAac(source, info.size, duration, primary, probe, limits, options);
  }

  const hash = await hashFile(source, options.signal);
  const id = `asset_${hash.slice(0, 24)}`;
  const storage = resolve(options.storageDirectory);
  await mkdir(storage, { recursive: true });
  const storedPath = join(storage, `${hash}${extension}`);
  const tempPath = join(storage, `.${hash}.${process.pid}.${randomUUID()}.tmp`);
  if (!inside(storedPath, storage) || !inside(tempPath, storage)) throw new Error("Resolved storage path escaped its root.");
  try {
    await pipeline(createReadStream(source, { signal: options.signal }), createWriteStream(tempPath, { flags: "wx" }));
    await commitTempFile(tempPath, storedPath, hash);
  } catch (cause) {
    await unlink(tempPath).catch(() => undefined);
    throw cause;
  }

  const metadata: JsonObject = {
    mime: format.mime,
    bytes: info.size,
    duration,
    width,
    height,
    codec: primary.codec_name ?? "unknown",
    container: probe.format?.format_name ?? "unknown",
    sampleRate: primary.sample_rate === undefined ? 0 : Number(primary.sample_rate),
    channels: primary.channels ?? 0,
    decodeVerified: true
  };
  const eligibility = arkEligibility(format.kind, info.size, duration);
  const asset: AssetDefinition = {
    id, type: format.kind, uri: `media://${hash}${extension}`, hash: `sha256:${hash}`,
    metadata: { ...metadata, arkEligibility: eligibility }
  };
  return {
    asset,
    storedPath,
    descriptor: { id, type: `media/${format.kind}`, cacheKey: hash, metadata },
    arkEligibility: eligibility
  };
}

export async function verifyStoredMediaAsset(options: StoredMediaVerificationOptions): Promise<VerifiedStoredMedia> {
  if (isAborted(options.signal)) throw new Error("Stored media verification was cancelled.");
  const uriMatch = /^media:\/\/([a-f0-9]{64})(\.[a-z0-9]+)$/i.exec(options.asset.uri);
  const hashMatch = /^sha256:([a-f0-9]{64})$/i.exec(options.asset.hash ?? "");
  if (uriMatch === null || hashMatch === null) throw new Error("Stored media address or hash is invalid.");
  const uriHash = uriMatch[1]!.toLowerCase();
  if (uriHash !== hashMatch[1]!.toLowerCase()) throw new Error("Stored media URI and asset hash disagree.");
  if (options.asset.id !== `asset_${uriHash.slice(0, 24)}`) {
    throw new Error("Stored media stable asset ID does not match its content hash.");
  }
  const extension = uriMatch[2]!.toLowerCase() as keyof typeof formats;
  const format = formats[extension];
  if (format === undefined || format.kind !== options.asset.type) {
    throw new Error("Stored media type and extension disagree.");
  }

  let storage: string;
  let storedPath: string;
  let storedBytes: number;
  try {
    storage = await realpath(resolve(options.storageDirectory));
    const requestedPath = resolve(storage, `${uriHash}${extension}`);
    if (!inside(requestedPath, storage)) throw new Error("boundary");
    storedPath = await realpath(requestedPath);
    if (!inside(storedPath, storage) || storedPath.toLowerCase() !== requestedPath.toLowerCase()) {
      throw new Error("boundary");
    }
    const storedInfo = await stat(storedPath);
    if (!storedInfo.isFile()) throw new Error("regular-file");
    if (!Number.isSafeInteger(storedInfo.size) || storedInfo.size < 0) throw new Error("file-size");
    storedBytes = storedInfo.size;
  } catch {
    throw new Error("Stored media is missing, outside its storage root, or not a regular file.");
  }

  let diskHash: string;
  try {
    diskHash = await hashFile(storedPath, options.signal);
  } catch {
    if (isAborted(options.signal)) throw new Error("Stored media verification was cancelled.");
    throw new Error("Stored media could not be verified.");
  }
  if (diskHash !== uriHash) throw new Error("Stored media content hash does not match its immutable address.");

  const declaredBytes = options.asset.metadata.bytes;
  if (typeof declaredBytes !== "number" || !Number.isFinite(declaredBytes)
    || !Number.isSafeInteger(declaredBytes) || declaredBytes < 0) {
    throw new Error("Stored media byte declaration is invalid.");
  }
  if (declaredBytes !== storedBytes) {
    throw new Error("Stored media byte declaration does not match the verified file size.");
  }

  let rasterProxyPath: string | undefined;
  if (format.kind === "svg") {
    const proxyUri = options.asset.metadata.rasterProxyUri;
    const proxyHashValue = options.asset.metadata.rasterProxyHash;
    const proxyMatch = typeof proxyUri === "string"
      ? /^media-proxy:\/\/([a-f0-9]{64})\.([a-f0-9]{64})\.png$/i.exec(proxyUri)
      : null;
    const proxyHashMatch = typeof proxyHashValue === "string"
      ? /^sha256:([a-f0-9]{64})$/i.exec(proxyHashValue)
      : null;
    if (proxyMatch === null || proxyHashMatch === null
      || proxyMatch[1]!.toLowerCase() !== uriHash
      || proxyMatch[2]!.toLowerCase() !== proxyHashMatch[1]!.toLowerCase()) {
      throw new Error("Stored SVG raster proxy metadata is invalid.");
    }
    try {
      const requestedProxy = resolve(storage, `${uriHash}.${proxyMatch[2]!.toLowerCase()}.png`);
      rasterProxyPath = await realpath(requestedProxy);
      if (!inside(rasterProxyPath, storage) || rasterProxyPath.toLowerCase() !== requestedProxy.toLowerCase()) {
        throw new Error("boundary");
      }
      if (await hashFile(rasterProxyPath, options.signal) !== proxyMatch[2]!.toLowerCase()) {
        throw new Error("hash");
      }
    } catch {
      throw new Error("Stored SVG raster proxy is missing or failed integrity verification.");
    }
  }

  const duration = typeof options.asset.metadata.duration === "number" ? options.asset.metadata.duration : 0;
  const eligibility = arkEligibility(format.kind, storedBytes, duration);
  return {
    asset: options.asset,
    storedPath,
    descriptor: {
      id: options.asset.id,
      type: `media/${format.kind}`,
      cacheKey: diskHash,
      metadata: options.asset.metadata
    },
    arkEligibility: eligibility,
    trustedBytes: storedBytes,
    ...(rasterProxyPath === undefined ? {} : { rasterProxyPath })
  };
}

export function addAssetToProject(project: MotionProject, imported: ImportedMedia): MotionProject {
  const existing = project.assets.find((asset) => asset.id === imported.asset.id);
  if (existing !== undefined && existing.hash !== imported.asset.hash) throw new Error("Stable asset ID collision.");
  return existing === undefined ? { ...project, assets: [...project.assets, imported.asset] } : project;
}

export async function removeStoredMedia(options: StoredMediaVerificationOptions): Promise<void> {
  const imported = await verifyStoredMediaAsset(options);
  if (imported.rasterProxyPath === undefined) {
    await unlink(imported.storedPath);
    return;
  }
  try {
    await unlink(imported.rasterProxyPath);
  } catch (cause) {
    throw new Error("Stored SVG raster proxy could not be deleted; primary SVG was retained.", { cause });
  }
  try {
    await unlink(imported.storedPath);
  } catch (cause) {
    throw new Error("Stored SVG raster proxy was deleted, but primary SVG deletion failed.", { cause });
  }
}

export async function decodeMediaFrame(
  imported: ImportedMedia,
  request: FrameRequest,
  options: { ffmpegPath?: string; signal?: AbortSignal } = {}
): Promise<Uint8Array> {
  if (imported.asset.type !== "image" && imported.asset.type !== "video" && imported.asset.type !== "svg") {
    throw new Error("Only image, SVG, and video assets produce visual frames.");
  }
  const seek = imported.asset.type === "video" ? request.time : 0;
  const input = imported.asset.type === "svg" ? imported.rasterProxyPath : imported.storedPath;
  if (input === undefined) throw new Error("Verified SVG raster proxy is missing.");
  const result = await runProcess(options.ffmpegPath ?? "ffmpeg", [
    "-v", "error", "-ss", String(seek), "-i", input, "-frames:v", "1",
    "-vf", `scale=${request.width}:${request.height}:flags=lanczos`, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
  ], options.signal === undefined ? {} : { signal: options.signal });
  const expected = request.width * request.height * 4;
  if (result.stdout.byteLength !== expected) throw new Error(`Decoded frame has ${result.stdout.byteLength} bytes; expected ${expected}.`);
  return new Uint8Array(result.stdout);
}

export function createMediaFrameProducer(imported: ImportedMedia, ffmpegPath?: string): FrameProducer {
  return (request, signal) => decodeMediaFrame(imported, request, {
    ...(ffmpegPath === undefined ? {} : { ffmpegPath }),
    ...(signal === undefined ? {} : { signal })
  });
}

export async function decodeAudioPreview(
  imported: ImportedMedia,
  seconds = 0.1,
  options: { ffmpegPath?: string; signal?: AbortSignal } = {}
): Promise<Uint8Array> {
  if (imported.asset.type !== "audio") throw new Error("Only audio assets produce audio previews.");
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 10) throw new RangeError("Preview duration must be in (0, 10].");
  const result = await runProcess(options.ffmpegPath ?? "ffmpeg", [
    "-v", "error", "-i", imported.storedPath, "-t", String(seconds), "-f", "s16le", "-ac", "2", "-ar", "48000", "pipe:1"
  ], options.signal === undefined ? {} : { signal: options.signal });
  if (result.stdout.byteLength === 0) throw new Error("Decoded audio preview is empty.");
  return new Uint8Array(result.stdout);
}

export interface TenantMediaStoreOptions {
  readonly storageRoot: string;
  readonly allowedRoots: readonly string[];
  readonly ffprobePath?: string;
  readonly ffmpegPath?: string;
  readonly svgRasterizerPath?: string;
  readonly limits?: Partial<MediaLimits>;
  readonly audit?: (event: Readonly<{ event: "media-index-record-rejected" | "media-index-load-failed" }>) => void;
}

export type MediaAssetPurpose = "reference-image" | "reference-video" | "reference-audio" | "logo";

export interface TenantMediaImportOptions extends Pick<MediaImportOptions, "sourcePath" | "claimedMime" | "signal"> {
  readonly displayName?: string;
}

export interface TenantMediaRecord {
  readonly owner: OwnerContext;
  readonly imported: ImportedMedia;
  readonly displayName: string;
  readonly uploadedAt: string;
  readonly allowedPurposes: readonly MediaAssetPurpose[];
}

interface PersistedMediaIndex { readonly version: 1; readonly records: readonly TenantMediaRecord[] }

function ownedAssetKey(owner: OwnerContext, assetId: string): string {
  return JSON.stringify([owner.tenantId, owner.userId, assetId]);
}

function tenantStorageSegment(tenantId: string): string {
  return createHash("sha256").update("codemotion-tenant\0").update(tenantId).digest("hex");
}

export class TenantMediaStore {
  private readonly records = new Map<string, TenantMediaRecord>();
  private readonly storageRoot: string;
  private readonly indexPath: string;
  private readonly hydrated: Promise<void>;
  private mutation: Promise<void> = Promise.resolve();
  private hydrationComplete = false;

  constructor(private readonly options: TenantMediaStoreOptions) {
    this.storageRoot = resolve(options.storageRoot);
    this.indexPath = join(this.storageRoot, ".codemotion-owner-media-index-v1.json");
    this.hydrated = this.rehydrate().finally(() => { this.hydrationComplete = true; });
  }

  get limits(): MediaLimits { return { ...DEFAULT_MEDIA_LIMITS, ...this.options.limits }; }

  async initialize(): Promise<this> {
    await this.hydrated;
    return this;
  }

  async import(owner: OwnerContext, options: TenantMediaImportOptions): Promise<ImportedMedia> {
    assertOwnerContext(owner);
    if (options.displayName !== undefined && !isSafeDisplayName(options.displayName)) {
      throw new Error("Media display name is invalid.");
    }
    await this.hydrated;
    const imported = await importMedia({
      sourcePath: options.sourcePath,
      claimedMime: options.claimedMime,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      allowedRoots: this.options.allowedRoots,
      storageDirectory: this.ownerStorageDirectory(owner),
      ...(this.options.ffprobePath === undefined ? {} : { ffprobePath: this.options.ffprobePath }),
      ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
      ...(this.options.svgRasterizerPath === undefined ? {} : { svgRasterizerPath: this.options.svgRasterizerPath }),
      ...(this.options.limits === undefined ? {} : { limits: this.options.limits })
    });
    const record: TenantMediaRecord = {
      owner: { tenantId: owner.tenantId, userId: owner.userId },
      imported,
      displayName: options.displayName ?? imported.asset.id,
      uploadedAt: new Date().toISOString(),
      allowedPurposes: purposesFor(imported.asset.type)
    };
    await this.mutate(async () => {
      const key = ownedAssetKey(owner, imported.asset.id);
      const previous = this.records.get(key);
      this.records.set(key, record);
      try {
        await this.persist();
      } catch (cause) {
        if (previous === undefined) this.records.delete(key);
        else this.records.set(key, previous);
        throw cause;
      }
    });
    return imported;
  }

  async resolve(owner: OwnerContext, assetId: string, signal?: AbortSignal): Promise<VerifiedStoredMedia> {
    assertOwnerContext(owner);
    await this.hydrated;
    const record = this.records.get(ownedAssetKey(owner, assetId));
    if (record === undefined) throw new Error("Asset not found or access denied.");
    return verifyStoredMediaAsset({
      asset: record.imported.asset,
      storageDirectory: this.ownerStorageDirectory(owner),
      ...(signal === undefined ? {} : { signal })
    });
  }

  list(owner: OwnerContext): readonly AssetDefinition[] {
    assertOwnerContext(owner);
    this.assertHydrated();
    return [...this.records.values()]
      .filter((record) => record.owner.tenantId === owner.tenantId && record.owner.userId === owner.userId)
      .map((record) => record.imported.asset);
  }

  listRecords(owner: OwnerContext): readonly TenantMediaRecord[] {
    assertOwnerContext(owner);
    this.assertHydrated();
    return [...this.records.values()]
      .filter((record) => record.owner.tenantId === owner.tenantId && record.owner.userId === owner.userId)
      .map((record) => structuredClone(record));
  }

  private ownerStorageDirectory(owner: OwnerContext): string {
    return join(this.storageRoot, tenantStorageSegment(owner.tenantId));
  }

  private assertHydrated(): void {
    if (!this.hydrationComplete) throw new Error("Tenant media store has not finished initializing.");
  }

  private async mutate(operation: () => Promise<void>): Promise<void> {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.catch(() => undefined);
    await next;
  }

  private async persist(): Promise<void> {
    await mkdir(this.storageRoot, { recursive: true });
    const tempPath = join(this.storageRoot, `.owner-index.${process.pid}.${randomUUID()}.tmp`);
    try {
      const value: PersistedMediaIndex = { version: 1, records: [...this.records.values()] };
      await writeFile(tempPath, JSON.stringify(value), { encoding: "utf8", flag: "wx" });
      await rename(tempPath, this.indexPath);
    } catch (cause) {
      await cleanupFailedArtifact(tempPath).catch(() => undefined);
      throw cause;
    }
  }

  private async rehydrate(): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(this.indexPath, "utf8"));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      this.options.audit?.({ event: "media-index-load-failed" });
      return;
    }
    if (!isPersistedIndexEnvelope(parsed)) {
      this.options.audit?.({ event: "media-index-load-failed" });
      return;
    }
    for (const value of parsed.records) {
      try {
        if (!isPersistedRecord(value)) throw new Error("Persisted media record is malformed.");
        const candidate = value;
        assertOwnerContext(candidate.owner);
        const directory = this.ownerStorageDirectory(candidate.owner);
        const verified = await verifyStoredMediaAsset({ asset: candidate.imported.asset, storageDirectory: directory });
        if (resolve(candidate.imported.storedPath) !== resolve(verified.storedPath)
          || (candidate.imported.rasterProxyPath === undefined) !== (verified.rasterProxyPath === undefined)
          || (candidate.imported.rasterProxyPath !== undefined
            && resolve(candidate.imported.rasterProxyPath) !== resolve(verified.rasterProxyPath!))) {
          throw new Error("Persisted media paths do not match verified storage paths.");
        }
        this.records.set(ownedAssetKey(candidate.owner, candidate.imported.asset.id), structuredClone(candidate));
      } catch {
        this.options.audit?.({ event: "media-index-record-rejected" });
      }
    }
  }
}

function purposesFor(type: AssetDefinition["type"]): readonly MediaAssetPurpose[] {
  if (type === "image" || type === "svg") return ["reference-image", "logo"];
  if (type === "video") return ["reference-video"];
  if (type === "audio") return ["reference-audio"];
  return [];
}

function isPersistedIndexEnvelope(value: unknown): value is { readonly version: 1; readonly records: readonly unknown[] } {
  if (typeof value !== "object" || value === null) return false;
  const index = value as Partial<PersistedMediaIndex>;
  return index.version === 1 && Array.isArray(index.records);
}

function isPersistedRecord(record: unknown): record is TenantMediaRecord {
  if (typeof record !== "object" || record === null) return false;
  const item = record as Partial<TenantMediaRecord>;
  return typeof item.displayName === "string" && isSafeDisplayName(item.displayName)
    && typeof item.uploadedAt === "string" && Number.isFinite(Date.parse(item.uploadedAt))
    && new Date(item.uploadedAt).toISOString() === item.uploadedAt
    && Array.isArray(item.allowedPurposes)
    && item.allowedPurposes.every((purpose) => ["reference-image", "reference-video", "reference-audio", "logo"].includes(purpose))
    && typeof item.owner === "object" && item.owner !== null
    && typeof item.imported === "object" && item.imported !== null
    && typeof item.imported.storedPath === "string"
    && typeof item.imported.asset === "object" && item.imported.asset !== null
    && typeof item.imported.asset.id === "string"
    && ["image", "svg", "audio", "video"].includes(item.imported.asset.type)
    && JSON.stringify(item.allowedPurposes) === JSON.stringify(purposesFor(item.imported.asset.type))
    && (item.imported.rasterProxyPath === undefined || typeof item.imported.rasterProxyPath === "string");
}

function isSafeDisplayName(value: string): boolean {
  const scalars = [...value];
  return scalars.length >= 1 && scalars.length <= 128 && !/[\u0000-\u001f\u007f/\\]/.test(value);
}
