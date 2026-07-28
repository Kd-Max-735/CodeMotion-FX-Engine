import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { MotionProject } from "@codemotion/core";
import { loadProject } from "@codemotion/schema";
import {
  ExportFrameError,
  createProjectFrameProducer,
  exportFixedFrames,
  projectMediaReferences,
  runProcess,
  validateExportPreset,
  verifyStoredMediaAsset,
  type ExportPreset,
  type FrameProducer,
  type ImportedMedia
} from "@codemotion/exporter";
import {
  estimateExportBytes,
  validateExportSettings,
  type ExportSettings,
  type ExportTaskFailure,
  type ExportTaskView
} from "./export-center.js";

interface InternalTask {
  view: ExportTaskView;
  project: MotionProject;
  settings: ExportSettings;
  outputPath: string;
  downloadPath?: string;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024;

async function verifyProjectMedia(
  project: MotionProject,
  settings: ExportSettings,
  storageDirectory: string
): Promise<Map<string, ImportedMedia>> {
  const references = projectMediaReferences(project);
  const ids = settings.audio
    ? [...references.visualAssetIds, ...references.audioAssetIds]
    : [...references.visualAssetIds];
  const verified = new Map<string, ImportedMedia>();
  for (const id of ids) {
    const asset = project.assets.find((entry) => entry.id === id);
    if (asset === undefined) throw new Error(`Project media reference ${id} is missing.`);
    verified.set(id, await verifyStoredMediaAsset({ asset, storageDirectory }));
  }
  return verified;
}

function codec(format: ExportSettings["format"]): { video: string; audio?: string } {
  if (format === "png-sequence") return { video: "png" };
  if (format === "gif") return { video: "gif" };
  if (format === "webm") return { video: "libvpx-vp9", audio: "libopus" };
  return { video: "libx264", audio: "aac" };
}

function extension(format: ExportSettings["format"]): string {
  return format === "png-sequence" ? "" : `.${format}`;
}

function sanitizeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "export";
}

function downloadContentType(name: string): string {
  const extension = extname(name).toLowerCase();
  if (extension === ".zip") return "application/zip";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webm") return "video/webm";
  return "video/mp4";
}

function downloadDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "export";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function preset(settings: ExportSettings): ExportPreset {
  const codecs = codec(settings.format);
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
      videoCodec: codecs.video,
      ...(codecs.audio ? { audioCodec: codecs.audio } : {})
    }
  });
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function zipPngSequence(directory: string, target: string): Promise<void> {
  const files = (await readdir(directory)).filter((name) => /^frame-\d+\.png$/.test(name)).sort();
  if (files.length === 0) throw new Error("PNG 序列没有生成可下载帧。");
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const name of files) {
    const data = await import("node:fs/promises").then(({ readFile }) => readFile(join(directory, name)));
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
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  await writeFile(target, Buffer.concat([...local, ...central, end]));
}

export class ExportTaskService {
  private readonly tasks = new Map<string, InternalTask>();
  private machine: ExportTaskView["machine"] = {
    mode: "local", platform: `${process.platform} ${process.arch}`, node: process.version, ffmpeg: "checking"
  };

  constructor(
    private readonly mediaRoot = resolve(process.env.CMFX_MEDIA_STORAGE ?? "tmp/stage-6-media"),
    private readonly outputRoot = resolve(process.env.CMFX_EXPORT_OUTPUT ?? "tmp/stage-6-render"),
    private readonly producerFactory: (
      project: MotionProject,
      media: ReadonlyMap<string, ImportedMedia>
    ) => FrameProducer = createProjectFrameProducer
  ) {
    void runProcess("ffmpeg", ["-version"]).then((result) => {
      this.machine = { ...this.machine, ffmpeg: result.stdout.toString("utf8").split(/\r?\n/)[0] ?? "ffmpeg" };
    }).catch(() => { this.machine = { ...this.machine, ffmpeg: "unavailable" }; });
  }

