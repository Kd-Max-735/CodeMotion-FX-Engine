import { constants as fsConstants, type ReadStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { MotionProject } from "@codemotion/core";
import { evaluateAnimatable } from "@codemotion/timeline";
import {
  P0_BROWSER_PROJECT_AUTHORITY_V1
} from "@codemotion/effects-2d";
import {
  ExportFrameError,
  projectMediaReferences,
  runProcess,
  validateExportPreset,
  type ExportPreset,
  type VerifiedStoredMedia
} from "@codemotion/exporter";
import type {
  BrowserProjectEnvelopeV1,
  ExportCreateRequestV1,
  ExportSettingsV1,
  ExportTaskFailureV1,
  ExportTaskViewV1
} from "@codemotion/schema";
import { estimateExportBytes } from "./export-center.js";
import type { AuthSessionService, AuthenticatedSessionPrincipal } from "./auth-session-service.js";
import {
  materializeBrowserProjectV1,
  ProjectServiceError,
  type OwnerMediaResolverV1,
  type TrustedProjectMaterializationV1
} from "./project-materialization.js";

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const RETENTION_MS = 24 * 60 * 60 * 1000;
const TOMBSTONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIVE_LEASE_DRAIN_MS = 30_000;
const FORCED_LEASE_DRAIN_MS = 5_000;

type DeletionPhase = "live" | "tombstoned-cleanup-pending" | "tombstoned-clean";

interface PersistedLease {
  readonly id: string;
  readonly runtimeId: string;
  readonly acquiredAt: string;
}

interface PersistedExportTask {
  readonly version: 1;
  readonly owner: { readonly tenantId: string; readonly userId: string };
  readonly envelope: BrowserProjectEnvelopeV1;
  readonly view: ExportTaskViewV1;
  readonly outputPath: string;
  readonly downloadPath?: string;
  readonly pendingFiles: readonly string[];
  readonly deletionPhase: DeletionPhase;
  readonly tombstonedAt?: string;
  readonly leases: readonly PersistedLease[];
  readonly cleanupAttempts: number;
  readonly nextCleanupAt?: string;
  readonly cleanupFailure?: "filesystem";
}

interface RuntimeTask {
  record: PersistedExportTask;
  controller?: AbortController;
  execution: Promise<void> | undefined;
}

interface QueuedRender { readonly task: RuntimeTask; readonly materialized: TrustedProjectMaterializationV1; }

const EXPORT_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const controller = new AbortController();
parentPort.on("message", (message) => { if (message && message.type === "cancel") controller.abort(); });
(async () => {
  const exporter = await import("@codemotion/exporter");
  const effects = await import("@codemotion/effects-2d");
  const media = new Map(workerData.media);
  const coverageAssets = new Map([["builtin://brush/round", effects.makeBrushCoverage()]]);
  const project = workerData.project;
  const producer = exporter.createProjectFrameProducer(project, media, {
    timeContractVersion: "1.1.0", coverageAssets,
    resolveRasterSource: (context) => effects.resolveFormal2dRasterSourceV1({
      layer: context.layer, compositionWidth: context.composition.width,
      compositionHeight: context.composition.height, renderWidth: context.request.width,
      renderHeight: context.request.height, projectSeed: context.project.seed,
      projectTime: context.projectTime.projectTime, layerTime: context.layerTime.localTime,
      signal: controller.signal
    })
  });
  const report = await exporter.exportFixedFrames({
    preset: workerData.preset, duration: workerData.settings.duration,
    outputPath: workerData.outputPath,
    renderFrame: async (request, frameSignal) => {
      controller.signal.throwIfAborted();
      const frame = await producer(request, frameSignal || controller.signal);
      parentPort.postMessage({ type: "progress", completedFrames: request.frame + 1 });
      return frame;
    },
    ...(workerData.mixedAudio ? { audioPath: workerData.mixedAudio } : {}),
    signal: controller.signal
  });
  parentPort.postMessage({ type: "completed", report });
})().catch((error) => parentPort.postMessage({ type: "failed", name: error?.name, message: String(error?.message || error) }));
`;

interface DownloadLease {
  readonly taskId: string;
  readonly leaseId: string;
  readonly path: string;
  readonly name: string;
  readonly bytes: number;
  readonly format: ExportSettingsV1["format"];
  readonly controller: AbortController;
  release(): Promise<void>;
}

export class ExportServiceError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function ownerKey(owner: { tenantId: string; userId: string }, taskId: string): string {
  return JSON.stringify([owner.tenantId, owner.userId, taskId]);
}

function ownerOf(principal: AuthenticatedSessionPrincipal): { tenantId: string; userId: string } {
  return { tenantId: principal.tenantId, userId: principal.userId };
}

function inside(path: string, root: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function codec(format: ExportSettingsV1["format"]): ExportTaskViewV1["video"]["codec"] {
  return format === "png-sequence" ? "png" : format === "gif" ? "gif" : format === "webm" ? "libvpx-vp9" : "libx264";
}

function audioCodec(settings: ExportSettingsV1): "libopus" | "aac" | undefined {
  if (!settings.audio) return undefined;
  return settings.format === "webm" ? "libopus" : "aac";
}

function extension(format: ExportSettingsV1["format"]): string {
  return format === "png-sequence" ? ".zip" : `.${format}`;
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "export";
}

function contentType(format: ExportSettingsV1["format"]): string {
  return format === "png-sequence" ? "application/zip" : format === "gif" ? "image/gif"
    : format === "webm" ? "video/webm" : "video/mp4";
}

function disposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "export";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function preset(settings: ExportSettingsV1): ExportPreset {
  const selectedAudioCodec = audioCodec(settings);
  return validateExportPreset({
    id: `editor-${settings.format}`,
    name: `Editor ${settings.format}`,
    format: settings.format,
    quality: "final",
    settings: {
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      alpha: settings.alpha,
      audio: settings.audio,
      crf: 18,
      videoCodec: codec(settings.format),
      ...(selectedAudioCodec === undefined ? {} : { audioCodec: selectedAudioCodec })
    }
  });
}

function safeFailure(error: unknown, completedFrames: number, settings: ExportSettingsV1): ExportTaskFailureV1 {
  const source = error instanceof ExportFrameError ? error.failure : undefined;
  const stage = source?.stage ?? "encode";
  const code = stage === "render" ? "FRAME_RENDER_FAILED"
    : stage === "inspect" ? "FRAME_INSPECTION_FAILED" : "OUTPUT_ENCODING_FAILED";
  const message = code === "FRAME_RENDER_FAILED" ? "Frame rendering failed."
    : code === "FRAME_INSPECTION_FAILED" ? "Rendered frame validation failed." : "Output encoding failed.";
  return {
    stage,
    frame: source?.frame ?? completedFrames,
    time: source?.time ?? completedFrames / settings.fps,
    recoverFromFrame: source?.recoverFromFrame ?? 0,
    code,
    message
  };
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function zipPngSequence(directory: string, target: string, frameCount: number, signal: AbortSignal): Promise<void> {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (let frame = 0; frame < frameCount; frame += 1) {
    signal.throwIfAborted();
    const name = `frame-${String(frame).padStart(8, "0")}.png`;
    const data = await readFile(join(directory, name), { signal });
    const encodedName = Buffer.from(name);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(encodedName.length, 26);
    local.push(header, encodedName, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(encodedName.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, encodedName);
    offset += header.length + encodedName.length + data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(frameCount, 8);
  end.writeUInt16LE(frameCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(target, Buffer.concat([...local, ...central, end]), { signal });
}

async function verifyEncodedOutput(
  path: string,
  settings: ExportSettingsV1,
  signal: AbortSignal
): Promise<void> {
  if (settings.format === "png-sequence") return;
  const probe = await runProcess("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name:format=duration", "-of", "json", path
  ], { signal });
  const parsed = JSON.parse(probe.stdout.toString("utf8")) as {
    streams?: Array<{ codec_type?: string; codec_name?: string }>;
    format?: { duration?: string };
  };
  const expectedVideo = settings.format === "gif" ? "gif" : settings.format === "webm" ? "vp9" : "h264";
  if (!parsed.streams?.some((stream) => stream.codec_type === "video" && stream.codec_name === expectedVideo)) throw new Error("Invalid video stream.");
  const expectedAudio = settings.audio ? (settings.format === "webm" ? "opus" : "aac") : undefined;
  if (expectedAudio !== undefined && !parsed.streams.some((stream) => stream.codec_type === "audio" && stream.codec_name === expectedAudio)) {
    throw new Error("Invalid audio stream.");
  }
  if (expectedAudio === undefined && parsed.streams.some((stream) => stream.codec_type === "audio")) throw new Error("Unexpected audio stream.");
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration) || Math.abs(duration - settings.duration) > 1 / settings.fps + 0.05) throw new Error("Invalid output duration.");
  await runProcess("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"], { signal });
}

export interface ExportTaskServiceOptions {
  readonly resolver: OwnerMediaResolverV1;
  readonly outputRoot: string;
  readonly now?: () => Date;
}

export class ExportTaskService {
  private readonly tasks = new Map<string, RuntimeTask>();
  private readonly runtimeId = randomUUID();
  private readonly leaseControllers = new Map<string, AbortController>();
  private readonly requestControllers = new Set<AbortController>();
  private readonly leaseReleases = new Map<string, { promise: Promise<void>; resolve: () => void }>();
  private readonly cleanupRuns = new Set<Promise<void>>();
  private readonly renderQueue: QueuedRender[] = [];
  private activeRender: RuntimeTask | undefined;
  private readonly outputRoot: string;
  private readonly now: () => Date;
  private mutation: Promise<void> = Promise.resolve();
  private initialized?: Promise<void>;
  private closing = false;
  private closePromise?: Promise<void>;

  private readonly options: ExportTaskServiceOptions;

  constructor(options: ExportTaskServiceOptions | string, legacyOutputRoot?: string) {
    this.options = typeof options === "string"
      ? {
        resolver: { resolve: async () => { throw new ProjectServiceError("SERVICE_CLOSING"); } },
        outputRoot: resolve(legacyOutputRoot ?? join(options, "..", "exports-disabled"))
      }
      : options;
    if (this.options.resolver === undefined || typeof this.options.resolver.resolve !== "function"
      || !Object.isFrozen(P0_BROWSER_PROJECT_AUTHORITY_V1)) {
      throw new Error("Browser project authority is not configured.");
    }
    this.outputRoot = resolve(this.options.outputRoot);
    this.now = this.options.now ?? (() => new Date());
  }

  async initialize(): Promise<this> {
    if (this.initialized === undefined) this.initialized = this.rehydrate();
    await this.initialized;
    return this;
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutation;
    let release!: () => void;
    this.mutation = new Promise<void>((resolveMutation) => { release = resolveMutation; });
    await previous;
    try { return await operation(); }
    finally { release(); }
  }

  private taskDirectory(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ExportServiceError(404, "NOT_FOUND");
    const directory = resolve(this.outputRoot, id);
    if (!inside(directory, this.outputRoot)) throw new ExportServiceError(404, "NOT_FOUND");
    return directory;
  }

  private async persist(task: RuntimeTask): Promise<void> {
    const directory = this.taskDirectory(task.record.view.id);
    await mkdir(directory, { recursive: true });
    const target = join(directory, "task-record-v1.json");
    const temporary = join(directory, `.task-record-v1.${this.runtimeId}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(task.record), { encoding: "utf8", flag: "wx" });
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  private lookup(owner: { tenantId: string; userId: string }, id: string): RuntimeTask {
    const task = this.tasks.get(ownerKey(owner, id));
    if (task === undefined || task.record.deletionPhase !== "live") throw new ExportServiceError(404, "NOT_FOUND");
    return task;
  }

  private safeView(task: RuntimeTask): ExportTaskViewV1 {
    const view = structuredClone(task.record.view);
    const validated = P0_BROWSER_PROJECT_AUTHORITY_V1.validateExportTaskView(view);
    if (!validated.valid) throw new Error("Invalid internal export task view.");
    return validated.value;
  }

  async list(principal: AuthenticatedSessionPrincipal): Promise<ExportTaskViewV1[]> {
    await this.initialize();
    const owner = ownerOf(principal);
    await this.sweep(owner);
    return [...this.tasks.values()]
      .filter((task) => task.record.owner.tenantId === owner.tenantId
        && task.record.owner.userId === owner.userId && task.record.deletionPhase === "live")
      .map((task) => this.safeView(task)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async get(principal: AuthenticatedSessionPrincipal, id: string): Promise<ExportTaskViewV1> {
    await this.initialize();
    const task = this.lookup(ownerOf(principal), id);
    const expires = Date.parse(task.record.view.expiresAt ?? "");
    if (Number.isFinite(expires) && this.now().getTime() >= expires) {
      await this.exclusive(() => this.tombstoneLocked(task));
      throw new ExportServiceError(404, "NOT_FOUND");
    }
    return this.safeView(task);
  }

  usesAsset(owner: { tenantId: string; userId: string }, assetId: string): boolean {
    return [...this.tasks.values()].some((task) => task.record.deletionPhase === "live"
      && task.record.owner.tenantId === owner.tenantId
      && task.record.owner.userId === owner.userId
      && ["queued", "running", "cancelling"].includes(task.record.view.status)
      && task.record.envelope.project.assets.some((asset) => asset.id === assetId));
  }

  async clear(principal: AuthenticatedSessionPrincipal, id: string): Promise<void> {
    await this.initialize();
    const task = this.lookup(ownerOf(principal), id);
    if (["queued", "running", "cancelling"].includes(task.record.view.status)) {
      throw new ExportServiceError(409, "EXPORT_TASK_ACTIVE");
    }
    if (task.record.leases.length > 0) throw new ExportServiceError(409, "EXPORT_TASK_LEASED");
    await this.exclusive(async () => {
      if (task.record.deletionPhase !== "live") throw new ExportServiceError(404, "NOT_FOUND");
      if (["queued", "running", "cancelling"].includes(task.record.view.status)) {
        throw new ExportServiceError(409, "EXPORT_TASK_ACTIVE");
      }
      if (task.record.leases.length > 0) throw new ExportServiceError(409, "EXPORT_TASK_LEASED");
      await this.tombstoneLocked(task);
    });
  }

  async create(
    principal: AuthenticatedSessionPrincipal,
    rawRequest: unknown,
    controller = new AbortController()
  ): Promise<ExportTaskViewV1> {
    await this.initialize();
    if (this.closing) throw new ProjectServiceError("SERVICE_CLOSING");
    this.requestControllers.add(controller);
    try {
      controller.signal.throwIfAborted();
      const validated = P0_BROWSER_PROJECT_AUTHORITY_V1.validateExportCreateRequest(rawRequest);
      if (!validated.valid) {
        const code = validated.error.code;
        throw new ProjectServiceError(code === "PROJECT_TOO_LARGE" ? "PROJECT_TOO_LARGE"
          : code === "UNSUPPORTED_CONTRACT" ? "UNSUPPORTED_CONTRACT"
            : code === "BROWSER_PROJECT_UNSAFE" ? "BROWSER_PROJECT_UNSAFE"
              : isExportRequestShape(rawRequest) ? "PROJECT_VALIDATION_FAILED" : "MALFORMED_REQUEST");
      }
      if (validated.value.settings.duration !== validated.value.editableProject.project.duration) {
        throw new ExportServiceError(422, "EXPORT_DURATION_MISMATCH");
      }
      const materialized = await materializeBrowserProjectV1(principal, validated.value.editableProject, this.options.resolver, controller.signal);
      controller.signal.throwIfAborted();
      this.validateAuthoritativeAudio(materialized, validated.value.settings);
      return this.createValidated(principal, validated.value, materialized, controller);
    } finally {
      this.requestControllers.delete(controller);
    }
  }

  private validateAuthoritativeAudio(materialized: TrustedProjectMaterializationV1, settings: ExportSettingsV1): void {
    if (!settings.audio) return;
    if (materialized.project.audioTracks.length === 0) throw new ProjectServiceError("PROJECT_VALIDATION_FAILED");
    for (const track of materialized.project.audioTracks) {
      const audio = materialized.media.get(track.assetId);
      const duration = audio?.asset.metadata.duration;
      const requiredDuration = Math.max(0, Math.min(track.endTime, settings.duration) - track.startTime);
      if ((audio?.asset.type !== "audio" && audio?.asset.type !== "video")
        || audio.asset.type === "video" && Number(audio.asset.metadata.audioStreams ?? 0) < 1
        || typeof duration !== "number" || !Number.isFinite(duration)
        || duration + 1 / settings.fps < requiredDuration) {
        throw new ProjectServiceError("PROJECT_VALIDATION_FAILED");
      }
    }
  }

  private async mixProjectAudio(
    project: MotionProject,
    materialized: TrustedProjectMaterializationV1,
    settings: ExportSettingsV1,
    target: string,
    signal: AbortSignal
  ): Promise<string | undefined> {
    if (!settings.audio) return undefined;
    const tracks = project.audioTracks.flatMap((track) => {
      const volume = evaluateAnimatable(track.volume, track.startTime);
      const media = materialized.media.get(track.assetId);
      return volume > 0 && media ? [{ track, volume, path: media.storedPath }] : [];
    });
    if (tracks.length === 0) return undefined;
    const inputs = tracks.flatMap((item) => ["-i", item.path]);
    const labels = tracks.map((item, index) => {
      const duration = Math.min(settings.duration - item.track.startTime, item.track.endTime - item.track.startTime);
      const delayMs = Math.max(0, Math.round(item.track.startTime * 1000));
      return `[${index}:a:0]atrim=0:${duration.toFixed(6)},asetpts=PTS-STARTPTS,volume=${item.volume.toFixed(6)},adelay=${delayMs}:all=1,apad=whole_dur=${settings.duration.toFixed(6)}[a${index}]`;
    });
    const mix = tracks.length === 1
      ? "[a0]anull[mix]"
      : `${tracks.map((_, index) => `[a${index}]`).join("")}amix=inputs=${tracks.length}:duration=longest:normalize=0[mix]`;
    await runProcess(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", ...inputs,
      "-filter_complex", [...labels, mix].join(";"), "-map", "[mix]",
      "-t", settings.duration.toFixed(6), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", target
    ], { signal });
    return target;
  }

  private async createValidated(
    principal: AuthenticatedSessionPrincipal,
    request: ExportCreateRequestV1,
    materialized: TrustedProjectMaterializationV1,
    controller: AbortController
  ): Promise<ExportTaskViewV1> {
    if (this.closing) throw new ProjectServiceError("SERVICE_CLOSING");
    controller.signal.throwIfAborted();
    const id = randomUUID();
    const directory = this.taskDirectory(id);
    const settings = structuredClone(request.settings);
    const selectedAudioCodec = audioCodec(settings);
    const outputPath = settings.format === "png-sequence" ? join(directory, "frames")
      : join(directory, `output${extension(settings.format)}`);
    const frameCount = Math.ceil(settings.duration * settings.fps);
    const now = this.now().toISOString();
    const downloadName = `${sanitizeName(materialized.project.name)}${extension(settings.format)}`;
    const mixedAudioPath = join(directory, "mixed-audio.wav");
    const pendingFiles = settings.format === "png-sequence"
      ? [
        ...Array.from({ length: frameCount }, (_, frame) => join(outputPath, `frame-${String(frame).padStart(8, "0")}.png`)),
        join(directory, "output.zip")
      ]
      : [outputPath, ...(settings.audio ? [mixedAudioPath] : [])];
    const record: PersistedExportTask = {
      version: 1,
      owner: ownerOf(principal),
      envelope: structuredClone(request.editableProject),
      view: {
        contract: "export-task/v1",
        id,
        projectName: materialized.project.name,
        format: settings.format,
        status: "queued",
        progress: 0,
        completedFrames: 0,
        frameCount,
        createdAt: now,
        updatedAt: now,
        settings,
        video: {
          codec: codec(settings.format),
          ...(selectedAudioCodec === undefined ? {} : { audioCodec: selectedAudioCodec }),
          width: settings.width,
          height: settings.height,
          fps: settings.fps,
          duration: settings.duration
        },
        estimatedBytes: estimateExportBytes(settings)
      },
      outputPath,
      pendingFiles,
      deletionPhase: "live",
      leases: [],
      cleanupAttempts: 0
    };
    const task: RuntimeTask = { record, controller, execution: undefined };
    const key = ownerKey(record.owner, id);
    try {
      await this.exclusive(async () => {
        controller.signal.throwIfAborted();
        await this.persist(task);
        controller.signal.throwIfAborted();
        this.tasks.set(key, task);
        controller.signal.throwIfAborted();
        this.start(task, materialized);
      });
    } catch (error) {
      if (this.tasks.get(key) === task) this.tasks.delete(key);
      for (const path of pendingFiles) await unlink(path).catch(() => undefined);
      await unlink(join(directory, "task-record-v1.json")).catch(() => undefined);
      await rmdir(join(directory, "frames")).catch(() => undefined);
      await rmdir(directory).catch(() => undefined);
      throw error;
    }
    return this.safeView(task);
  }

  async cancel(principal: AuthenticatedSessionPrincipal, id: string): Promise<ExportTaskViewV1> {
    await this.initialize();
    return this.exclusive(async () => {
      const task = this.lookup(ownerOf(principal), id);
      const status = task.record.view.status;
      if (status === "completed" || status === "failed") throw new ExportServiceError(409, "TASK_STATE_CONFLICT");
      if (status === "cancelled") return this.safeView(task);
      task.record = { ...task.record, view: { ...task.record.view, status: "cancelling", updatedAt: this.now().toISOString() } };
      await this.persist(task);
      task.controller?.abort();
      return this.safeView(task);
    });
  }

  async retry(
    principal: AuthenticatedSessionPrincipal,
    id: string,
    controller = new AbortController()
  ): Promise<ExportTaskViewV1> {
    await this.initialize();
    if (this.closing) throw new ProjectServiceError("SERVICE_CLOSING");
    this.requestControllers.add(controller);
    try {
      controller.signal.throwIfAborted();
      const task = this.lookup(ownerOf(principal), id);
      if (task.record.view.status !== "failed" && task.record.view.status !== "cancelled") {
        throw new ExportServiceError(409, "TASK_STATE_CONFLICT");
      }
      const materialized = await materializeBrowserProjectV1(principal, task.record.envelope, this.options.resolver, controller.signal);
      controller.signal.throwIfAborted();
      this.validateAuthoritativeAudio(materialized, task.record.view.settings);
      return this.createValidated(principal, {
        contract: "export-request/v1",
        editableProject: task.record.envelope,
        settings: task.record.view.settings
      }, materialized, controller);
    } finally {
      this.requestControllers.delete(controller);
    }
  }

  private start(task: RuntimeTask, materialized: TrustedProjectMaterializationV1): void {
    this.renderQueue.push({ task, materialized });
    this.drainRenderQueue();
  }

  private drainRenderQueue(): void {
    if (this.closing || this.activeRender) return;
    const next = this.renderQueue.shift();
    if (!next) return;
    this.activeRender = next.task;
    const execution = this.run(next.task, next.materialized);
    next.task.execution = execution;
    void execution.finally(() => {
      next.task.execution = undefined;
      if (this.activeRender === next.task) this.activeRender = undefined;
      this.drainRenderQueue();
    }).catch(() => undefined);
  }

  private renderInWorker(
    task: RuntimeTask,
    materialized: TrustedProjectMaterializationV1,
    mixedAudio: string | undefined,
    signal: AbortSignal
  ): Promise<{ readonly outputPath: string }> {
    return new Promise((resolveWorker, rejectWorker) => {
      const worker = new Worker(EXPORT_WORKER_SOURCE, {
        eval: true,
        workerData: {
          project: structuredClone(materialized.project), media: [...materialized.media.entries()],
          settings: structuredClone(task.record.view.settings), outputPath: task.record.outputPath,
          preset: preset(task.record.view.settings), mixedAudio
        }
      });
      let settled = false;
      let latestPersistedFrame = task.record.view.completedFrames;
      const finish = (error?: Error, report?: { readonly outputPath: string }): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", cancel);
        void worker.terminate();
        if (error) rejectWorker(error); else resolveWorker(report!);
      };
      const cancel = (): void => {
        worker.postMessage({ type: "cancel" });
        const forced = setTimeout(() => finish(new DOMException("Export cancelled.", "AbortError")), 2_000);
        forced.unref();
      };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      worker.on("message", (message: unknown) => {
        if (typeof message !== "object" || message === null) return;
        const event = message as { type?: string; completedFrames?: number; report?: { outputPath?: string }; message?: string };
        if (event.type === "progress" && Number.isInteger(event.completedFrames)) {
          const completedFrames = event.completedFrames!;
          if (completedFrames === task.record.view.frameCount || completedFrames - latestPersistedFrame >= Math.max(1, Math.floor(task.record.view.settings.fps / 2))) {
            latestPersistedFrame = completedFrames;
            void this.update(task, (record) => ({ ...record, view: { ...record.view, completedFrames,
              progress: Math.min(1, completedFrames / record.view.frameCount), updatedAt: this.now().toISOString() } })).catch(() => undefined);
          }
        } else if (event.type === "completed" && typeof event.report?.outputPath === "string") finish(undefined, { outputPath: event.report.outputPath });
        else if (event.type === "failed") finish(new Error(`EXPORT_WORKER_FAILED: ${event.message ?? "unknown"}`));
      });
      worker.once("error", (error) => finish(new Error(`EXPORT_WORKER_CRASHED: ${error.message}`)));
      worker.once("exit", (code) => { if (!settled && code !== 0) finish(new Error(`EXPORT_WORKER_CRASHED: exit ${code}`)); });
    });
  }

  private async update(task: RuntimeTask, update: (record: PersistedExportTask) => PersistedExportTask): Promise<void> {
    await this.exclusive(async () => {
      task.record = update(task.record);
      await this.persist(task);
    });
  }

  private async run(task: RuntimeTask, materialized: TrustedProjectMaterializationV1): Promise<void> {
    const signal = task.controller!.signal;
    const settings = task.record.view.settings;
    try {
      await this.update(task, (record) => ({
        ...record,
        view: { ...record.view, status: "running", updatedAt: this.now().toISOString() }
      }));
      signal.throwIfAborted();
      const project: MotionProject = materialized.project;
      const mixedAudio = await this.mixProjectAudio(project, materialized, settings,
        join(this.taskDirectory(task.record.view.id), "mixed-audio.wav"), signal);
      const report = await this.renderInWorker(task, materialized, mixedAudio, signal);
      let downloadPath = report.outputPath;
      if (settings.format === "png-sequence") {
        downloadPath = join(this.taskDirectory(task.record.view.id), "output.zip");
        await zipPngSequence(report.outputPath, downloadPath, task.record.view.frameCount, signal);
      }
      await verifyEncodedOutput(downloadPath, settings, signal);
      const outputBytes = (await stat(downloadPath)).size;
      const terminal = this.now();
      await this.update(task, (record) => ({
        ...record,
        downloadPath,
        view: {
          ...record.view,
          status: "completed",
          progress: 1,
          completedFrames: record.view.frameCount,
          updatedAt: terminal.toISOString(),
          outputBytes,
          downloadName: `${sanitizeName(project.name)}${extension(settings.format)}`,
          expiresAt: new Date(terminal.getTime() + RETENTION_MS).toISOString()
        }
      }));
    } catch (error) {
      const cancelled = signal.aborted || task.record.view.status === "cancelling" || this.closing;
      const terminal = this.now();
      await this.update(task, (record) => ({
        ...record,
        view: cancelled ? {
          ...record.view,
          status: "cancelled",
          updatedAt: terminal.toISOString(),
          expiresAt: new Date(terminal.getTime() + RETENTION_MS).toISOString()
        } : {
          ...record.view,
          status: "failed",
          updatedAt: terminal.toISOString(),
          expiresAt: new Date(terminal.getTime() + RETENTION_MS).toISOString(),
          failure: safeFailure(error, record.view.completedFrames, settings)
        }
      }));
      await this.cleanupPending(task, false);
    }
  }

  private async cleanupPending(task: RuntimeTask, tombstone: boolean): Promise<void> {
    const remaining: string[] = [];
    for (const path of task.record.pendingFiles) {
      if (!inside(path, this.taskDirectory(task.record.view.id))) {
        remaining.push(path);
        continue;
      }
      try { await unlink(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") remaining.push(path);
      }
    }
    const attempts = remaining.length > 0 ? task.record.cleanupAttempts + 1 : task.record.cleanupAttempts;
    const delay = attempts === 1 ? 60_000 : attempts === 2 ? 300_000 : attempts === 3 ? 1_800_000 : 3_600_000;
    await this.update(task, (record) => {
      const {
        nextCleanupAt: _nextCleanupAt,
        cleanupFailure: _cleanupFailure,
        ...withoutCleanupState
      } = record;
      return {
        ...withoutCleanupState,
        pendingFiles: remaining,
        cleanupAttempts: attempts,
        ...(remaining.length > 0 ? { nextCleanupAt: new Date(this.now().getTime() + delay).toISOString() } : {}),
        ...(remaining.length > 0 ? { cleanupFailure: "filesystem" as const } : {}),
        ...(tombstone && remaining.length === 0 ? { deletionPhase: "tombstoned-clean" as const } : {})
      };
    });
    if (remaining.length === 0) {
      await rmdir(join(this.taskDirectory(task.record.view.id), "frames")).catch(() => undefined);
    }
  }

  async acquireDownload(principal: AuthenticatedSessionPrincipal, id: string): Promise<DownloadLease> {
    await this.initialize();
    if (this.closing) throw new ProjectServiceError("SERVICE_CLOSING");
    return this.exclusive(async () => {
      const task = this.lookup(ownerOf(principal), id);
      const expiresAt = Date.parse(task.record.view.expiresAt ?? "");
      if (task.record.view.status !== "completed" || !Number.isFinite(expiresAt)
        || this.now().getTime() >= expiresAt || task.record.downloadPath === undefined
        || task.record.view.downloadName === undefined || task.record.view.outputBytes === undefined) {
        if (Number.isFinite(expiresAt) && this.now().getTime() >= expiresAt) await this.tombstoneLocked(task);
        throw new ExportServiceError(404, "NOT_FOUND");
      }
      const leaseId = randomUUID();
      const controller = new AbortController();
      let resolveRelease!: () => void;
      const releasePromise = new Promise<void>((resolveLease) => { resolveRelease = resolveLease; });
      const lease = { id: leaseId, runtimeId: this.runtimeId, acquiredAt: this.now().toISOString() };
      const previous = task.record;
      task.record = { ...previous, leases: [...previous.leases, lease] };
      try { await this.persist(task); }
      catch (error) { task.record = previous; throw error; }
      this.leaseControllers.set(leaseId, controller);
      this.leaseReleases.set(leaseId, { promise: releasePromise, resolve: resolveRelease });
      const downloadPath = task.record.downloadPath;
      const downloadName = task.record.view.downloadName;
      const outputBytes = task.record.view.outputBytes;
      if (downloadPath === undefined || downloadName === undefined || outputBytes === undefined) {
        throw new ExportServiceError(404, "NOT_FOUND");
      }
      let released = false;
      return {
        taskId: id,
        leaseId,
        path: downloadPath,
        name: downloadName,
        bytes: outputBytes,
        format: task.record.view.settings.format,
        controller,
        release: async () => {
          if (released) return Promise.resolve();
          released = true;
          try { await this.releaseLease(task, leaseId); }
          catch (error) { released = false; throw error; }
        }
      };
    });
  }

  private async releaseLease(task: RuntimeTask, leaseId: string): Promise<void> {
    await this.exclusive(async () => {
      const settled = this.leaseReleases.get(leaseId);
      const previous = task.record;
      task.record = { ...previous, leases: previous.leases.filter((lease) => lease.id !== leaseId) };
      try { await this.persist(task); }
      catch (error) { task.record = previous; throw error; }
      this.leaseControllers.delete(leaseId);
      this.leaseReleases.delete(leaseId);
      settled?.resolve();
    });
  }

  private async tombstoneLocked(task: RuntimeTask): Promise<void> {
    if (task.record.deletionPhase !== "live") return;
    const previous = task.record;
    task.record = {
      ...previous,
      deletionPhase: "tombstoned-cleanup-pending",
      tombstonedAt: this.now().toISOString()
    };
    try { await this.persist(task); }
    catch (error) { task.record = previous; throw error; }
    this.scheduleCleanup(task);
  }

  private scheduleCleanup(task: RuntimeTask): void {
    const run = this.drainAndCleanup(task);
    this.cleanupRuns.add(run);
    void run.finally(() => { this.cleanupRuns.delete(run); }).catch(() => undefined);
  }

  private async drainAndCleanup(task: RuntimeTask): Promise<void> {
    if (task.record.leases.length > 0) {
      await this.waitForTaskLeases(task, ACTIVE_LEASE_DRAIN_MS);
      for (const lease of task.record.leases) this.leaseControllers.get(lease.id)?.abort();
      await this.waitForTaskLeases(task, FORCED_LEASE_DRAIN_MS);
    }
    await this.cleanupPending(task, true);
  }

  private async waitForTaskLeases(task: RuntimeTask, maximumMs: number): Promise<void> {
    const deadline = Date.now() + maximumMs;
    while (task.record.leases.length > 0 && Date.now() < deadline) {
      const releases = task.record.leases
        .map((lease) => this.leaseReleases.get(lease.id)?.promise)
        .filter((promise): promise is Promise<void> => promise !== undefined);
      if (releases.length === 0) break;
      await Promise.race([
        Promise.allSettled(releases),
        new Promise((resolveWait) => setTimeout(resolveWait, Math.min(100, Math.max(1, deadline - Date.now()))))
      ]);
    }
  }

  async sweep(owner?: { tenantId: string; userId: string }): Promise<void> {
    await this.initialize();
    const now = this.now().getTime();
    for (const task of this.tasks.values()) {
      if (owner !== undefined && (task.record.owner.tenantId !== owner.tenantId
        || task.record.owner.userId !== owner.userId)) continue;
      const expires = Date.parse(task.record.view.expiresAt ?? "");
      if (task.record.deletionPhase === "live" && Number.isFinite(expires) && now >= expires) {
        await this.exclusive(() => this.tombstoneLocked(task));
      } else if (task.record.deletionPhase === "tombstoned-cleanup-pending"
        && (task.record.nextCleanupAt === undefined || now >= Date.parse(task.record.nextCleanupAt))) {
        await this.drainAndCleanup(task);
      } else if (task.record.deletionPhase === "live"
        && (task.record.view.status === "failed" || task.record.view.status === "cancelled")
        && task.record.pendingFiles.length > 0
        && (task.record.nextCleanupAt === undefined || now >= Date.parse(task.record.nextCleanupAt))) {
        await this.cleanupPending(task, false);
      } else if (task.record.deletionPhase === "tombstoned-clean") {
        const tombstoned = Date.parse(task.record.tombstonedAt ?? "");
        if (Number.isFinite(tombstoned) && now >= tombstoned + TOMBSTONE_RETENTION_MS) {
          await unlink(join(this.taskDirectory(task.record.view.id), "task-record-v1.json")).catch(() => undefined);
          await rmdir(this.taskDirectory(task.record.view.id)).catch(() => undefined);
          this.tasks.delete(ownerKey(task.record.owner, task.record.view.id));
        }
      }
    }
  }

  private async rehydrate(): Promise<void> {
    await mkdir(this.outputRoot, { recursive: true });
    const entries = await readdir(this.outputRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
      const path = join(this.outputRoot, entry.name, "task-record-v1.json");
      try {
        const record = JSON.parse(await readFile(path, "utf8")) as PersistedExportTask;
        const directory = join(this.outputRoot, entry.name);
        const viewValidation = P0_BROWSER_PROJECT_AUTHORITY_V1.validateExportTaskView(record.view);
        if (record.version !== 1 || record.view.id !== entry.name || !viewValidation.valid
          || typeof record.owner?.tenantId !== "string" || typeof record.owner?.userId !== "string"
          || !inside(record.outputPath, directory)
          || (record.downloadPath !== undefined && !inside(record.downloadPath, directory))
          || !Array.isArray(record.pendingFiles)
          || record.pendingFiles.some((pending) => typeof pending !== "string" || !inside(pending, directory))) continue;
        const task: RuntimeTask = { record: { ...record, leases: [] }, execution: undefined };
        if (["queued", "running", "cancelling"].includes(record.view.status)) {
          const terminal = this.now();
          task.record = {
            ...task.record,
            view: {
              ...record.view,
              status: "cancelled",
              updatedAt: terminal.toISOString(),
              expiresAt: new Date(terminal.getTime() + RETENTION_MS).toISOString()
            }
          };
        }
        this.tasks.set(ownerKey(record.owner, record.view.id), task);
        await this.persist(task);
        if (task.record.deletionPhase === "tombstoned-cleanup-pending") {
          await this.drainAndCleanup(task);
        } else if (["cancelled", "failed"].includes(task.record.view.status) && task.record.pendingFiles.length > 0) {
          await this.cleanupPending(task, false);
        }
      } catch {
        // Corrupt records are not trusted or exposed.
      }
    }
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closing = true;
    this.closePromise = (async () => {
      for (const task of this.tasks.values()) task.controller?.abort();
      for (const controller of this.requestControllers) controller.abort(new ProjectServiceError("SERVICE_CLOSING"));
      for (const controller of this.leaseControllers.values()) controller.abort();
      const active = [
        ...[...this.tasks.values()].flatMap((task) => task.execution === undefined ? [] : [task.execution]),
        ...this.cleanupRuns
      ];
      const releases = [...this.leaseReleases.values()].map((lease) => lease.promise);
      await Promise.race([
        Promise.allSettled([...active, ...releases]),
        new Promise((resolveWait) => setTimeout(resolveWait, FORCED_LEASE_DRAIN_MS))
      ]);
      const deadline = Date.now() + FORCED_LEASE_DRAIN_MS;
      while (this.requestControllers.size > 0 && Date.now() < deadline) {
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, Math.min(10, deadline - Date.now())));
      }
    })();
    return this.closePromise;
  }
}

