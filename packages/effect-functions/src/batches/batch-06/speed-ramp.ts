import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { FFMPEG_BACKEND, REJECT_FALLBACK, clamp, frameResult, round, valid, type Easing } from "./common.js";

export interface SpeedRampParams extends JsonObject {
  rampStart: number;
  rampDuration: number;
  speedBefore: number;
  speedAfter: number;
  curve: Easing;
}

const defaults: SpeedRampParams = {
  rampStart: 1,
  rampDuration: 2,
  speedBefore: 1,
  speedAfter: 2,
  curve: "ease_in_out"
};

function integratedEase(x: number, curve: Easing): number {
  const t = clamp(x, 0, 1);
  switch (curve) {
    case "ease_in": return t ** 3 / 3;
    case "ease_out": return t * t - t ** 3 / 3;
    case "ease_in_out": return t < 0.5
      ? 2 * t ** 3 / 3
      : -t + 2 * t * t - 2 * t ** 3 / 3 + 1 / 6;
    default: return t * t / 2;
  }
}

export function speedRampSampleTime(outputTime: number, params: SpeedRampParams): number {
  const time = Math.max(0, outputTime);
  if (time <= params.rampStart) return time * params.speedBefore;
  const beforeSource = params.rampStart * params.speedBefore;
  const rampElapsed = Math.min(params.rampDuration, time - params.rampStart);
  const x = rampElapsed / params.rampDuration;
  const rampSource = params.rampDuration * (
    params.speedBefore * x
    + (params.speedAfter - params.speedBefore) * integratedEase(x, params.curve)
  );
  const afterElapsed = Math.max(0, time - params.rampStart - params.rampDuration);
  return beforeSource + rampSource + afterElapsed * params.speedAfter;
}

export const SPEED_RAMP_DEFINITION: EffectToolDefinition<SpeedRampParams> = {
  effectId: "fx.media.speedRamp",
  toolName: "speed_ramp",
  displayName: "视频变速坡道",
  version: "1.0.0",
  category: "media",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      rampStart: { type: "number", minimum: 0, maximum: 3600, default: 1 },
      rampDuration: { type: "number", exclusiveMinimum: 0, maximum: 60, default: 2 },
      speedBefore: { type: "number", minimum: 0.05, maximum: 16, default: 1 },
      speedAfter: { type: "number", minimum: 0.05, maximum: 16, default: 2 },
      curve: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults,
  presets: [
    { presetId: "speed_ramp.accelerate", displayName: "平滑加速", params: { ...defaults } },
    { presetId: "speed_ramp.slow_motion", displayName: "渐入慢动作", params: { ...defaults, speedBefore: 1, speedAfter: 0.25, rampDuration: 1.5 } },
    { presetId: "speed_ramp.whip", displayName: "快速甩镜", params: { ...defaults, rampStart: 0.5, rampDuration: 0.6, speedAfter: 6, curve: "ease_in" } }
  ],
  inputSlots: [{ name: "source_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized source video sampled by integrated speed." }],
  primaryBackend: FFMPEG_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => frameResult(FFMPEG_BACKEND.backendId, {
    operation: "decode_video_frame_at_time",
    sourceSlot: "source_video",
    outputTime: round(Math.max(0, context.time)),
    sampleTime: round(speedRampSampleTime(context.time, params)),
    interpolation: "motion_compensated"
  })
};
