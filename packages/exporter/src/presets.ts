import type { JsonObject, RenderPreset } from "@codemotion/core";

export type ExportFormat = "png-sequence" | "gif" | "webm" | "mp4";

export const MAX_EXPORT_DIMENSION = 8192;
export const MAX_EXPORT_PIXELS = 33_554_432;

export interface ExportPresetSettings extends JsonObject {
  width: number;
  height: number;
  fps: number;
  alpha: boolean;
  audio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  crf?: number;
}

export interface ExportPreset extends RenderPreset {
  format: ExportFormat;
  settings: ExportPresetSettings;
}

export const DOCUMENT_EXPORT_PRESETS: readonly ExportPreset[] = Object.freeze([
  preset("document-png-alpha", "PNG sequence (alpha)", "png-sequence", 1920, 1080, 30, true, false),
  preset("document-gif", "GIF", "gif", 1280, 720, 30, false, false),
  preset("document-webm-alpha", "WebM VP9 (alpha)", "webm", 1920, 1080, 30, true, true, "libvpx-vp9", "libopus"),
  preset("document-mp4", "MP4 H.264", "mp4", 1920, 1080, 30, false, true, "libx264", "aac")
]);

function preset(
  id: string,
  name: string,
  format: ExportFormat,
  width: number,
  height: number,
  fps: number,
  alpha: boolean,
  audio: boolean,
  videoCodec?: string,
  audioCodec?: string
): ExportPreset {
  const settings: ExportPresetSettings = {
    width, height, fps, alpha, audio, crf: 18,
    ...(videoCodec === undefined ? {} : { videoCodec }),
    ...(audioCodec === undefined ? {} : { audioCodec })
  };
  return {
    id, name, format, quality: "final",
    settings
  };
}

export function validateExportPreset(value: RenderPreset): ExportPreset {
  if (!["png-sequence", "gif", "webm", "mp4"].includes(value.format)) {
    throw new RangeError(`Unsupported export format: ${value.format}`);
  }
  const settings = value.settings as Partial<ExportPresetSettings>;
  for (const [name, number] of [["width", settings.width], ["height", settings.height], ["fps", settings.fps]] as const) {
    if (typeof number !== "number" || !Number.isFinite(number) || number <= 0) {
      throw new RangeError(`${name} must be a positive finite number.`);
    }
  }
  const width = settings.width as number;
  const height = settings.height as number;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new RangeError("Export dimensions must be integers.");
  }
  if (width > MAX_EXPORT_DIMENSION || height > MAX_EXPORT_DIMENSION
    || width * height > MAX_EXPORT_PIXELS) {
    throw new RangeError("Export dimensions exceed the configured render budget.");
  }
  if (typeof settings.alpha !== "boolean" || typeof settings.audio !== "boolean") {
    throw new TypeError("alpha and audio must be booleans.");
  }
  if (value.format === "mp4" && settings.alpha) throw new RangeError("The MP4 preset does not support alpha.");
  if (value.format === "webm" && settings.alpha
    && settings.videoCodec !== undefined && settings.videoCodec !== "libvpx-vp9") {
    throw new RangeError("Alpha WebM requires the libvpx-vp9 encoder.");
  }
  if ((value.format === "gif" || value.format === "png-sequence") && settings.audio) {
    throw new RangeError(`${value.format} does not support an audio track.`);
  }
  return value as ExportPreset;
}
