import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_03_BACKEND,
  BATCH_03_REJECT_FALLBACK,
  CLOSED_SCHEMA,
  VALID_PARAMS,
  frameResult,
  rgbaInput,
  sampleBilinear,
  valueNoise3d,
  writePixel
} from "./shared.js";

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
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const source = rgbaInput(context, "primary_image", true)!;
    const flowMap = rgbaInput(context, "flow_map", false, false);
    const output = new Uint8ClampedArray(context.width * context.height * 4);
    const time = context.time * params.flowSpeed * (1.2 - params.viscosity * 0.65);
    const minimumDimension = Math.min(context.width, context.height);
    const displacementScale = params.refraction * minimumDimension * 0.15
      * (0.82 + params.surfaceTension * 0.34) * (1 - params.viscosity * 0.18);
    const flowScale = 34 + params.viscosity * 46 + params.surfaceTension * 28;
    for (let y = 0; y < context.height; y += 1) {
      for (let x = 0; x < context.width; x += 1) {
        let flowX: number;
        let flowY: number;
        if (flowMap === undefined) {
          const broadX = valueNoise3d(context.seed, x / flowScale + time, y / flowScale, time * 0.28, 3);
          const broadY = valueNoise3d(context.seed, x / flowScale, y / flowScale - time, time * 0.28, 71);
          const detailWeight = 0.42 * (1 - params.surfaceTension * 0.68);
          flowX = broadX + valueNoise3d(context.seed, x / 23 + time * 0.7,
            y / 23, time * 0.36, 109) * detailWeight;
          flowY = broadY + valueNoise3d(context.seed, x / 23,
            y / 23 - time * 0.7, time * 0.36, 173) * detailWeight;
        } else {
          const mapX = x / Math.max(1, context.width - 1) * Math.max(0, flowMap.width - 1);
          const mapY = y / Math.max(1, context.height - 1) * Math.max(0, flowMap.height - 1);
          const mapPixel = sampleBilinear(flowMap, mapX, mapY, "wrap");
          flowX = (mapPixel[0]! / 255 * 2 - 1) + Math.sin(time) * 0.12;
          flowY = (mapPixel[1]! / 255 * 2 - 1) + Math.cos(time) * 0.12;
        }
        const dx = flowX * displacementScale;
        const dy = flowY * displacementScale;
        const dispersion = params.chromaticDispersion * params.refraction * Math.min(context.width, context.height) * 0.025;
        const red = sampleBilinear(source, x - dx - dispersion, y - dy, "mirror");
        const green = sampleBilinear(source, x - dx, y - dy, "mirror");
        const blue = sampleBilinear(source, x - dx + dispersion, y - dy, "mirror");
        const caustic = 1 + Math.min(0.16, Math.abs(flowX - flowY) * params.refraction * 0.055);
        writePixel(output, (y * context.width + x) * 4,
          [red[0]! * caustic, green[1]! * caustic, blue[2]! * caustic, green[3]!]);
      }
    }
    return frameResult(context, output);
  }
};
