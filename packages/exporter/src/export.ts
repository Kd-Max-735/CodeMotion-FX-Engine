import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ColorSpace } from "@codemotion/core";
import { compositePixelSurfaces } from "@codemotion/renderer-webgl";
import type { ExportPreset } from "./presets.js";
import { validateExportPreset } from "./presets.js";

export interface FrameRequest {
  readonly frame: number;
  readonly time: number;
  readonly deltaTime: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
}

export type FrameProducer = (request: FrameRequest, signal?: AbortSignal) => Promise<Uint8Array> | Uint8Array;

export interface FrameInspection {
  readonly frame: number;
  readonly time: number;
  readonly sha256: string;
  readonly opaquePixels: number;
  readonly transparentPixels: number;
}

export interface ExportFailure {
  readonly stage: "render" | "inspect" | "encode";
  readonly frame: number;
  readonly time: number;
  readonly recoverFromFrame: number;
  readonly message: string;
}

export class ExportFrameError extends Error {
  constructor(readonly failure: ExportFailure, options?: ErrorOptions) {
    super(`Frame ${failure.frame} at ${failure.time.toFixed(6)}s failed during ${failure.stage}: ${failure.message}`, options);
  }
}

export interface ExportOptions {
  readonly preset: ExportPreset;
  readonly duration: number;
  readonly outputPath: string;
  readonly renderFrame: FrameProducer;
  readonly colorSpace?: ColorSpace;
  readonly qa?: AggregateExportQaPolicy;
  readonly audioPath?: string;
  readonly ffmpegPath?: string;
  readonly checkpointPath?: string;
  readonly resumeFromFrame?: number;
  readonly signal?: AbortSignal;
}

export interface AggregateExportQaPolicy {
  readonly startTime?: number;
  readonly endTime?: number;
  readonly requireForeground?: boolean;
  readonly requireObservableChange?: boolean;
  readonly isBackgroundFrame: (frame: Uint8Array, request: FrameRequest) => boolean;
}

export interface AggregateExportQaReport {
  readonly activeFrames: number;
  readonly backgroundFrames: number;
  readonly foregroundFrames: number;
  readonly distinctFrames: number;
  readonly passed: boolean;
}

function flattenFrameAlpha(
  frame: Uint8Array,
  request: FrameRequest,
  colorSpace: ColorSpace
): Uint8Array {
  const flattened = compositePixelSurfaces(
    {
      width: request.width,
      height: request.height,
      data: new Uint8ClampedArray(request.width * request.height * 4),
      colorSpace,
      alphaMode: "none"
    },
    {
      width: request.width,
      height: request.height,
      data: new Uint8ClampedArray(frame),
      colorSpace,
      alphaMode: "straight"
    },
    "normal",
    1,
    colorSpace,
    "none"
  );
  return new Uint8Array(flattened.data);
}

export interface ExportReport {
  readonly outputPath: string;
  readonly frameCount: number;
  readonly inspections: readonly FrameInspection[];
  readonly encoder: string;
  readonly audioEncoder?: string;
  readonly qa?: AggregateExportQaReport;
}

