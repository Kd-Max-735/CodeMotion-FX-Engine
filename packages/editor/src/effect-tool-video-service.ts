import { constants as fsConstants, type ReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  executeSelectedEffectTool,
  type EffectParameterEnvelope,
  type EffectRenderResult,
  type EffectToolDefinition,
  type ServerEffectRenderContext
} from "@codemotion/effect-functions";
import {
  decodeMediaFrame,
  exportFixedFrames,
  validateExportPreset,
  type FrameRequest,
  type OwnerContext,
  type TenantMediaStore,
  type VerifiedStoredMedia
} from "@codemotion/exporter";

const MAX_VIDEO_DURATION_SECONDS = 3_600;
const MAX_EFFECT_DIMENSION = 4_096;

export type EffectToolVideoTaskStatus = "queued" | "running" | "completed" | "failed";

export interface EffectToolVideoExecutionView {
  readonly id: string;
  readonly status: EffectToolVideoTaskStatus;
  readonly toolName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: {
    readonly kind: "video";
    readonly assetId: string;
  };
  readonly video: {
    readonly format: "mp4";
    readonly mime: "video/mp4";
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly durationSeconds: number;
    readonly frameCount: number;
    readonly completedFrames: number;
    readonly progress: number;
    readonly audio: boolean;
    readonly bytes?: number;
    readonly downloadName?: string;
  };
  readonly failure?: {
    readonly code: "VIDEO_RENDER_FAILED";
    readonly message: string;
  };
}

export interface EffectToolVideoFile {
  readonly stream: ReadStream;
  readonly bytes: number;
  readonly name: string;
  readonly close: () => Promise<void>;
}

interface StoredVideoTask {
  readonly owner: OwnerContext;
  readonly sourceAssetId: string;
  readonly outputPath: string;
  readonly controller: AbortController;
  view: EffectToolVideoExecutionView;
}

export interface EffectToolVideoServiceOptions {
  readonly media: Pick<TenantMediaStore, "resolve">;
  readonly outputRoot: string;
  readonly ffmpegPath?: string;
  readonly exportFrames?: typeof exportFixedFrames;
  readonly decodeFrame?: typeof decodeMediaFrame;
}

function taskKey(owner: OwnerContext, id: string): string {
  return JSON.stringify([owner.tenantId, owner.userId, id]);
}

function safeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Video ${label} is invalid.`);
  }
  return value;
}

function videoMetadata(media: VerifiedStoredMedia) {
  if (media.asset.type !== "video") throw new TypeError("source_video requires an authorized video asset.");
  const sourceWidth = safeNumber(media.asset.metadata.width, "width");
  const sourceHeight = safeNumber(media.asset.metadata.height, "height");
  const durationSeconds = safeNumber(media.asset.metadata.duration, "duration");
  const sourceFps = safeNumber(media.asset.metadata.fps, "frame rate");
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight)
    || sourceWidth > MAX_EFFECT_DIMENSION || sourceHeight > MAX_EFFECT_DIMENSION) {
    throw new RangeError("Video dimensions exceed the effect render limit.");
  }
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new RangeError("Video duration exceeds the effect render limit.");
  }
  // H.264 yuv420p requires even dimensions; trim at most one decoded edge pixel.
  const width = sourceWidth - sourceWidth % 2;
  const height = sourceHeight - sourceHeight % 2;
  if (width < 2 || height < 2) throw new RangeError("Video dimensions are too small to encode as MP4.");
  const fps = Math.min(120, sourceFps);
  return {
    width,
    height,
    durationSeconds,
    fps,
    frameCount: Math.ceil(durationSeconds * fps),
    audio: Number(media.asset.metadata.audioStreams ?? 0) > 0
  };
}

function frameBytes(result: EffectRenderResult, request: FrameRequest): Uint8Array {
  if (result.kind !== "frame" || typeof result.output !== "object" || result.output === null) {
    throw new TypeError("The selected effect did not return a video frame.");
  }
  const output = result.output as Record<string, unknown>;
  if (output.width !== request.width || output.height !== request.height) {
    throw new RangeError("The effect output dimensions do not match the video frame.");
  }
  const data = output.data;
  if (!Array.isArray(data) && !(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) {
    throw new TypeError("The effect output frame is invalid.");
  }
  const bytes = Uint8Array.from(data as ArrayLike<number>);
  if (bytes.byteLength !== request.width * request.height * 4) {
    throw new RangeError("The effect output frame byte length is invalid.");
  }
  return bytes;
}

function safeFailureMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : "Video rendering failed.";
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

export class EffectToolVideoService {
  private readonly tasks = new Map<string, StoredVideoTask>();
  private queue: Promise<void> = Promise.resolve();
  private closing = false;
  private readonly outputRoot: string;
  private readonly exportFrames: typeof exportFixedFrames;
  private readonly decodeFrame: typeof decodeMediaFrame;

  constructor(private readonly options: EffectToolVideoServiceOptions) {
    this.outputRoot = resolve(options.outputRoot);
    this.exportFrames = options.exportFrames ?? exportFixedFrames;
    this.decodeFrame = options.decodeFrame ?? decodeMediaFrame;
  }

  async create(
    owner: OwnerContext,
    sourceAssetId: string,
    definition: EffectToolDefinition,
    envelope: EffectParameterEnvelope,
    seed: number
  ): Promise<EffectToolVideoExecutionView> {
    if (this.closing) throw new Error("Effect video service is closing.");
    const media = await this.options.media.resolve(owner, sourceAssetId);
    const metadata = videoMetadata(media);
    const id = randomUUID();
    const directory = join(this.outputRoot, id);
    const outputPath = join(directory, "output.mp4");
    const now = new Date().toISOString();
    const task: StoredVideoTask = {
      owner: { ...owner },
      sourceAssetId,
      outputPath,
      controller: new AbortController(),
      view: {
        id,
        status: "queued",
        toolName: definition.toolName,
        createdAt: now,
        updatedAt: now,
        source: { kind: "video", assetId: sourceAssetId },
        video: {
          format: "mp4",
          mime: "video/mp4",
          ...metadata,
          completedFrames: 0,
          progress: 0
        }
      }
    };
    this.tasks.set(taskKey(owner, id), task);
    this.queue = this.queue.then(() => this.run(task, media, definition, envelope, seed), () => this.run(task, media, definition, envelope, seed));
    return structuredClone(task.view);
  }

  get(owner: OwnerContext, id: string): EffectToolVideoExecutionView {
    const task = this.tasks.get(taskKey(owner, id));
    if (task === undefined) throw new Error("Task not found or access denied.");
    return structuredClone(task.view);
  }

  usesAsset(owner: OwnerContext, assetId: string): boolean {
    return [...this.tasks.values()].some((task) => task.owner.tenantId === owner.tenantId
      && task.owner.userId === owner.userId && task.sourceAssetId === assetId
      && (task.view.status === "queued" || task.view.status === "running"));
  }

  async open(owner: OwnerContext, id: string, range?: { start: number; end: number }): Promise<EffectToolVideoFile> {
    const task = this.tasks.get(taskKey(owner, id));
    if (task === undefined || task.view.status !== "completed" || task.view.video.bytes === undefined
      || task.view.video.downloadName === undefined) {
      throw new Error("Task not found or access denied.");
    }
    const handle = await open(task.outputPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile() || info.size !== task.view.video.bytes) {
      await handle.close();
      throw new Error("Task not found or access denied.");
    }
    const stream = handle.createReadStream({
      autoClose: true,
      ...(range === undefined ? {} : { start: range.start, end: range.end })
    });
    return {
      stream,
      bytes: info.size,
      name: task.view.video.downloadName,
      close: async () => {
        if (!stream.closed) {
          const closed = new Promise<void>((resolveClose) => stream.once("close", resolveClose));
          stream.destroy();
          await closed;
        }
      }
    };
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const task of this.tasks.values()) task.controller.abort();
    await this.queue.catch(() => undefined);
  }

  private async run(
    task: StoredVideoTask,
    initialMedia: VerifiedStoredMedia,
    definition: EffectToolDefinition,
    envelope: EffectParameterEnvelope,
    seed: number
  ): Promise<void> {
    if (this.closing || task.controller.signal.aborted) return;
    const update = (view: EffectToolVideoExecutionView): void => { task.view = Object.freeze(view); };
    update({ ...task.view, status: "running", updatedAt: new Date().toISOString() });
    try {
      await mkdir(join(this.outputRoot, task.view.id), { recursive: true });
      const media = await this.options.media.resolve(task.owner, task.sourceAssetId, task.controller.signal);
      if (media.asset.hash !== initialMedia.asset.hash || media.trustedBytes !== initialMedia.trustedBytes) {
        throw new Error("The source video changed before rendering.");
      }
      const metadata = videoMetadata(media);
      const preset = validateExportPreset({
        id: "ae-agent-mp4",
        name: "AE Agent MP4",
        format: "mp4",
        quality: "final",
        settings: {
          width: metadata.width,
          height: metadata.height,
          fps: metadata.fps,
          alpha: false,
          audio: metadata.audio,
          videoCodec: "libx264",
          ...(metadata.audio ? { audioCodec: "aac" } : {}),
          crf: 18
        }
      });
      await this.exportFrames({
        preset,
        duration: metadata.durationSeconds,
        outputPath: task.outputPath,
        ...(metadata.audio ? { audioPath: media.storedPath } : {}),
        ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
        signal: task.controller.signal,
        renderFrame: async (request, signal) => {
          const pixels = await this.decodeFrame(media, request, signal === undefined ? {} : { signal });
          const context: ServerEffectRenderContext = {
            environment: "server",
            requestId: `${task.view.id}:${request.frame}`,
            tenantId: task.owner.tenantId,
            userId: task.owner.userId,
            time: request.time,
            deltaTime: request.deltaTime,
            frame: request.frame,
            fps: request.fps,
            width: request.width,
            height: request.height,
            seed,
            quality: "final",
            backend: definition.primaryBackend,
            inputs: {
              source_frame: {
                slot: "source_frame",
                kind: "image",
                tenantId: task.owner.tenantId,
                userId: task.owner.userId,
                locked: true,
                binding: { width: request.width, height: request.height, data: pixels }
              }
            },
            ...(signal === undefined ? {} : { signal })
          };
          const result = await executeSelectedEffectTool(definition, definition.toolName, envelope, context);
          const completedFrames = request.frame + 1;
          update({
            ...task.view,
            updatedAt: new Date().toISOString(),
            video: {
              ...task.view.video,
              completedFrames,
              progress: Math.min(1, completedFrames / metadata.frameCount)
            }
          });
          return frameBytes(result, request);
        }
      });
      const bytes = (await stat(task.outputPath)).size;
      update({
        ...task.view,
        status: "completed",
        updatedAt: new Date().toISOString(),
        video: {
          ...task.view.video,
          completedFrames: metadata.frameCount,
          progress: 1,
          bytes,
          downloadName: `ae-agent-${definition.toolName}-${task.view.id}.mp4`
        }
      });
    } catch (error) {
      if (task.controller.signal.aborted && this.closing) return;
      update({
        ...task.view,
        status: "failed",
        updatedAt: new Date().toISOString(),
        failure: { code: "VIDEO_RENDER_FAILED", message: safeFailureMessage(error) }
      });
    }
  }
}
