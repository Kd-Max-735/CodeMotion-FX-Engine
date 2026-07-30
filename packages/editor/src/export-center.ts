import type { AssetDefinition, MotionProject } from "@codemotion/core";

export type ExportFormat = "png-sequence" | "gif" | "webm" | "mp4";
export type ExportTaskStatus = "queued" | "running" | "completed" | "failed";

const MAX_EXPORT_DIMENSION = 8192;
const MAX_EXPORT_PIXELS = 33_554_432;

export interface ExportSettings {
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  duration: number;
  alpha: boolean;
  audio: boolean;
}

export interface ExportTaskFailure {
  stage: "render" | "inspect" | "encode" | "validation";
  frame: number;
  time: number;
  recoverFromFrame: number;
  message: string;
}

export interface ExportTaskView {
  id: string;
  projectName: string;
  format: ExportFormat;
  status: ExportTaskStatus;
  progress: number;
  completedFrames: number;
  frameCount: number;
  createdAt: string;
  updatedAt: string;
  logs: readonly string[];
  settings: ExportSettings;
  video: {
    codec: string;
    audioCodec?: string;
    width: number;
    height: number;
    fps: number;
    duration: number;
  };
  estimatedBytes: number;
  outputBytes?: number;
  downloadName?: string;
  failure?: ExportTaskFailure;
  machine: { mode: "local"; platform: string; node: string; ffmpeg: string };
}

export interface AssetView {
  id: string;
  kind: "image" | "video" | "audio";
  label: string;
  mime: string;
  codec: string;
  dimensions?: string;
  duration: number;
  bytes: number;
  shortHash: string;
  valid: boolean;
  issue?: string;
}

