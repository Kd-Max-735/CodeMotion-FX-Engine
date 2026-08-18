import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_GPU_BACKEND, readRgba8Frame, resampleRgbaFrame, rgbaPixels, valid } from "./common.js";

type CropAspect = "source" | "portrait_9_16" | "square_1_1" | "landscape_16_9";

export interface SmartCropAnimateParams extends JsonObject {
  subjectIndex: number;
  targetAspect: CropAspect;
  padding: number;
  trackingStrength: number;
  smoothing: number;
  leadRoom: number;
}

const defaults: SmartCropAnimateParams = {
  subjectIndex: 0,
  targetAspect: "portrait_9_16",
  padding: 1.35,
  trackingStrength: 0.9,
  smoothing: 0.75,
  leadRoom: 0.15
};

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
    { name: "source_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized source video.", acceptedMimeTypes: ["video/mp4", "video/webm"] },
    { name: "subject_tracks", kind: "data", required: true, cardinality: "one", description: "Server-produced subject boxes and temporal tracks." }
  ],
  primaryBackend: SERVER_GPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const source = readRgba8Frame(context, "source_video");
    const trackInput = context.inputs.subject_tracks;
    const binding = trackInput !== undefined && !Array.isArray(trackInput)
      ? (trackInput as { readonly binding: unknown }).binding : undefined;
    const subjects = typeof binding === "object" && binding !== null
      ? (binding as { readonly subjects?: readonly { readonly samples?: readonly { readonly time: number; readonly centerX: number; readonly centerY: number }[] }[] }).subjects : undefined;
    const samples = subjects?.[params.subjectIndex]?.samples ?? [];
    const previous = [...samples].reverse().find((sample) => sample.time <= context.time) ?? samples[0];
    const next = samples.find((sample) => sample.time >= context.time) ?? samples.at(-1);
    const interval = previous !== undefined && next !== undefined && next.time > previous.time
      ? (context.time - previous.time) / (next.time - previous.time) : 0;
    const trackedX = previous === undefined ? 0.5 : previous.centerX + ((next?.centerX ?? previous.centerX) - previous.centerX) * interval;
    const trackedY = previous === undefined ? 0.5 : previous.centerY + ((next?.centerY ?? previous.centerY) - previous.centerY) * interval;
    const response = 1 - params.smoothing * 0.75;
    const centerX = 0.5 + (trackedX - 0.5) * params.trackingStrength * response + params.leadRoom * 0.12;
    const centerY = 0.5 + (trackedY - 0.5) * params.trackingStrength * response;
    const aspectZoom = params.targetAspect === "portrait_9_16" ? 1.55
      : params.targetAspect === "square_1_1" ? 1.25 : params.targetAspect === "landscape_16_9" ? 1.08 : 1;
    const pixels = resampleRgbaFrame(source, context.width, context.height,
      Math.max(1, aspectZoom / params.padding + 0.45), centerX, centerY);
    return rgbaPixels(SERVER_GPU_BACKEND.backendId, context.width, context.height, pixels,
      "source_video", context.time);
  }
};
