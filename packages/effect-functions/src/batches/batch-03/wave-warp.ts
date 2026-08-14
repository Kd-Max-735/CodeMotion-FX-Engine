import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_03_CPU_FALLBACK,
  BATCH_03_GPU_BACKEND,
  CLOSED_SCHEMA,
  VALID_PARAMS,
  metadataResult,
  round
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
  primaryBackend: BATCH_03_GPU_BACKEND,
  fallbackStrategy: { kind: "server-backend", backend: BATCH_03_CPU_FALLBACK, fidelity: "equivalent", requiresFinalApproval: false },
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const phase = params.phase + context.time * params.speed * Math.PI * 2;
    const samples = [0.125, 0.5, 0.875].map((coordinate) => ({
      coordinate,
      displacementPixels: round(Math.sin(coordinate * params.frequency * Math.PI * 2 + phase) * params.amplitude)
    }));
    return metadataResult(context, {
      algorithm: "axis_sine_coordinate_warp",
      axis: params.axis,
      edgeMode: params.edgeMode,
      phase: round(phase),
      samples
    });
  }
};