function isExportRequestShape(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3 && keys[0] === "contract" && keys[1] === "editableProject" && keys[2] === "settings"
    && (value as { contract?: unknown }).contract === "export-request/v1";
}

async function jsonBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  const length = request.headers["content-length"];
  if (typeof length === "string" && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new ProjectServiceError("PROJECT_TOO_LARGE");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    signal.throwIfAborted();
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new ProjectServiceError("PROJECT_TOO_LARGE");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ProjectServiceError("MALFORMED_REQUEST"); }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, error: unknown): void {
  const status = error instanceof ProjectServiceError || error instanceof ExportServiceError ? error.status
    : typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 500;
  const code = error instanceof ProjectServiceError || error instanceof ExportServiceError ? error.code
    : typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : "EXPORT_FAILED";
  const messages: Readonly<Record<string, string>> = Object.freeze({
    UNAUTHENTICATED: "Authentication is required.", FORBIDDEN: "The required permission is missing.",
    REQUEST_ORIGIN_REJECTED: "The request origin was rejected.", NOT_FOUND: "The requested object was not found.",
    TASK_STATE_CONFLICT: "The task state does not permit this operation.", MALFORMED_REQUEST: "The request is malformed.",
    EXPORT_TASK_ACTIVE: "An active export task cannot be cleared.",
    EXPORT_TASK_LEASED: "An export task with an active download cannot be cleared.",
    EXPORT_DURATION_MISMATCH: "Export duration must match the authoritative project duration.",
    UNSUPPORTED_CONTRACT: "Unsupported contract.", PROJECT_TOO_LARGE: "The project exceeds the allowed size.",
    BROWSER_PROJECT_UNSAFE: "The browser project is unsafe.", PROJECT_VALIDATION_FAILED: "Project validation failed.",
    ASSET_REFERENCE_INVALID: "A project asset reference is invalid.",
    MEDIA_STORAGE_UNAVAILABLE: "Media storage is temporarily unavailable.",
    MEDIA_VALIDATION_FAILED: "Media validation failed.",
    ASSET_CHANGED_DURING_MATERIALIZATION: "The project asset changed during validation.",
    SERVICE_CLOSING: "The service is closing.",
    EXPORT_FAILED: "Export failed."
  });
  sendJson(response, status, {
    error: { code, message: messages[code] ?? "Export failed.", retryable: status >= 500, requestId: `req_${randomUUID()}` }
  });
}