export class ExportApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function numberMetadata(asset: AssetDefinition, key: string): number {
  const value = asset.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringMetadata(asset: AssetDefinition, key: string): string {
  const value = asset.metadata[key];
  return typeof value === "string" ? value : "unknown";
}

export function projectMedia(project: MotionProject): AssetView[] {
  return project.assets
    .filter((asset): asset is AssetDefinition & { type: "image" | "video" | "audio" } =>
      asset.type === "image" || asset.type === "video" || asset.type === "audio")
    .map((asset) => {
      const verified = asset.metadata.decodeVerified === true;
      const addressed = /^media:\/\/[a-f0-9]{64}\.[a-z0-9]+$/i.test(asset.uri);
      const width = numberMetadata(asset, "width");
      const height = numberMetadata(asset, "height");
      const hash = asset.hash?.replace(/^sha256:/, "") ?? asset.uri.slice(8).split(".")[0] ?? "";
      const valid = verified && addressed;
      return {
        id: asset.id,
        kind: asset.type,
        label: `${asset.type.toUpperCase()} · ${asset.id.slice(0, 18)}`,
        mime: stringMetadata(asset, "mime"),
        codec: stringMetadata(asset, "codec"),
        ...(width > 0 && height > 0 ? { dimensions: `${width} x ${height}` } : {}),
        duration: numberMetadata(asset, "duration"),
        bytes: numberMetadata(asset, "bytes"),
        shortHash: hash.slice(0, 12),
        valid,
        ...(!valid ? { issue: verified ? "资源 URI 不是已验证的内容寻址格式" : "资源未通过真实解码验证" } : {})
      };
    });
}

export function estimateExportBytes(settings: Pick<ExportSettings, "format" | "width" | "height" | "fps" | "duration" | "audio">): number {
  const frames = Math.ceil(settings.fps * settings.duration);
  const pixels = settings.width * settings.height;
  const ratio = settings.format === "png-sequence" ? 1.2 : settings.format === "gif" ? 0.35 : 0.045;
  const audio = settings.audio ? Math.ceil(settings.duration * 24_000) : 0;
  return Math.ceil(pixels * frames * ratio + audio);
}

function referencedMediaIds(project: MotionProject): { visual: string[]; audio: string[] } {
  const visual = new Set<string>();
  const visited = new Set<string>();
  const visit = (compositionId: string): void => {
    if (visited.has(compositionId)) return;
    visited.add(compositionId);
    const composition = project.compositions.find((entry) => entry.id === compositionId);
    for (const layer of composition?.layers ?? []) {
      if ((layer.type === "image" || layer.type === "video") && layer.source !== undefined) {
        visual.add(layer.source.assetId);
      } else if (layer.type === "composition") {
        visit(layer.properties.compositionId);
      }
    }
  };
  const main = project.compositions[0];
  if (main !== undefined) visit(main.id);
  return {
    visual: [...visual],
    audio: [...new Set(project.audioTracks.map((track) => track.assetId))]
  };
}

export function validateExportSettings(project: MotionProject, settings: ExportSettings): string[] {
  const media = projectMedia(project);
  const references = referencedMediaIds(project);
  const visuals = references.visual.map((id) => media.find((asset) => asset.id === id));
  const audios = references.audio.map((id) => media.find((asset) => asset.id === id));
  const issues: string[] = [];
  if (visuals.some((asset) => asset === undefined)) issues.push("工程图层引用了缺失的图片或视频资源。");
  else if (visuals.some((asset) => !asset?.valid)) issues.push("工程图层引用了未通过解码验证的视觉资源。");
  if (!Number.isInteger(settings.width) || settings.width < 2 || !Number.isInteger(settings.height) || settings.height < 2) issues.push("导出尺寸必须是大于 1 的整数。");
  else if (settings.width > MAX_EXPORT_DIMENSION || settings.height > MAX_EXPORT_DIMENSION
    || settings.width * settings.height > MAX_EXPORT_PIXELS) issues.push("导出尺寸超过本地渲染预算。");
  if (!Number.isInteger(settings.fps) || settings.fps < 1 || settings.fps > 120) issues.push("帧率必须是 1 至 120 的整数。");
  if (!Number.isFinite(settings.duration) || settings.duration <= 0 || settings.duration > project.duration) issues.push("导出时长必须大于 0 且不超过工程时长。");
  if (settings.format === "mp4" && settings.alpha) issues.push("MP4 不支持透明通道。");
  if ((settings.format === "gif" || settings.format === "png-sequence") && settings.audio) issues.push(`${settings.format === "gif" ? "GIF" : "PNG 序列"}不支持音轨。`);
  if (settings.audio) {
    if (audios.length === 0) issues.push("启用音轨时工程必须包含音频轨道。");
    else if (audios.length > 1) issues.push("阶段 6 每次导出支持一条工程音轨。");
    else if (!audios[0]?.valid || audios[0].kind !== "audio") issues.push(audios[0]?.issue ?? "工程音轨资源无效。");
    else if (audios[0].duration > 0 && audios[0].duration < settings.duration) issues.push(`音频仅 ${audios[0].duration.toFixed(2)} 秒，短于导出时长。`);
  }
  for (const visual of visuals) {
    if (visual?.kind === "video" && visual.duration > 0 && visual.duration < settings.duration) {
      issues.push(`视频仅 ${visual.duration.toFixed(2)} 秒，短于导出时长。`);
    }
  }
  return issues;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as T & { error?: string };
  if (!response.ok) throw new ExportApiError(body.error ?? `HTTP ${response.status}`, response.status);
  return body;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return ArrayBuffer.isView(value)
    ? Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    : value;
}

export const exportApi = {
  list: () => request<{ tasks: ExportTaskView[] }>("/api/editor-exports"),
  create: (project: MotionProject, settings: ExportSettings) => request<{ task: ExportTaskView }>("/api/editor-exports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project, settings }, jsonReplacer)
  }),
  retry: (id: string) => request<{ task: ExportTaskView }>(`/api/editor-exports/${encodeURIComponent(id)}/retry`, { method: "POST" }),
  downloadUrl: (id: string) => `/api/editor-exports/${encodeURIComponent(id)}/download`
};