function encoderArgs(preset: ExportPreset, output: string, startFrame: number, audioPath?: string): string[] {
  const { width, height, fps, alpha, audio, videoCodec, audioCodec, crf } = preset.settings;
  const input = ["-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${width}x${height}`, "-framerate", String(fps), "-i", "pipe:0"];
  const audioInput = audio && audioPath !== undefined ? ["-i", resolve(audioPath)] : [];
  if (preset.format === "png-sequence") {
    return [...input, "-c:v", "png", "-pix_fmt", alpha ? "rgba" : "rgb24", "-start_number", String(startFrame), output];
  }
  if (preset.format === "gif") {
    return [...input, "-filter_complex", "[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse", output];
  }
  if (preset.format === "webm") {
    return [...input, ...audioInput, "-c:v", videoCodec ?? "libvpx-vp9", "-crf", String(crf ?? 18), "-b:v", "0",
      "-pix_fmt", alpha ? "yuva420p" : "yuv420p", ...(audioInput.length ? ["-c:a", audioCodec ?? "libopus", "-shortest"] : ["-an"]), output];
  }
  return [...input, ...audioInput, "-c:v", videoCodec ?? "libx264", "-crf", String(crf ?? 18), "-pix_fmt", "yuv420p",
    ...(audioInput.length ? ["-c:a", audioCodec ?? "aac", "-shortest"] : ["-an"]), "-movflags", "+faststart", output];
}

function inspect(frame: Uint8Array, request: FrameRequest): FrameInspection {
  const expected = request.width * request.height * 4;
  if (frame.byteLength !== expected) throw new Error(`Expected ${expected} RGBA bytes, received ${frame.byteLength}.`);
  let opaquePixels = 0;
  let transparentPixels = 0;
  for (let index = 3; index < frame.length; index += 4) {
    if (frame[index] === 255) opaquePixels += 1;
    if (frame[index] === 0) transparentPixels += 1;
  }
  return {
    frame: request.frame, time: request.time,
    sha256: createHash("sha256").update(frame).digest("hex"),
    opaquePixels, transparentPixels
  };
}

async function writeChunk(stream: NodeJS.WritableStream, frame: Uint8Array): Promise<void> {
  if (stream.write(frame)) return;
  await new Promise<void>((resolveWrite, reject) => {
    stream.once("drain", resolveWrite);
    stream.once("error", reject);
  });
}

export async function exportFixedFrames(options: ExportOptions): Promise<ExportReport> {
  const preset = validateExportPreset(options.preset);
  if (!Number.isFinite(options.duration) || options.duration <= 0) throw new RangeError("duration must be positive.");
  if (preset.settings.audio && options.audioPath === undefined) throw new Error("The preset requires an audio input.");
  const start = options.resumeFromFrame ?? 0;
  if (!Number.isInteger(start) || start < 0) throw new RangeError("resumeFromFrame must be a non-negative integer.");
  if (start > 0 && preset.format !== "png-sequence") {
    throw new Error("Only PNG sequences can resume at a non-zero frame; compressed outputs must recover from frame 0.");
  }
  const output = resolve(options.outputPath);
  await mkdir(preset.format === "png-sequence" ? output : dirname(output), { recursive: true });
  const target = preset.format === "png-sequence" ? `${output}/frame-%08d.png` : output;
  const args = ["-hide_banner", "-y", ...encoderArgs(preset, target, start, options.audioPath)];
  const child = spawn(options.ffmpegPath ?? "ffmpeg", args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  const closed = new Promise<number | null>((resolveClose, reject) => {
    child.on("error", reject);
    child.on("close", resolveClose);
  });
  const abort = (): void => { child.kill(); };
  options.signal?.addEventListener("abort", abort, { once: true });
  const inspections: FrameInspection[] = [];
  const qaHashes = new Set<string>();
  let qaActiveFrames = 0;
  let qaBackgroundFrames = 0;
  let qaForegroundFrames = 0;
  const frameCount = Math.ceil(options.duration * preset.settings.fps);
  let current = start;
  try {
    for (; current < frameCount; current += 1) {
      options.signal?.throwIfAborted();
      const request: FrameRequest = {
        frame: current,
        time: current / preset.settings.fps,
        deltaTime: current === 0 ? 0 : 1 / preset.settings.fps,
        fps: preset.settings.fps,
        width: preset.settings.width,
        height: preset.settings.height
      };
      let frame: Uint8Array;
      try {
        frame = await options.renderFrame(request, options.signal);
        if (options.qa !== undefined
          && request.time >= (options.qa.startTime ?? 0)
          && request.time < (options.qa.endTime ?? options.duration)) {
          qaActiveFrames += 1;
          qaHashes.add(createHash("sha256").update(frame).digest("hex"));
          if (options.qa.isBackgroundFrame(frame, request)) qaBackgroundFrames += 1;
          else qaForegroundFrames += 1;
        }
        if (!preset.settings.alpha) {
          frame = flattenFrameAlpha(frame, request, options.colorSpace ?? "srgb");
        }
      } catch (cause) {
        throw new ExportFrameError({
          stage: "render", frame: current, time: request.time,
          recoverFromFrame: preset.format === "png-sequence" ? current : 0, message: String(cause)
        }, { cause });
      }
      try {
        inspections.push(inspect(frame, request));
      } catch (cause) {
        throw new ExportFrameError({
          stage: "inspect", frame: current, time: request.time,
          recoverFromFrame: preset.format === "png-sequence" ? current : 0, message: String(cause)
        }, { cause });
      }
      try {
        await writeChunk(child.stdin, frame);
        if (options.checkpointPath !== undefined) {
          await writeFile(options.checkpointPath, JSON.stringify({ nextFrame: current + 1, frameCount, presetId: preset.id }) + "\n");
        }
      } catch (cause) {
        throw new ExportFrameError({
          stage: "encode", frame: current, time: request.time,
          recoverFromFrame: preset.format === "png-sequence" ? current : 0, message: String(cause)
        }, { cause });
      }
    }
    if (options.qa !== undefined) {
      const requireForeground = options.qa.requireForeground ?? true;
      const requireObservableChange = options.qa.requireObservableChange ?? true;
      const qaPassed = qaActiveFrames > 0
        && (!requireForeground || qaForegroundFrames > 0)
        && (!requireObservableChange || qaHashes.size > 1);
      if (!qaPassed) {
        throw new ExportFrameError({
          stage: "inspect",
          frame: Math.max(start, current - 1),
          time: Math.max(start, current - 1) / preset.settings.fps,
          recoverFromFrame: preset.format === "png-sequence" ? Math.max(start, current - 1) : 0,
          message: `Aggregate QA rejected the active interval: ${qaForegroundFrames}/${qaActiveFrames} foreground frames and ${qaHashes.size} distinct frames.`
        });
      }
    }
    child.stdin.end();
    const code = await closed;
    if (code !== 0) throw new ExportFrameError({
      stage: "encode", frame: Math.max(start, current - 1), time: Math.max(start, current - 1) / preset.settings.fps,
      recoverFromFrame: start, message: stderr.trim()
    });
  } catch (cause) {
    child.stdin.destroy();
    child.kill();
    await closed.catch(() => undefined);
    throw cause;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
  return {
    outputPath: output,
    frameCount,
    inspections,
    encoder: preset.settings.videoCodec ?? (preset.format === "png-sequence" ? "png" : preset.format === "gif" ? "gif" : "libx264"),
    ...(options.qa === undefined ? {} : {
      qa: {
        activeFrames: qaActiveFrames,
        backgroundFrames: qaBackgroundFrames,
        foregroundFrames: qaForegroundFrames,
        distinctFrames: qaHashes.size,
        passed: true
      }
    }),
    ...(preset.settings.audio && preset.settings.audioCodec !== undefined ? { audioEncoder: preset.settings.audioCodec } : {})
  };
}