function decodeId(value: string): string {
  try { return decodeURIComponent(value); }
  catch { throw new ExportServiceError(404, "NOT_FOUND"); }
}

export function createExportApi(
  service: ExportTaskService,
  auth?: Pick<AuthSessionService, "authorize" | "verifySameOriginDownload">
) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const collection = url.pathname === "/api/editor-exports";
    const item = /^\/api\/editor-exports\/([^/]+)$/.exec(url.pathname);
    const cancel = /^\/api\/editor-exports\/([^/]+)\/cancel$/.exec(url.pathname);
    const retry = /^\/api\/editor-exports\/([^/]+)\/retry$/.exec(url.pathname);
    const download = /^\/api\/editor-exports\/([^/]+)\/download$/.exec(url.pathname);
    const matched = request.method === "GET" && (collection || item !== null || download !== null)
      || request.method === "POST" && (collection || cancel !== null || retry !== null)
      || request.method === "DELETE" && item !== null;
    if (!matched) return next();
    let removeDisconnectListeners = (): void => undefined;
    try {
      if (auth === undefined) throw new ExportServiceError(401, "UNAUTHENTICATED");
      const stateChanging = request.method === "POST" || request.method === "DELETE";
      const principal = await auth.authorize(request, response, stateChanging ? "export:create" : "export:read", stateChanging);
      if (request.method === "GET" && collection) return sendJson(response, 200, { tasks: await service.list(principal) });
      if (request.method === "POST" && collection) {
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        const close = (): void => { if (!response.writableEnded) abort(); };
        request.once("aborted", abort);
        response.once("close", close);
        removeDisconnectListeners = () => {
          request.off("aborted", abort);
          response.off("close", close);
        };
        return sendJson(response, 202, {
          task: await service.create(principal, await jsonBody(request, controller.signal), controller)
        });
      }
      if (request.method === "GET" && item) return sendJson(response, 200, { task: await service.get(principal, decodeId(item[1]!)) });
      if (request.method === "DELETE" && item) {
        if (request.headers["transfer-encoding"] !== undefined
          || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")) {
          throw new ExportServiceError(400, "MALFORMED_REQUEST");
        }
        await service.clear(principal, decodeId(item[1]!));
        response.statusCode = 204;
        response.setHeader("cache-control", "no-store");
        response.end();
        return;
      }
      if (request.method === "POST" && cancel) return sendJson(response, 200, { task: await service.cancel(principal, decodeId(cancel[1]!)) });
      if (request.method === "POST" && retry) {
        if (request.headers["transfer-encoding"] !== undefined
          || (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")) {
          throw new ExportServiceError(400, "MALFORMED_REQUEST");
        }
        const controller = new AbortController();
        const abort = (): void => controller.abort();
        const close = (): void => { if (!response.writableEnded) abort(); };
        request.once("aborted", abort);
        response.once("close", close);
        removeDisconnectListeners = () => {
          request.off("aborted", abort);
          response.off("close", close);
        };
        return sendJson(response, 202, { task: await service.retry(principal, decodeId(retry[1]!), controller) });
      }
      if (request.method === "GET" && download) {
        auth.verifySameOriginDownload(request);
        if (request.headers.range !== undefined) throw new ExportServiceError(400, "MALFORMED_REQUEST");
        const lease = await service.acquireDownload(principal, decodeId(download[1]!));
        let stream: ReadStream | undefined;
        let handle: Awaited<ReturnType<typeof open>> | undefined;
        try {
          handle = await open(lease.path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
          const info = await handle.stat();
          if (!info.isFile() || info.size !== lease.bytes) {
            throw new ExportServiceError(404, "NOT_FOUND");
          }
          stream = handle.createReadStream({ autoClose: true, signal: lease.controller.signal });
          response.statusCode = 200;
          response.setHeader("content-type", contentType(lease.format));
          response.setHeader("content-length", String(lease.bytes));
          response.setHeader("cache-control", "private, no-store");
          response.setHeader("x-content-type-options", "nosniff");
          response.setHeader("content-disposition", disposition(lease.name));
          await new Promise<void>((resolveStream, rejectStream) => {
            const cleanup = (): void => {
              stream!.off("error", reject);
              response.off("close", complete);
              response.off("finish", complete);
            };
            const complete = (): void => { cleanup(); resolveStream(); };
            const reject = (error: Error): void => {
              cleanup();
              if (!response.destroyed) response.destroy();
              rejectStream(error);
            };
            stream!.once("error", reject);
            response.once("close", complete);
            response.once("finish", complete);
            stream!.pipe(response);
          });
        } finally {
          if (stream === undefined) {
            await handle?.close().catch(() => undefined);
          } else {
            const closed = stream.closed ? undefined : new Promise<void>((resolveClose) => stream!.once("close", resolveClose));
            stream.destroy();
            await closed;
          }
          await lease.release();
        }
        return;
      }
      throw new ExportServiceError(404, "NOT_FOUND");
    } catch (error) {
      if (!response.headersSent && !response.destroyed) sendError(response, error);
    } finally {
      removeDisconnectListeners();
    }
  };
}
