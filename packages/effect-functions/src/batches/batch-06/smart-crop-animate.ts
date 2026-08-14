import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInput, EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_GPU_BACKEND, clamp, frameResult, round, valid } from "./common.js";

type CropAspect = "source" | "portrait_9_16" | "square_1_1" | "landscape_16_9";

export interface SmartCropAnimateParams extends JsonObject {
  subjectIndex: number;
  targetAspect: CropAspect;
  padding: number;
  trackingStrength: number;
  smoothing: number;
  leadRoom: number;
}

interface SubjectSample {
  readonly time: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
}

interface SubjectTrackBinding {
  readonly subjects: readonly { readonly samples: readonly SubjectSample[] }[];
}

const defaults: SmartCropAnimateParams = {
  subjectIndex: 0,
  targetAspect: "portrait_9_16",
  padding: 1.35,
  trackingStrength: 0.9,
  smoothing: 0.75,
  leadRoom: 0.15
};

function subjectBinding(value: unknown): SubjectTrackBinding {
  if (typeof value !== "object" || value === null || !Array.isArray((value as SubjectTrackBinding).subjects)) {
    throw new TypeError("smart_crop_animate requires server subject tracks.");
  }
  const data = value as SubjectTrackBinding;
  for (const subject of data.subjects) {
    if (!Array.isArray(subject.samples) || subject.samples.length === 0 || subject.samples.some((sample) =>
      ![sample.time, sample.centerX, sample.centerY, sample.width, sample.height].every(Number.isFinite)
      || sample.time < 0 || sample.centerX < 0 || sample.centerX > 1 || sample.centerY < 0 || sample.centerY > 1
      || sample.width <= 0 || sample.width > 1 || sample.height <= 0 || sample.height > 1)) {
      throw new TypeError("smart_crop_animate received invalid server subject samples.");
    }
  }
  if (data.subjects.length === 0) throw new TypeError("smart_crop_animate requires at least one tracked subject.");
  return data;
}

function interpolate(samples: readonly SubjectSample[], time: number): SubjectSample {
  const ordered = [...samples].sort((left, right) => left.time - right.time);
  const rightIndex = ordered.findIndex((sample) => sample.time >= time);
  if (rightIndex <= 0) return ordered[Math.max(0, rightIndex)]!;
  if (rightIndex < 0) return ordered[ordered.length - 1]!;
  const left = ordered[rightIndex - 1]!;
  const right = ordered[rightIndex]!;
  const progress = clamp((time - left.time) / Math.max(1e-6, right.time - left.time), 0, 1);
  const mix = (a: number, b: number) => a + (b - a) * progress;
  return {
    time,
    centerX: mix(left.centerX, right.centerX),
    centerY: mix(left.centerY, right.centerY),
    width: mix(left.width, right.width),
    height: mix(left.height, right.height)
  };
}

export const SMART_CROP_ANIMATE_DEFINITION: EffectToolDefinition<SmartCropAnimateParams> = {
  effectId: "fx.media.smartCropAnimate",
  toolName: "smart_crop_animate",
  displayName: "主体跟踪智能裁切",
  version: "1.0.0",
  category: "media",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      subjectIndex: { type: "integer", minimum: 0, maximum: 31, default: 0 },
      targetAspect: { type: "string", enum: ["source", "portrait_9_16", "square_1_1", "landscape_16_9"], default: "portrait_9_16" },
      padding: { type: "number", minimum: 1, maximum: 3, default: 1.35 },
      trackingStrength: { type: "number", minimum: 0, maximum: 1, default: 0.9 },
      smoothing: { type: "number", minimum: 0, maximum: 1, default: 0.75 },
      leadRoom: { type: "number", minimum: 0, maximum: 0.5, default: 0.15 }
    }
  },
  defaults,
  presets: [
    { presetId: "smart_crop_animate.stable_portrait", displayName: "稳定竖屏", params: { ...defaults } },
    { presetId: "smart_crop_animate.responsive_square", displayName: "灵敏方形", params: { ...defaults, targetAspect: "square_1_1", trackingStrength: 1, smoothing: 0.35 } },
    { presetId: "smart_crop_animate.wide", displayName: "宽屏留白", params: { ...defaults, targetAspect: "landscape_16_9", padding: 1.7, leadRoom: 0.25 } }
  ],
  inputSlots: [
    { name: "source_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized source video." },
    { name: "subject_tracks", kind: "data", required: true, cardinality: "one", description: "Server-produced subject boxes and temporal tracks." }
  ],
  primaryBackend: SERVER_GPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const input = context.inputs.subject_tracks as AuthorizedEffectInput<SubjectTrackBinding>;
    const tracks = subjectBinding(input.binding);
    const subject = tracks.subjects[params.subjectIndex];
    if (subject === undefined) {
      throw new RangeError(`smart_crop_animate subjectIndex ${params.subjectIndex} is not available.`);
    }
    const current = interpolate(subject.samples, context.time);
    const previous = interpolate(subject.samples, Math.max(0, context.time - Math.max(context.deltaTime, 1 / context.fps)));
    const velocityX = current.centerX - previous.centerX;
    const trackedX = current.centerX + Math.sign(velocityX) * params.leadRoom * current.width;
    const centerX = 0.5 + (trackedX - 0.5) * params.trackingStrength;
    const centerY = 0.5 + (current.centerY - 0.5) * params.trackingStrength;
    const aspect = params.targetAspect === "portrait_9_16" ? 9 / 16
      : params.targetAspect === "square_1_1" ? 1
        : params.targetAspect === "landscape_16_9" ? 16 / 9
          : context.width / context.height;
    const cropHeight = clamp(Math.max(current.height * params.padding, current.width * params.padding / aspect), 0.05, 1);
    const cropWidth = clamp(cropHeight * aspect, 0.05, 1);
    return frameResult(SERVER_GPU_BACKEND.backendId, {
      operation: "tracked_subject_crop",
      sourceSlot: "source_video",
      analysisSlot: "subject_tracks",
      sampleTime: round(context.time),
      crop: {
        centerX: round(clamp(centerX, cropWidth / 2, 1 - cropWidth / 2)),
        centerY: round(clamp(centerY, cropHeight / 2, 1 - cropHeight / 2)),
        width: round(cropWidth),
        height: round(cropHeight)
      },
      temporalSmoothing: params.smoothing
    });
  }
};
