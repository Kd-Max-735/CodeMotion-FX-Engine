import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition, ServerEffectRenderContext } from "../../types.js";
import { CAMERA_BACKEND, cameraOutput, effectProgress, round, valid, type Vector3 } from "./helpers.js";

export interface HandheldParams extends JsonObject {
  intensity: number;
  frequency: number;
  translationJitter: number;
  rotationJitterDegrees: number;
  smoothing: number;
  seedOffset: number;
}

export function renderHandheld(context: ServerEffectRenderContext, params: Readonly<HandheldParams>) {
  const time = context.time * params.frequency;
  const phase = (context.seed + params.seedOffset) * 0.61803398875;
  const damping = 1 - params.smoothing * 0.85;
  const translation = params.translationJitter * params.intensity * damping;
  const rotationAmount = params.rotationJitterDegrees * params.intensity * damping;
  const position: Vector3 = {
    x: round(Math.sin(time * 2.13 + phase) * translation),
    y: round(Math.sin(time * 2.71 + phase * 1.7) * translation * 0.7),
    z: round(Math.sin(time * 1.37 + phase * 2.3) * translation * 0.35)
  };
  const rotation: Vector3 = {
    x: round(Math.sin(time * 1.91 + phase * 0.8) * rotationAmount),
    y: round(Math.sin(time * 1.53 + phase * 1.2) * rotationAmount),
    z: round(Math.sin(time * 2.43 + phase * 1.9) * rotationAmount * 0.6)
  };
  return {
    kind: "metadata" as const,
    backendId: CAMERA_BACKEND.backendId,
    output: cameraOutput("deterministic-handheld-camera", position, rotation, 50, effectProgress(context, 1, "linear")),
    degraded: false,
    warnings: []
  };
}

export const HANDHELD_DEFINITION: EffectToolDefinition<HandheldParams> = {
  effectId: "fx.camera.handheld",
  toolName: "handheld",
  displayName: "手持镜头",
  version: "1.0.0",
  category: "camera",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      intensity: { type: "number", minimum: 0, maximum: 1, default: 0.35 },
      frequency: { type: "number", minimum: 0.1, maximum: 12, default: 2.2 },
      translationJitter: { type: "number", minimum: 0, maximum: 1, default: 0.08 },
      rotationJitterDegrees: { type: "number", minimum: 0, maximum: 15, default: 1.5 },
      smoothing: { type: "number", minimum: 0, maximum: 1, default: 0.55 },
      seedOffset: { type: "integer", minimum: 0, maximum: 1000000, default: 0 }
    }
  },
  defaults: { intensity: 0.35, frequency: 2.2, translationJitter: 0.08, rotationJitterDegrees: 1.5, smoothing: 0.55, seedOffset: 0 },
  presets: [
    { presetId: "handheld.subtle", displayName: "轻微呼吸", params: { intensity: 0.18, frequency: 1.2, translationJitter: 0.04, rotationJitterDegrees: 0.6, smoothing: 0.8, seedOffset: 0 } },
    { presetId: "handheld.documentary", displayName: "纪实手持", params: { intensity: 0.45, frequency: 2.5, translationJitter: 0.1, rotationJitterDegrees: 1.8, smoothing: 0.5, seedOffset: 37 } },
    { presetId: "handheld.action", displayName: "动作震动", params: { intensity: 0.85, frequency: 6, translationJitter: 0.22, rotationJitterDegrees: 4.5, smoothing: 0.2, seedOffset: 91 } }
  ],
  inputSlots: [
    { name: "source_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized source video or rendered scene stream." }
  ],
  primaryBackend: CAMERA_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Deterministic server-side camera perturbation is required." },
  performanceGrade: "light",
  normalizeParams: (params) => ({ ...params, intensity: round(params.intensity), frequency: round(params.frequency), translationJitter: round(params.translationJitter), rotationJitterDegrees: round(params.rotationJitterDegrees), smoothing: round(params.smoothing), seedOffset: Math.round(params.seedOffset) }),
  validateParams: valid,
  render: renderHandheld
};
