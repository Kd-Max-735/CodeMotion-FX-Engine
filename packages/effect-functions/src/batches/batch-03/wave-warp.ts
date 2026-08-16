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
  writePixel
} from "./shared.js";

export interface WaveWarpParams extends JsonObject {
  amplitude: number;
  frequency: number;
  axis: "x" | "y";
  phase: number;
  speed: number;
  edgeMode: "clamp" | "mirror" | "wrap";
}

const defaults: WaveWarpParams = {
  amplitude: 24,
  frequency: 2,
  axis: "x",
  phase: 0,
  speed: 0.5,
  edgeMode: "mirror"
};

export const WAVE_WARP_DEFINITION: EffectToolDefinition<WaveWarpParams> = {
  effectId: "fx.distort.waveWarp",
  toolName: "wave_warp",
  displayName: "波浪扭曲",
  version: "1.0.0",
  category: "distort",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      amplitude: { type: "number", minimum: 0, maximum: 240, default: 24 },
      frequency: { type: "number", minimum: 0.1, maximum: 20, default: 2 },
      axis: { type: "string", enum: ["x", "y"], default: "x" },
      phase: { type: "number", minimum: -6.2832, maximum: 6.2832, default: 0 },
      speed: { type: "number", minimum: -8, maximum: 8, default: 0.5 },
      edgeMode: { type: "string", enum: ["clamp", "mirror", "wrap"], default: "mirror" }
    }
  },
  defaults,
  presets: [
    { presetId: "wave.gentle", displayName: "柔和涟漪", params: { ...defaults, amplitude: 10, frequency: 1.2, speed: 0.25 } },
    { presetId: "wave.flag", displayName: "旗帜摆动", params: { ...defaults } },
    { presetId: "wave.ripple", displayName: "密集波纹", params: { ...defaults, amplitude: 42, frequency: 6, axis: "y", speed: 1.4 } }
  ],
  inputSlots: [{ name: "primary_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的待扭曲图像。" }],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const source = rgbaInput(context, "primary_image", true)!;
    const phase = params.phase + context.time * params.speed * Math.PI * 2;
    const output = new Uint8ClampedArray(context.width * context.height * 4);
    for (let y = 0; y < context.height; y += 1) {
      for (let x = 0; x < context.width; x += 1) {
        const coordinate = params.axis === "x"
          ? y / Math.max(1, context.height - 1)
          : x / Math.max(1, context.width - 1);
        const displacement = Math.sin(coordinate * params.frequency * Math.PI * 2 + phase) * params.amplitude;
        const sourceX = params.axis === "x" ? x - displacement : x;
        const sourceY = params.axis === "y" ? y - displacement : y;
        writePixel(output, (y * context.width + x) * 4,
          sampleBilinear(source, sourceX, sourceY, params.edgeMode));
      }
    }
    return frameResult(context, output);
  }
};