  list(): ExportTaskView[] {
    return [...this.tasks.values()].map(({ view }) => structuredClone(view)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(rawProject: unknown, settings: ExportSettings): Promise<ExportTaskView> {
    const project = loadProject(JSON.stringify(rawProject));
    const issues = validateExportSettings(project, settings);
    if (issues.length) throw new Error(issues.join(" "));
    await verifyProjectMedia(project, settings, this.mediaRoot)
      .catch(() => { throw new Error("工程媒体完整性校验失败。"); });
    preset(settings);
    const id = randomUUID();
    const frameCount = Math.ceil(settings.duration * settings.fps);
    const outputDirectory = resolve(this.outputRoot, id);
    const outputPath = settings.format === "png-sequence"
      ? join(outputDirectory, "frames")
      : join(outputDirectory, `${sanitizeName(project.name)}${extension(settings.format)}`);
    const now = new Date().toISOString();
    const codecs = codec(settings.format);
    const task: InternalTask = {
      project,
      settings: structuredClone(settings),
      outputPath,
      view: {
        id,
        projectName: project.name,
        format: settings.format,
        status: "queued",
        progress: 0,
        completedFrames: 0,
        frameCount,
        createdAt: now,
        updatedAt: now,
        logs: [`${now} 任务已由本地导出服务验证并排队。`],
        settings: structuredClone(settings),
        video: {
          codec: codecs.video, ...(settings.audio && codecs.audio ? { audioCodec: codecs.audio } : {}),
          width: settings.width, height: settings.height, fps: settings.fps, duration: settings.duration
        },
        estimatedBytes: estimateExportBytes(settings),
        machine: this.machine
      }
    };
    this.tasks.set(id, task);
    void this.run(task, 0);
    return structuredClone(task.view);
  }

  async retry(id: string): Promise<ExportTaskView> {
    const task = this.tasks.get(id);
    if (!task) throw new Error("任务不存在。");
    if (task.view.status !== "failed") throw new Error("只有失败任务可以重试。");
    const resume = task.settings.format === "png-sequence" ? task.view.failure?.recoverFromFrame ?? 0 : 0;
    const { failure: _failure, ...viewWithoutFailure } = task.view;
    task.view = {
      ...viewWithoutFailure,
      status: "queued",
      progress: resume / task.view.frameCount,
      completedFrames: resume,
      updatedAt: new Date().toISOString(),
      logs: [...task.view.logs, `${new Date().toISOString()} 重试已排队，从第 ${resume} 帧恢复。`]
    };
    void this.run(task, resume);
    return structuredClone(task.view);
  }

  download(id: string): { path: string; name: string; bytes: number } {
    const task = this.tasks.get(id);
    if (!task || task.view.status !== "completed" || !task.downloadPath || !task.view.downloadName || !task.view.outputBytes) {
      throw new Error("任务尚无可下载输出。");
    }
    return { path: task.downloadPath, name: task.view.downloadName, bytes: task.view.outputBytes };
  }

  private async run(task: InternalTask, resumeFromFrame: number): Promise<void> {
    const started = new Date().toISOString();
    task.view = {
      ...task.view, status: "running", updatedAt: started, machine: this.machine,
      logs: [...task.view.logs, `${started} FFmpeg 固定帧导出启动。`]
    };
    try {
      await mkdir(resolve(this.outputRoot, task.view.id), { recursive: true });
      const verified = await verifyProjectMedia(task.project, task.settings, this.mediaRoot);
      const producer = this.producerFactory(task.project, verified);
      const audioId = task.settings.audio ? projectMediaReferences(task.project).audioAssetIds[0] : undefined;
      const audioPath = audioId === undefined ? undefined : verified.get(audioId)?.storedPath;
      const report = await exportFixedFrames({
        preset: preset(task.settings),
        duration: task.settings.duration,
        outputPath: task.outputPath,
        renderFrame: async (request, signal) => {
          const frame = await producer(request, signal);
          task.view = {
            ...task.view,
            completedFrames: request.frame + 1,
            progress: Math.min(1, (request.frame + 1) / task.view.frameCount),
            updatedAt: new Date().toISOString()
          };
          return frame;
        },
        ...(audioPath ? { audioPath } : {}),
        ...(resumeFromFrame > 0 ? { resumeFromFrame } : {})
      });
      let downloadPath = report.outputPath;
      let downloadName = `${sanitizeName(task.project.name)}${extension(task.settings.format)}`;
      if (task.settings.format === "png-sequence") {
        downloadPath = resolve(this.outputRoot, task.view.id, `${sanitizeName(task.project.name)}-png.zip`);
        await zipPngSequence(report.outputPath, downloadPath);
        downloadName = basename(downloadPath);
      }
      const outputBytes = (await stat(downloadPath)).size;
      const ended = new Date().toISOString();
      task.downloadPath = downloadPath;
      task.view = {
        ...task.view,
        status: "completed",
        progress: 1,
        completedFrames: task.view.frameCount,
        outputBytes,
        downloadName,
        updatedAt: ended,
        logs: [...task.view.logs, `${ended} 完成 ${report.frameCount} 帧真实编码；输出 ${outputBytes} 字节。`]
      };
    } catch (cause) {
      const ended = new Date().toISOString();
      const rawFailure: ExportTaskFailure = cause instanceof ExportFrameError
        ? cause.failure
        : { stage: "validation", frame: task.view.completedFrames, time: task.view.completedFrames / task.settings.fps, recoverFromFrame: 0, message: String(cause) };
      const failure = {
        ...rawFailure,
        message: rawFailure.message
          .split(this.mediaRoot).join("[media]")
          .split(this.outputRoot).join("[output]")
      };
      task.view = {
        ...task.view,
        status: "failed",
        updatedAt: ended,
        failure,
        logs: [...task.view.logs, `${ended} 失败：${failure.message}`]
      };
    }
  }
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) throw new Error("请求体超过 5 MB。");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function createExportApi(service = new ExportTaskService()) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/editor-exports")) return next();
    try {
      if (request.method === "GET" && url.pathname === "/api/editor-exports") {
        sendJson(response, 200, { tasks: service.list() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/editor-exports") {
        const body = await jsonBody(request) as { project?: unknown; settings?: ExportSettings };
        if (!body.settings) throw new Error("缺少导出设置。");
        sendJson(response, 202, { task: await service.create(body.project, body.settings) });
        return;
      }
      const retry = /^\/api\/editor-exports\/([^/]+)\/retry$/.exec(url.pathname);
      if (request.method === "POST" && retry) {
        sendJson(response, 202, { task: await service.retry(decodeURIComponent(retry[1]!)) });
        return;
      }
      const download = /^\/api\/editor-exports\/([^/]+)\/download$/.exec(url.pathname);
      if (request.method === "GET" && download) {
        const file = service.download(decodeURIComponent(download[1]!));
        response.statusCode = 200;
        response.setHeader("content-type", downloadContentType(file.name));
        response.setHeader("content-length", String(file.bytes));
        response.setHeader("content-disposition", downloadDisposition(file.name));
        createReadStream(file.path).pipe(response);
        return;
      }
      sendJson(response, 404, { error: "导出接口不存在。" });
    } catch (cause) {
      sendJson(response, 400, { error: cause instanceof Error ? cause.message : String(cause) });
    }
  };
}
