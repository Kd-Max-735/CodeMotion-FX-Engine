import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { BATCH_03_CPU_FALLBACK, BATCH_03_GPU_BACKEND, CLOSED_SCHEMA, VALID_PARAMS, metadataResult, round } from "./shared.js";

export interface LiquidDisplaceParams extends JsonObject {
  viscosity: number;
  refraction: number;
  flowSpeed: number;
  surfaceTension: number;
  chromaticDispersion: number;
}

const defaults: LiquidDisplaceParams = { viscosity: 0.65, refraction: 0.32, flowSpeed: 0.4, surfaceTension: 0.55, chromaticDispersion: 0.08 };

export const LIQUID_DISPLACE_DEFINITION: EffectToolDefinition<LiquidDisplaceParams> = {
  effectId: "fx.distort.liquidDisplace",
  toolName: "liquid_displace",
  displayName: "液态置换",
  version: "1.0.0",
  category: "distort",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      viscosity: { type: "number", minimum: 0, maximum: 1, default: 0.65 },
      refraction: { type: "number", minimum: 0, maximum: 1.5, default: 0.32 },
      flowSpeed: { type: "number", minimum: -4, maximum: 4, default: 0.4 },
      surfaceTension: { type: "number", minimum: 0, maximum: 1, default: 0.55 },
      chromaticDispersion: { type: "number", minimum: 0, maximum: 0.5, default: 0.08 }
    }
  },
  defaults,
  presets: [
    { presetId: "liquid.glass", displayName: "柔和水玻璃", params: { ...defaults, viscosity: 0.82, refraction: 0.18, flowSpeed: 0.18, surfaceTension: 0.75, chromaticDispersion: 0.02 } },
    { presetId: "liquid.flow", displayName: "流动液面", params: { ...defaults } },
    { presetId: "liquid.prism", displayName: "棱彩液化", params: { ...defaults, viscosity: 0.35, refraction: 0.72, flowSpeed: 1.2, surfaceTension: 0.25, chromaticDispersion: 0.22 } }
  ],
  inputSlots: [
    { name: "primary_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的待折射图像。" },
    { name: "flow_map", kind: "texture", required: false, cardinality: "one", description: "可选的服务端授权流场纹理；不由模型指定。" }
  ],
  primaryBackend: BATCH_03_GPU_BACKEND,
  fallbackStrategy: { kind: "server-backend", backend: BATCH_03_CPU_FALLBACK, fidelity: "degraded", requiresFinalApproval: true },
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => metadataResult(context, {
    algorithm: "advected_surface_normal_refraction",
    advectionTime: round(context.time * params.flowSpeed),
    temporalSmoothing: round(params.viscosity ** 2),
    normalGain: round(params.refraction * (1.25 - params.surfaceTension * 0.5)),
    chromaticOffsets: [-1, 0, 1].map((channel) => round(channel * params.chromaticDispersion * params.refraction)),
    flowSource: "flow_map" in context.inputs ? "authorized_flow_map" : "procedural_divergence_free_field"
  })
};
