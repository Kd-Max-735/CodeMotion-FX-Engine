import {
  type BrowserProjectEnvelopeV1,
  type BrowserProjectValidationOptionsV1,
  type TransportValidationResultV1,
  hasOnlyTransportKeysV1,
  inspectTransportJsonV1,
  isTransportRecordV1,
  transportValidationFailureV1,
  validateBrowserProjectEnvelopeV1Internal
} from "./browser-project.js";

export const PREVIEW_REQUEST_CONTRACT = "preview-request/v1" as const;
export const EXPORT_REQUEST_CONTRACT = "export-request/v1" as const;
export const EXPORT_TASK_CONTRACT = "export-task/v1" as const;

export interface EditorPreviewRequestV1 {
  readonly contract: typeof PREVIEW_REQUEST_CONTRACT;
  readonly editableProject: BrowserProjectEnvelopeV1;
  readonly frame: {
    readonly time: number;
    readonly width: number;
    readonly height: number;
    readonly quality: "draft" | "preview" | "final";
  };
}

export interface ExportSettingsV1 {
  readonly format: "png-sequence" | "gif" | "webm" | "mp4";
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly alpha: boolean;
  readonly audio: boolean;
}

export interface ExportCreateRequestV1 {
  readonly contract: typeof EXPORT_REQUEST_CONTRACT;
  readonly editableProject: BrowserProjectEnvelopeV1;
  readonly settings: ExportSettingsV1;
}

export interface ExportTaskFailureV1 {
  readonly stage: "render" | "inspect" | "encode";
  readonly frame: number;
  readonly time: number;
  readonly recoverFromFrame: number;
  readonly code: "FRAME_RENDER_FAILED" | "FRAME_INSPECTION_FAILED" | "OUTPUT_ENCODING_FAILED";
  readonly message: string;
}

export interface ExportTaskViewV1 {
  readonly contract: typeof EXPORT_TASK_CONTRACT;
  readonly id: string;
  readonly projectName: string;
  readonly format: ExportSettingsV1["format"];
  readonly status: "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
  readonly progress: number;
  readonly completedFrames: number;
  readonly frameCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly settings: ExportSettingsV1;
  readonly video: {
    readonly codec: "png" | "gif" | "libvpx-vp9" | "libx264";
    readonly audioCodec?: "libopus" | "aac";
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly duration: number;
  };
  readonly estimatedBytes: number;
  readonly outputBytes?: number;
  readonly downloadName?: string;
  readonly expiresAt?: string;
  readonly failure?: ExportTaskFailureV1;
}

