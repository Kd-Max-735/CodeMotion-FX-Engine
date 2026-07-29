import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type { AssetDefinition, JsonObject, MotionProject } from "@codemotion/core";
import type { ResourceDescriptor } from "@codemotion/resource-manager";
import type { FrameProducer, FrameRequest } from "./export.js";
import { runProcess } from "./process.js";

export type MediaKind = "image" | "audio" | "video";

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

export interface MediaImportOptions {
  readonly sourcePath: string;
  readonly claimedMime: string;
  readonly allowedRoots: readonly string[];
  readonly storageDirectory: string;
  readonly ffprobePath?: string;
  readonly ffmpegPath?: string;
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
  ".png": { kind: "image", mime: "image/png", magic: [0x89, 0x50, 0x4e, 0x47] },
  ".jpg": { kind: "image", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  ".jpeg": { kind: "image", mime: "image/jpeg", magic: [0xff, 0xd8, 0xff] },
  ".gif": { kind: "image", mime: "image/gif", magic: [0x47, 0x49, 0x46, 0x38] },
  ".webp": { kind: "image", mime: "image/webp", magic: [0x52, 0x49, 0x46, 0x46] },
  ".wav": { kind: "audio", mime: "audio/wav", magic: [0x52, 0x49, 0x46, 0x46] },
  ".mp3": { kind: "audio", mime: "audio/mpeg", magic: null },
  ".flac": { kind: "audio", mime: "audio/flac", magic: [0x66, 0x4c, 0x61, 0x43] },
  ".ogg": { kind: "audio", mime: "audio/ogg", magic: [0x4f, 0x67, 0x67, 0x53] },
  ".mp4": { kind: "video", mime: "video/mp4", magic: null },
  ".mov": { kind: "video", mime: "video/quicktime", magic: null },
  ".webm": { kind: "video", mime: "video/webm", magic: [0x1a, 0x45, 0xdf, 0xa3] },
  ".mkv": { kind: "video", mime: "video/x-matroska", magic: [0x1a, 0x45, 0xdf, 0xa3] }
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
  const byteLimit = format.kind === "image" ? limits.imageBytes : format.kind === "audio" ? limits.audioBytes : limits.videoBytes;
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
  if (extension === ".mp4" || extension === ".mov") {
    const handle = await open(source, "r");
    try {
      const header = Buffer.alloc(12);
      await handle.read(header, 0, header.length, 0);
      if (header.subarray(4, 8).toString("ascii") !== "ftyp") throw new Error("ISO media signature is missing.");
    } finally {
      await handle.close();
    }
  }

  const probeProcess = await runProcess(options.ffprobePath ?? "ffprobe", [
    "-v", "error", "-show_format", "-show_streams", "-of", "json", source
  ], options.signal === undefined ? {} : { signal: options.signal });
  const probe = JSON.parse(probeProcess.stdout.toString("utf8")) as ProbeResult;
  const streamType = format.kind === "image" ? "video" : format.kind;
  const primary = probe.streams?.find((stream) => stream.codec_type === streamType);
  if (primary === undefined) throw new Error(`No ${format.kind} stream was found.`);
  const duration = Number(primary.duration ?? probe.format?.duration ?? 0);
  if (!Number.isFinite(duration) || duration < 0 || duration > limits.durationSeconds) {
    throw new Error("Media duration is invalid or exceeds the configured limit.");
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

  const hash = await hashFile(source, options.signal);
  const id = `asset_${hash.slice(0, 24)}`;
  const storage = resolve(options.storageDirectory);
  await mkdir(storage, { recursive: true });
  const storedPath = join(storage, `${hash}${extension}`);
  const tempPath = join(storage, `.${hash}.${process.pid}.${randomUUID()}.tmp`);
  if (!inside(storedPath, storage) || !inside(tempPath, storage)) throw new Error("Resolved storage path escaped its root.");
  try {
    await pipeline(createReadStream(source, { signal: options.signal }), createWriteStream(tempPath, { flags: "wx" }));
    await rename(tempPath, storedPath).catch(async (cause: unknown) => {
      try {
        await stat(storedPath);
        await unlink(tempPath);
      } catch {
        throw cause;
      }
    });
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
    trustedBytes: storedBytes
  };
}

export function addAssetToProject(project: MotionProject, imported: ImportedMedia): MotionProject {
  const existing = project.assets.find((asset) => asset.id === imported.asset.id);
  if (existing !== undefined && existing.hash !== imported.asset.hash) throw new Error("Stable asset ID collision.");
  return existing === undefined ? { ...project, assets: [...project.assets, imported.asset] } : project;
}

export async function removeStoredMedia(options: StoredMediaVerificationOptions): Promise<void> {
  const imported = await verifyStoredMediaAsset(options);
  await unlink(imported.storedPath);
}

export async function decodeMediaFrame(
  imported: ImportedMedia,
  request: FrameRequest,
  options: { ffmpegPath?: string; signal?: AbortSignal } = {}
): Promise<Uint8Array> {
  if (imported.asset.type !== "image" && imported.asset.type !== "video") {
    throw new Error("Only image and video assets produce visual frames.");
  }
  const seek = imported.asset.type === "video" ? request.time : 0;
  const result = await runProcess(options.ffmpegPath ?? "ffmpeg", [
    "-v", "error", "-ss", String(seek), "-i", imported.storedPath, "-frames:v", "1",
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
