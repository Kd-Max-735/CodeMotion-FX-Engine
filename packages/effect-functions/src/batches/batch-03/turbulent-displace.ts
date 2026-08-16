import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_03_BACKEND,
  BATCH_03_REJECT_FALLBACK,
  CLOSED_SCHEMA,
  VALID_PARAMS,
  fractalNoise3d,
  frameResult,
  rgbaInput,
  sampleBilinear,
  writePixel
} from "./shared.js";

export interface TurbulentDisplaceParams extends JsonObject {
  amount: number;
  scale: number;
  complexity: number;
  evolutionSpeed: number;
  anisotropy: number;
  edgeMode: "clamp" | "mirror" | "wrap";
}

const defaults: TurbulentDisplaceParams = { amount: 32, scale: 90, complexity: 3, evolutionSpeed: 0.35, anisotropy: 0, edgeMode: "mirror" };

export const TURBULENT_DISPLACE_DEFINITION: EffectToolDefinition<TurbulentDisplaceParams> = {
  effectId: "fx.distort.turbulentDisplace",
  toolName: "turbulent_displace",
  displayName: "湍流置换",
  version: "1.0.0",
  category: "distort",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      amount: { type: "number", minimum: 0, maximum: 240, default: 32 },
      scale: { type: "number", minimum: 4, maximum: 800, default: 90 },
      complexity: { type: "integer", minimum: 1, maximum: 6, default: 3 },
      evolutionSpeed: { type: "number", minimum: -5, maximum: 5, default: 0.35 },
      anisotropy: { type: "number", minimum: -1, maximum: 1, default: 0 },
      edgeMode: { type: "string", enum: ["clamp", "mirror", "wrap"], default: "mirror" }
    }
  },
  defaults,
  presets: [
    { presetId: "turbulence.soft", displayName: "柔和云涌", params: { ...defaults, amount: 14, scale: 180, complexity: 2, evolutionSpeed: 0.15 } },
    { presetId: "turbulence.organic", displayName: "有机湍流", params: { ...defaults } },
    { presetId: "turbulence.storm", displayName: "强烈风暴", params: { ...defaults, amount: 78, scale: 42, complexity: 5, evolutionSpeed: 1.1, anisotropy: 0.35 } }
  ],
  inputSlots: [{ name: "primary_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的待置换图像。" }],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, complexity: Math.round(params.complexity) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const source = rgbaInput(context, "primary_image", true)!;
    const evolution = context.time * params.evolutionSpeed;
    const output = new Uint8ClampedArray(context.width * context.height * 4);
    for (let y = 0; y < context.height; y += 1) {
      for (let x = 0; x < context.width; x += 1) {
        const fieldX = fractalNoise3d(context.seed, x / params.scale, y / params.scale, evolution,
          params.complexity, 0);
        const fieldY = fractalNoise3d(context.seed, x / params.scale, y / params.scale, evolution,
          params.complexity, 101);
        const sourceX = x - fieldX * params.amount * (1 + params.anisotropy);
        const sourceY = y - fieldY * params.amount * (1 - params.anisotropy);
        writePixel(output, (y * context.width + x) * 4,
          sampleBilinear(source, sourceX, sourceY, params.edgeMode));
      }
    }
    return frameResult(context, output);
  }
};