function exact(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed
): value is Record<string, unknown> {
  return isTransportRecordV1(value) && hasOnlyTransportKeysV1(value, allowed, required);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function inspect<T>(value: unknown): TransportValidationResultV1<T> | undefined {
  const inspection = inspectTransportJsonV1(value);
  if (inspection === "budget") return transportValidationFailureV1("PROJECT_TOO_LARGE");
  if (inspection === "unsafe" || !isTransportRecordV1(value)) {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  return undefined;
}

function validSettings(value: unknown, projectDuration?: number): value is ExportSettingsV1 {
  if (!exact(value, ["format", "width", "height", "fps", "duration", "alpha", "audio"])
    || !["png-sequence", "gif", "webm", "mp4"].includes(String(value.format))
    || !Number.isInteger(value.width) || !Number.isInteger(value.height)
    || (value.width as number) < 2 || (value.width as number) > 8_192
    || (value.height as number) < 2 || (value.height as number) > 8_192
    || (value.width as number) * (value.height as number) > 33_554_432
    || !Number.isInteger(value.fps) || (value.fps as number) < 1 || (value.fps as number) > 120
    || !finite(value.duration) || value.duration <= 0
    || (projectDuration !== undefined && value.duration > projectDuration)
    || typeof value.alpha !== "boolean" || typeof value.audio !== "boolean") return false;
  if (value.format === "mp4" && value.alpha) return false;
  if ((value.format === "gif" || value.format === "png-sequence") && value.audio) return false;
  return true;
}

export function validateEditorPreviewRequestV1Internal(
  value: unknown,
  options: BrowserProjectValidationOptionsV1
): TransportValidationResultV1<EditorPreviewRequestV1> {
  const inspected = inspect<EditorPreviewRequestV1>(value);
  if (inspected !== undefined) return inspected;
  const record = value as Record<string, unknown>;
  if (record.contract !== PREVIEW_REQUEST_CONTRACT) return transportValidationFailureV1("UNSUPPORTED_CONTRACT");
  if (!hasOnlyTransportKeysV1(record, ["contract", "editableProject", "frame"])
    || !exact(record.frame, ["time", "width", "height", "quality"])) {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  const frame = record.frame;
  if (!finite(frame.time) || !Number.isInteger(frame.width) || !Number.isInteger(frame.height)
    || (frame.width as number) < 1 || (frame.width as number) > 960
    || (frame.height as number) < 1 || (frame.height as number) > 960
    || (frame.width as number) * (frame.height as number) > 921_600
    || !["draft", "preview", "final"].includes(String(frame.quality))) {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  const project = validateBrowserProjectEnvelopeV1Internal(record.editableProject, options);
  if (!project.valid) return project;
  return { valid: true, value: value as EditorPreviewRequestV1 };
}

export function validateExportCreateRequestV1Internal(
  value: unknown,
  options: BrowserProjectValidationOptionsV1
): TransportValidationResultV1<ExportCreateRequestV1> {
  const inspected = inspect<ExportCreateRequestV1>(value);
  if (inspected !== undefined) return inspected;
  const record = value as Record<string, unknown>;
  if (record.contract !== EXPORT_REQUEST_CONTRACT) return transportValidationFailureV1("UNSUPPORTED_CONTRACT");
  if (!hasOnlyTransportKeysV1(record, ["contract", "editableProject", "settings"])) {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  const project = validateBrowserProjectEnvelopeV1Internal(record.editableProject, options);
  if (!project.valid) return project;
  if (!validSettings(record.settings, project.value.project.duration)) {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  const settings = record.settings;
  if (settings.audio) {
    const covering = project.value.project.audioTracks.filter((track) =>
      track.startTime <= 0 && track.endTime >= settings.duration);
    if (covering.length !== 1) return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  return { valid: true, value: value as ExportCreateRequestV1 };
}

const FAILURE_MESSAGES = Object.freeze({
  FRAME_RENDER_FAILED: "Frame rendering failed.",
  FRAME_INSPECTION_FAILED: "Rendered frame validation failed.",
  OUTPUT_ENCODING_FAILED: "Output encoding failed."
} as const);

function validFailure(value: unknown): value is ExportTaskFailureV1 {
  if (!exact(value, ["stage", "frame", "time", "recoverFromFrame", "code", "message"])
    || !["render", "inspect", "encode"].includes(String(value.stage))
    || !Number.isInteger(value.frame) || !finite(value.time) || !Number.isInteger(value.recoverFromFrame)
    || typeof value.code !== "string" || !Object.hasOwn(FAILURE_MESSAGES, value.code)) return false;
  return value.message === FAILURE_MESSAGES[value.code as keyof typeof FAILURE_MESSAGES];
}

function validVideo(value: unknown, settings: ExportSettingsV1): boolean {
  if (!exact(value, ["codec", "audioCodec", "width", "height", "fps", "duration"],
    ["codec", "width", "height", "fps", "duration"])) return false;
  const expectedCodec = settings.format === "png-sequence" ? "png"
    : settings.format === "gif" ? "gif"
      : settings.format === "webm" ? "libvpx-vp9" : "libx264";
  const expectedAudio = settings.audio ? (settings.format === "webm" ? "libopus" : "aac") : undefined;
  return value.codec === expectedCodec && value.audioCodec === expectedAudio
    && value.width === settings.width && value.height === settings.height
    && value.fps === settings.fps && value.duration === settings.duration;
}

export function validateExportTaskViewV1Internal(value: unknown): TransportValidationResultV1<ExportTaskViewV1> {
  const inspected = inspect<ExportTaskViewV1>(value);
  if (inspected !== undefined) return inspected;
  const record = value as Record<string, unknown>;
  if (record.contract !== EXPORT_TASK_CONTRACT) return transportValidationFailureV1("UNSUPPORTED_CONTRACT");
  if (!hasOnlyTransportKeysV1(record, [
    "contract", "id", "projectName", "format", "status", "progress", "completedFrames", "frameCount",
    "createdAt", "updatedAt", "settings", "video", "estimatedBytes", "outputBytes", "downloadName",
    "expiresAt", "failure"
  ], [
    "contract", "id", "projectName", "format", "status", "progress", "completedFrames", "frameCount",
    "createdAt", "updatedAt", "settings", "video", "estimatedBytes"
  ]) || typeof record.id !== "string" || typeof record.projectName !== "string"
    || !["queued", "running", "cancelling", "completed", "failed", "cancelled"].includes(String(record.status))
    || !finite(record.progress) || record.progress < 0 || record.progress > 1
    || !Number.isInteger(record.completedFrames) || !Number.isInteger(record.frameCount)
    || (record.completedFrames as number) < 0 || (record.frameCount as number) < 1
    || (record.completedFrames as number) > (record.frameCount as number)
    || typeof record.createdAt !== "string" || typeof record.updatedAt !== "string"
    || !validSettings(record.settings) || record.format !== record.settings.format
    || !validVideo(record.video, record.settings)
    || !Number.isInteger(record.estimatedBytes) || (record.estimatedBytes as number) < 0) {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  const terminal = record.status === "completed" || record.status === "failed" || record.status === "cancelled";
  if (terminal !== (typeof record.expiresAt === "string")) return transportValidationFailureV1("MALFORMED_REQUEST");
  if (record.status === "completed") {
    if (!Number.isInteger(record.outputBytes) || (record.outputBytes as number) < 0
      || typeof record.downloadName !== "string" || record.failure !== undefined) {
      return transportValidationFailureV1("MALFORMED_REQUEST");
    }
  } else if (record.status === "failed") {
    if (!validFailure(record.failure) || record.outputBytes !== undefined || record.downloadName !== undefined) {
      return transportValidationFailureV1("MALFORMED_REQUEST");
    }
  } else if (record.outputBytes !== undefined || record.downloadName !== undefined || record.failure !== undefined) {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  return { valid: true, value: value as ExportTaskViewV1 };
}
