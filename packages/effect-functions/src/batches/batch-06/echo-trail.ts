import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_GPU_BACKEND, frameResult, round, valid } from "./common.js";

type EchoBlend = "normal" | "screen" | "add";

export interface EchoTrailParams extends JsonObject {
  trailCount: number;
  spacing: number;
  decay: number;
  offsetX: number;
  offsetY: number;
  blendMode: EchoBlend;
}

const defaults: EchoTrailParams = {
  trailCount: 10,
  spacing: 0.12,
  decay: 0.78,
  offsetX: 0,
  offsetY: 0,
  blendMode: "normal"
};

export const ECHO_TRAIL_DEFINITION: EffectToolDefinition<EchoTrailParams> = {
  effectId: "fx.media.echoTrail",
  toolName: "echo_trail",
  displayName: "历史帧回声拖影",
  version: "1.1.0",
  category: "media",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      trailCount: { type: "integer", minimum: 2, maximum: 32, default: 10 },
      spacing: { type: "number", exclusiveMinimum: 0, maximum: 2, default: 0.12 },
      decay: { type: "number", minimum: 0.05, maximum: 1, default: 0.78 },
      offsetX: { type: "number", minimum: -0.5, maximum: 0.5, default: 0 },
      offsetY: { type: "number", minimum: -0.5, maximum: 0.5, default: 0 },
      blendMode: { type: "string", enum: ["normal", "screen", "add"], default: "normal" }
    }
  },
  defaults,
  presets: [
    { presetId: "echo_trail.soft", displayName: "柔和残影", params: { ...defaults } },
    { presetId: "echo_trail.long", displayName: "长尾回声", params: { ...defaults, trailCount: 12, spacing: 0.12, decay: 0.82, offsetX: 0.02 } },
    { presetId: "echo_trail.strobe", displayName: "频闪分身", params: { ...defaults, trailCount: 5, spacing: 0.2, decay: 0.9, blendMode: "add" } }
  ],
  inputSlots: [{ name: "source_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized video with historical frame access." }],
  primaryBackend: SERVER_GPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => frameResult(SERVER_GPU_BACKEND.backendId, {
    operation: "historical_frame_echo",
    blendMode: params.blendMode,
    histories: Array.from({ length: params.trailCount }, (_, index) => {
      const ageIndex = index + 1;
      const ageRatio = ageIndex / params.trailCount;
      return Object.freeze({
        frameKey: `echo_history_${ageIndex}`,
        sampleTime: round(Math.max(0, context.time - ageIndex * params.spacing)),
        opacity: round(0.52 * params.decay ** (ageIndex - 1) * (1 - ageRatio * 0.72) ** 1.35),
        offsetX: round(params.offsetX * context.width * ageIndex),
        offsetY: round(params.offsetY * context.height * ageIndex)
      });
    })
  })
};
