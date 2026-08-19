import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, clamp, effectResult,
  numberField, parameterSchema, readImageDimensions, round, slicePath
} from "./common.js";

export interface NeonTraceParams extends JsonObject {
  progress: number;
  glowRadius: number;
  intensity: number;
  trailLength: number;
  pulseRate: number;
  hue: number;
  coreWidth: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  curve: number;
}

const defaults: NeonTraceParams = {
  progress: 1, glowRadius: 18, intensity: 2, trailLength: 0.25, pulseRate: 1.2, hue: 190, coreWidth: 2.5,
  startX: 0.2, startY: 0.5, endX: 0.8, endY: 0.5, curve: 0
};

export const NEON_TRACE_DEFINITION: EffectToolDefinition<NeonTraceParams> = {
  effectId: "fx.draw.neonTrace",
  toolName: "neon_trace",
  displayName: "霓虹路径追踪",
  version: "2.0.0",
  category: "draw",
  parameterSchema: parameterSchema({
    progress: numberField(1, 0, 1),
    glowRadius: numberField(18, 0, 200),
    intensity: numberField(2, 0, 10),
    trailLength: numberField(0.25, 0.01, 1),
    pulseRate: numberField(1.2, 0, 12),
    hue: numberField(190, 0, 360),
    coreWidth: numberField(2.5, 0.5, 40),
    startX: numberField(0.2, 0, 1),
    startY: numberField(0.5, 0, 1),
    endX: numberField(0.8, 0, 1),
    endY: numberField(0.5, 0, 1),
    curve: numberField(0, -1, 1)
  }),
  defaults,
  presets: [
    { presetId: "neon_trace.clean", displayName: "清晰霓虹", params: { ...defaults, glowRadius: 10, intensity: 1.4, pulseRate: 0 } },
    { presetId: "neon_trace.night", displayName: "夜店追光", params: { ...defaults } },
    { presetId: "neon_trace.comet", displayName: "霓虹彗尾", params: { ...defaults, progress: 0.72, glowRadius: 32, intensity: 3.5, trailLength: 0.12, pulseRate: 2.4 } }
  ],
  inputSlots: [{
    name: "source_image",
    kind: "image",
    required: true,
    cardinality: "one",
    description: "Owner-authorized image used as the background and for semantic endpoint positioning."
  }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({
    ...params,
    progress: round(params.progress),
    hue: round(params.hue, 2),
    startX: round(params.startX),
    startY: round(params.startY),
    endX: round(params.endX),
    endY: round(params.endY),
    curve: round(params.curve)
  }),
  validateParams: (params) => Math.hypot(params.endX - params.startX, params.endY - params.startY) < 0.01
    ? { valid: false, issues: [{ path: "$.data", message: "Neon endpoints must be distinct." }] }
    : VALID_PARAMS,
  render: (context, params) => {
    readImageDimensions(context, "source_image");
    const startPoint = { x: params.startX * (context.width - 1), y: params.startY * (context.height - 1) };
    const endPoint = { x: params.endX * (context.width - 1), y: params.endY * (context.height - 1) };
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const length = Math.hypot(dx, dy);
    const bend = params.curve * Math.min(context.width, context.height) * 0.38;
    const control = {
      x: (startPoint.x + endPoint.x) / 2 - dy / length * bend,
      y: (startPoint.y + endPoint.y) / 2 + dx / length * bend
    };
    const path = {
      closed: false,
      points: Array.from({ length: 33 }, (_, index) => {
        const t = index / 32;
        const inverse = 1 - t;
        return {
          x: inverse * inverse * startPoint.x + 2 * inverse * t * control.x + t * t * endPoint.x,
          y: inverse * inverse * startPoint.y + 2 * inverse * t * control.y + t * t * endPoint.y
        };
      })
    };
    const revealProgress = clamp(context.time / 1.4, 0, 1);
    const traceProgress = params.progress * revealProgress;
    const start = clamp(traceProgress - params.trailLength, 0, 1);
    const points = traceProgress <= Number.EPSILON ? [] : slicePath(path, start, traceProgress, 4);
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
      glowLayers: layers,
      revealProgress: round(revealProgress)
    });
  }
};
