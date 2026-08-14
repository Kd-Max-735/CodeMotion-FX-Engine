import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, clamp, effectResult,
  numberField, parameterSchema, readPath, round, slicePath
} from "./common.js";

export interface NeonTraceParams extends JsonObject {
  progress: number;
  glowRadius: number;
  intensity: number;
  trailLength: number;
  pulseRate: number;
  hue: number;
  coreWidth: number;
}

const defaults: NeonTraceParams = {
  progress: 1, glowRadius: 18, intensity: 2, trailLength: 0.25, pulseRate: 1.2, hue: 190, coreWidth: 2.5
};

export const NEON_TRACE_DEFINITION: EffectToolDefinition<NeonTraceParams> = {
  effectId: "fx.draw.neonTrace",
  toolName: "neon_trace",
  displayName: "霓虹路径追踪",
  version: "1.0.0",
  category: "draw",
  parameterSchema: parameterSchema({
    progress: numberField(1, 0, 1),
    glowRadius: numberField(18, 0, 200),
    intensity: numberField(2, 0, 10),
    trailLength: numberField(0.25, 0.01, 1),
    pulseRate: numberField(1.2, 0, 12),
    hue: numberField(190, 0, 360),
    coreWidth: numberField(2.5, 0.5, 40)
  }),
  defaults,
  presets: [
    { presetId: "neon_trace.clean", displayName: "清晰霓虹", params: { ...defaults, glowRadius: 10, intensity: 1.4, pulseRate: 0 } },
    { presetId: "neon_trace.night", displayName: "夜店追光", params: { ...defaults } },
    { presetId: "neon_trace.comet", displayName: "霓虹彗尾", params: { ...defaults, progress: 0.72, glowRadius: 32, intensity: 3.5, trailLength: 0.12, pulseRate: 2.4 } }
  ],
  inputSlots: [{ name: "trace_path", kind: "data", required: true, cardinality: "one", description: "Server-bound path traced by the neon emitter." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, progress: round(params.progress), hue: round(params.hue, 2) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const path = readPath(context, "trace_path");
    const start = clamp(params.progress - params.trailLength, 0, 1);
    const points = slicePath(path, start, params.progress, 4);
    const pulse = params.pulseRate === 0 ? 1 : 0.82 + 0.18 * Math.sin(context.time * params.pulseRate * Math.PI * 2);
    const layers = [1, 0.5, 0.22].map((scale, index) => ({
      radius: round(params.glowRadius * scale),
      intensity: round(params.intensity * pulse * [0.18, 0.34, 0.72][index]!),
      linearLight: true
    }));
    return effectResult("metadata", {
      algorithm: "trimmed_multiscale_neon",
      points,
      coreWidth: round(params.coreWidth),
      coreIntensity: round(params.intensity * pulse),
      hue: round(params.hue),
      glowLayers: layers
    });
  }
};
