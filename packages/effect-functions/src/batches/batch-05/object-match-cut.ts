import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition, ServerEffectRenderContext } from "../../types.js";
import { TRANSITION_BACKEND, assertDistinctInputBindings, effectProgress, frameOutput, invalid, round, valid, type MotionEasing } from "./helpers.js";

export interface ObjectMatchCutParams extends JsonObject {
  target: string;
  duration: number;
  cutPoint: number;
  blendWindow: number;
  alignmentStrength: number;
  scaleCompensation: number;
  rotationCompensation: number;
  easing: MotionEasing;
}

function smoothstep(value: number): number {
  const progress = Math.min(1, Math.max(0, value));
  return progress * progress * (3 - 2 * progress);
}

export function renderObjectMatchCut(context: ServerEffectRenderContext, params: Readonly<ObjectMatchCutParams>) {
  assertDistinctInputBindings(context, "from_video", "to_video");
  assertDistinctInputBindings(context, "from_match_mask", "to_match_mask");
  const progress = effectProgress(context, params.duration, params.easing);
  const halfWindow = params.blendWindow / (2 * params.duration);
  const blendStart = Math.max(0, params.cutPoint - halfWindow);
  const blendEnd = Math.min(1, params.cutPoint + halfWindow);
  const blend = smoothstep((progress - blendStart) / (blendEnd - blendStart));
  const alignment = params.alignmentStrength * Math.sin(Math.PI * blend);
  return frameOutput(context, "masked_object_match_cut", {
    algorithm: "masked-object-match-cut",
    inputSlots: {
      from: "from_video",
      to: "to_video",
      fromMask: "from_match_mask",
      toMask: "to_match_mask"
    },
    progress,
    blend: round(blend),
    alignmentStrength: params.alignmentStrength,
    outgoing: {
      opacity: round(1 - blend),
      scaleCorrection: round(1 + params.scaleCompensation * alignment),
      rotationCorrectionDegrees: round(params.rotationCompensation * alignment)
    },
    incoming: {
      opacity: round(blend),
      scaleCorrection: round(1 - params.scaleCompensation * alignment),
      rotationCorrectionDegrees: round(-params.rotationCompensation * alignment)
    }
  });
}

export const OBJECT_MATCH_CUT_DEFINITION: EffectToolDefinition<ObjectMatchCutParams> = {
  effectId: "fx.transition.objectMatchCut",
  toolName: "object_match_cut",
  displayName: "物体匹配剪辑",
  version: "2.0.0",
  category: "transition",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      target: {
        type: "string",
        minLength: 1,
        maxLength: 80,
        pattern: "^[\\p{L}\\p{N}][\\p{L}\\p{N} ,.'()/-]{0,79}$",
        default: "main subject"
      },
      duration: { type: "number", minimum: 0.2, maximum: 5, default: 1 },
      cutPoint: { type: "number", minimum: 0.1, maximum: 0.9, default: 0.5 },
      blendWindow: { type: "number", minimum: 0.04, maximum: 2, default: 0.18 },
      alignmentStrength: { type: "number", minimum: 0, maximum: 1, default: 0.8 },
      scaleCompensation: { type: "number", minimum: 0, maximum: 0.5, default: 0.12 },
      rotationCompensation: { type: "number", minimum: -45, maximum: 45, default: 0 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults: { target: "main subject", duration: 1, cutPoint: 0.5, blendWindow: 0.18, alignmentStrength: 0.8, scaleCompensation: 0.12, rotationCompensation: 0, easing: "ease_in_out" },
  presets: [
    { presetId: "object_match_cut.clean", displayName: "精准匹配", params: { target: "main subject", duration: 0.8, cutPoint: 0.5, blendWindow: 0.1, alignmentStrength: 0.95, scaleCompensation: 0.08, rotationCompensation: 0, easing: "ease_in_out" } },
    { presetId: "object_match_cut.soft", displayName: "柔和匹配", params: { target: "main subject", duration: 1.4, cutPoint: 0.5, blendWindow: 0.5, alignmentStrength: 0.7, scaleCompensation: 0.16, rotationCompensation: 3, easing: "ease_in_out" } },
    { presetId: "object_match_cut.snap", displayName: "快速对位", params: { target: "main subject", duration: 0.45, cutPoint: 0.55, blendWindow: 0.06, alignmentStrength: 1, scaleCompensation: 0.2, rotationCompensation: -5, easing: "ease_out" } }
  ],
  inputSlots: [
    { name: "from_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized outgoing video." },
    { name: "to_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized incoming video." },
    { name: "from_match_mask", kind: "mask", required: true, cardinality: "one", description: "Server-derived locked outgoing object preview mask." },
    { name: "to_match_mask", kind: "mask", required: true, cardinality: "one", description: "Server-derived locked incoming object preview mask." }
  ],
  primaryBackend: TRANSITION_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Object correspondence requires paired authorized masks and server GPU compositing." },
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, target: params.target.trim().toLowerCase(), duration: round(params.duration), cutPoint: round(params.cutPoint), blendWindow: round(params.blendWindow), alignmentStrength: round(params.alignmentStrength), scaleCompensation: round(params.scaleCompensation), rotationCompensation: round(params.rotationCompensation) }),
  validateParams: (params) => params.blendWindow <= params.duration * 0.8 ? valid() : invalid("$.blendWindow", "blendWindow must not exceed 80% of duration"),
  render: renderObjectMatchCut
};
