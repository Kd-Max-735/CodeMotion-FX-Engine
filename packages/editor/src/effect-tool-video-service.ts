import { constants as fsConstants, type ReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  executeSelectedEffectTool,
  type AuthorizedEffectInputs,
  type EffectParameterEnvelope,
  type EffectRenderResult,
  type EffectToolDefinition,
  type ServerEffectRenderContext
} from "@codemotion/effect-functions";
import {
  decodeMediaFrame,
  exportFixedFrames,
  validateExportPreset,
  type OwnerContext,
  type TenantMediaStore,
  type VerifiedStoredMedia
} from "@codemotion/exporter";
import { composeEffectToolFrame } from "./effect-tool-frame-compositor.js";

const DEFAULT_VIDEO_DURATION_SECONDS = 5;
const DEFAULT_VIDEO_FPS = 30;
const MAX_VIDEO_DURATION_SECONDS = 3_600;
const MAX_EFFECT_DIMENSION = 4_096;

export type EffectToolVideoTaskStatus = "queued" | "running" | "completed" | "failed";

export interface EffectToolVideoExecutionView {
  readonly id: string;
  readonly status: EffectToolVideoTaskStatus;
  readonly toolName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source?: {
    readonly kind: "image";
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
  readonly sourceAssetIds: readonly string[];
  readonly outputPath: string;
  readonly controller: AbortController;
  readonly prepared?: {
    readonly inputs: AuthorizedEffectInputs;
    readonly width: number;
    readonly height: number;
  };
  view: EffectToolVideoExecutionView;
}

export interface EffectToolVideoServiceOptions {
  readonly media: Pick<TenantMediaStore, "resolve">;
  readonly outputRoot: string;
  readonly ffmpegPath?: string;
  readonly exportFrames?: typeof exportFixedFrames;
  readonly decodeFrame?: typeof decodeMediaFrame;
  readonly durationSeconds?: number;
  readonly fps?: number;
}

function taskKey(owner: OwnerContext, id: string): string {
  return JSON.stringify([owner.tenantId, owner.userId, id]);
}

function safeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} is invalid.`);
  }
  return value;
}

function outputMetadata(media: VerifiedStoredMedia, durationSeconds: number, fps: number) {
  if (media.asset.type !== "image" && media.asset.type !== "svg") {
    throw new TypeError("source_image requires an authorized image asset.");
  }
  const sourceWidth = safeNumber(media.asset.metadata.width, "Image width");
  const sourceHeight = safeNumber(media.asset.metadata.height, "Image height");
  if (!Number.isInteger(sourceWidth) || !Number.isInteger(sourceHeight)
    || sourceWidth > MAX_EFFECT_DIMENSION || sourceHeight > MAX_EFFECT_DIMENSION) {
    throw new RangeError("Image dimensions exceed the effect render limit.");
  }
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new RangeError("Video duration exceeds the effect render limit.");
  }
  // H.264 yuv420p requires even dimensions; trim at most one decoded edge pixel.
  const width = sourceWidth - sourceWidth % 2;
  const height = sourceHeight - sourceHeight % 2;
  if (width < 2 || height < 2) throw new RangeError("Video dimensions are too small to encode as MP4.");
  return {
    width,
    height,
    durationSeconds,
    fps,
    frameCount: Math.ceil(durationSeconds * fps),
    audio: false
  };
}

function preparedOutputMetadata(width: number, height: number, durationSeconds: number, fps: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || width > MAX_EFFECT_DIMENSION || height > MAX_EFFECT_DIMENSION) {
    throw new RangeError("Video dimensions exceed the effect render limit.");
  }
  if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
    throw new RangeError("Video duration exceeds the effect render limit.");
  }
  const encodedWidth = width - width % 2;
  const encodedHeight = height - height % 2;
  return {
    width: encodedWidth,
    height: encodedHeight,
    durationSeconds,
    fps,
    frameCount: Math.ceil(durationSeconds * fps),
    audio: false
  };
}

function safeFailureMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : "Video rendering failed.";
  return value.replace(/[\r\n\t]+/g, " ").slice(0, 240);
}

function mayUsePreviewFallback(error: unknown): boolean {
  if (error instanceof TypeError || error instanceof RangeError) return true;
  if (typeof error !== "object" || error === null) return false;
  const value = error as { code?: unknown; name?: unknown };
  return value.code === "BATCH_06_ADAPTER_REQUIRED" || value.name === "Batch06AdapterRequiredError";
}

export class EffectToolVideoService {
  private readonly tasks = new Map<string, StoredVideoTask>();
  private queue: Promise<void> = Promise.resolve();
  private closing = false;
  private readonly outputRoot: string;
  private readonly exportFrames: typeof exportFixedFrames;
  private readonly decodeFrame: typeof decodeMediaFrame;
  private readonly durationSeconds: number;
  private readonly fps: number;

  constructor(private readonly options: EffectToolVideoServiceOptions) {
    this.outputRoot = resolve(options.outputRoot);
    this.exportFrames = options.exportFrames ?? exportFixedFrames;
    this.decodeFrame = options.decodeFrame ?? decodeMediaFrame;
    this.durationSeconds = safeNumber(options.durationSeconds ?? DEFAULT_VIDEO_DURATION_SECONDS, "Video duration");
    this.fps = safeNumber(options.fps ?? DEFAULT_VIDEO_FPS, "Video frame rate");
    if (this.durationSeconds > MAX_VIDEO_DURATION_SECONDS || !Number.isInteger(this.fps) || this.fps > 120) {
      throw new RangeError("Video output settings exceed the effect render limit.");
    }
  }

  async create(
    owner: OwnerContext,
    sourceAssetId: string,
    definition: EffectToolDefinition,
    envelope: EffectParameterEnvelope,
    seed: number,
    durationSeconds = this.durationSeconds
  ): Promise<EffectToolVideoExecutionView> {
    if (this.closing) throw new Error("Effect video service is closing.");
    safeNumber(durationSeconds, "Video duration");
    if (durationSeconds > MAX_VIDEO_DURATION_SECONDS) {
      throw new RangeError("Video duration exceeds the effect render limit.");
    }
    const media = await this.options.media.resolve(owner, sourceAssetId);
    const metadata = outputMetadata(media, durationSeconds, this.fps);
    const id = randomUUID();
    const directory = join(this.outputRoot, id);
    const outputPath = join(directory, "output.mp4");
    const now = new Date().toISOString();
    const task: StoredVideoTask = {
      owner: { ...owner },
      sourceAssetIds: Object.freeze([sourceAssetId]),
      outputPath,
      controller: new AbortController(),
      view: {
        id,
        status: "queued",
        toolName: definition.toolName,
        createdAt: now,
        updatedAt: now,
        source: { kind: "image", assetId: sourceAssetId },
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

  async createPrepared(
    owner: OwnerContext,
    definition: EffectToolDefinition,
    envelope: EffectParameterEnvelope,
    inputs: AuthorizedEffectInputs,
    sourceAssetIds: readonly string[],
    seed: number,
    durationSeconds = this.durationSeconds,
    width = 640,
    height = 360,
    sourceImageId?: string
  ): Promise<EffectToolVideoExecutionView> {
    if (this.closing) throw new Error("Effect video service is closing.");
    safeNumber(durationSeconds, "Video duration");
    const metadata = preparedOutputMetadata(width, height, durationSeconds, this.fps);
    const id = randomUUID();
    const directory = join(this.outputRoot, id);
    const outputPath = join(directory, "output.mp4");
    const now = new Date().toISOString();
    const task: StoredVideoTask = {
      owner: { ...owner },
      sourceAssetIds: Object.freeze([...sourceAssetIds]),
      outputPath,
      controller: new AbortController(),
      prepared: Object.freeze({ inputs, width: metadata.width, height: metadata.height }),
      view: {
        id,
        status: "queued",
        toolName: definition.toolName,
        createdAt: now,
        updatedAt: now,
        ...(sourceImageId === undefined ? {} : {
          source: { kind: "image" as const, assetId: sourceImageId }
        }),
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
    this.queue = this.queue.then(
      () => this.run(task, undefined, definition, envelope, seed),
      () => this.run(task, undefined, definition, envelope, seed)
    );
    return structuredClone(task.view);
  }

  get(owner: OwnerContext, id: string): EffectToolVideoExecutionView {
    const task = this.tasks.get(taskKey(owner, id));
    if (task === undefined) throw new Error("Task not found or access denied.");
    return structuredClone(task.view);
  }

  usesAsset(owner: OwnerContext, assetId: string): boolean {
    return [...this.tasks.values()].some((task) => task.owner.tenantId === owner.tenantId
      && task.owner.userId === owner.userId && task.sourceAssetIds.includes(assetId)
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
    initialMedia: VerifiedStoredMedia | undefined,
    definition: EffectToolDefinition,
    envelope: EffectParameterEnvelope,
    seed: number
  ): Promise<void> {
    if (this.closing || task.controller.signal.aborted) return;
    const update = (view: EffectToolVideoExecutionView): void => { task.view = Object.freeze(view); };
    update({ ...task.view, status: "running", updatedAt: new Date().toISOString() });
    try {
      await mkdir(join(this.outputRoot, task.view.id), { recursive: true });
      let metadata = preparedOutputMetadata(
        task.prepared?.width ?? task.view.video.width,
        task.prepared?.height ?? task.view.video.height,
        task.view.video.durationSeconds,
        task.view.video.fps
      );
      let sourcePixels: Uint8Array | undefined;
      if (task.prepared === undefined) {
        if (initialMedia === undefined || task.sourceAssetIds.length !== 1) {
          throw new Error("The source image binding is unavailable.");
        }
        const media = await this.options.media.resolve(task.owner, task.sourceAssetIds[0]!, task.controller.signal);
        if (media.asset.hash !== initialMedia.asset.hash || media.trustedBytes !== initialMedia.trustedBytes) {
          throw new Error("The source image changed before rendering.");
        }
        metadata = outputMetadata(media, task.view.video.durationSeconds, task.view.video.fps);
        sourcePixels = await this.decodeFrame(media, {
          frame: 0,
          time: 0,
          deltaTime: 1 / metadata.fps,
          fps: metadata.fps,
          width: metadata.width,
          height: metadata.height
        }, { signal: task.controller.signal });
      } else if (task.view.source !== undefined) {
        const media = await this.options.media.resolve(
          task.owner,
          task.view.source.assetId,
          task.controller.signal
        );
        if (media.asset.type !== "image" && media.asset.type !== "svg") {
          throw new TypeError("The preview source must remain an authorized image.");
        }
        sourcePixels = await this.decodeFrame(media, {
          frame: 0,
          time: 0,
          deltaTime: 1 / metadata.fps,
          fps: metadata.fps,
          width: metadata.width,
          height: metadata.height
        }, { signal: task.controller.signal });
      }
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
          audio: false,
          videoCodec: "libx264",
          crf: 18
        }
      });
      await this.exportFrames({
        preset,
        duration: metadata.durationSeconds,
        outputPath: task.outputPath,
        ...(this.options.ffmpegPath === undefined ? {} : { ffmpegPath: this.options.ffmpegPath }),
        signal: task.controller.signal,
        renderFrame: async (request, signal) => {
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
            inputs: task.prepared?.inputs ?? {
              source_frame: {
                slot: "source_frame",
                kind: "image",
                tenantId: task.owner.tenantId,
                userId: task.owner.userId,
                locked: true,
                binding: { width: request.width, height: request.height, data: sourcePixels! }
              }
            },
            ...(signal === undefined ? {} : { signal })
          };
          let result: EffectRenderResult | undefined;
          try {
            result = await executeSelectedEffectTool(definition, definition.toolName, envelope, context);
          } catch (error) {
            if (!mayUsePreviewFallback(error)) throw error;
          }
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
          return composeEffectToolFrame(result, request, definition.toolName, sourcePixels);
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
