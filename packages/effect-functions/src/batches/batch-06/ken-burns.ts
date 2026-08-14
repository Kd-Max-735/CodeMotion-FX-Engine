import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_GPU_BACKEND, frameResult, round, timedProgress, valid, type Easing } from "./common.js";

export interface KenBurnsParams extends JsonObject {
  startTime: number;
  duration: number;
  startScale: number;
  endScale: number;
  startCenterX: number;
  startCenterY: number;
  endCenterX: number;
  endCenterY: number;
  easing: Easing;
}

const defaults: KenBurnsParams = {
  startTime: 0,
  duration: 5,
  startScale: 1,
  endScale: 1.18,
  startCenterX: 0.5,
  startCenterY: 0.5,
  endCenterX: 0.55,
  endCenterY: 0.45,
  easing: "ease_in_out"
};

export const KEN_BURNS_DEFINITION: EffectToolDefinition<KenBurnsParams> = {
  effectId: "fx.media.kenBurns",
  toolName: "ken_burns",
  displayName: "肯·伯恩斯平移缩放",
  version: "1.0.0",
  category: "media",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      startTime: { type: "number", minimum: 0, maximum: 3600, default: 0 },
      duration: { type: "number", exclusiveMinimum: 0, maximum: 120, default: 5 },
      startScale: { type: "number", minimum: 1, maximum: 4, default: 1 },
      endScale: { type: "number", minimum: 1, maximum: 4, default: 1.18 },
      startCenterX: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      startCenterY: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      endCenterX: { type: "number", minimum: 0, maximum: 1, default: 0.55 },
      endCenterY: { type: "number", minimum: 0, maximum: 1, default: 0.45 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults,
  presets: [
    { presetId: "ken_burns.gentle_in", displayName: "轻柔推近", params: { ...defaults } },
    { presetId: "ken_burns.pull_out", displayName: "缓慢拉远", params: { ...defaults, startScale: 1.3, endScale: 1, startCenterX: 0.45, endCenterX: 0.5 } },
    { presetId: "ken_burns.pan", displayName: "横向巡览", params: { ...defaults, duration: 7, startScale: 1.25, endScale: 1.25, startCenterX: 0.3, endCenterX: 0.7 } }
  ],
  inputSlots: [{ name: "source_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized still image." }],
  primaryBackend: SERVER_GPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "light",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const progress = timedProgress(context.time, params.startTime, params.duration, params.easing);
    const mix = (start: number, end: number) => round(start + (end - start) * progress);
    return frameResult(SERVER_GPU_BACKEND.backendId, {
      operation: "sample_image_with_crop_transform",
      sourceSlot: "source_image",
      progress: round(progress),
      scale: mix(params.startScale, params.endScale),
      center: [mix(params.startCenterX, params.endCenterX), mix(params.startCenterY, params.endCenterY)]
    });
  }
};
