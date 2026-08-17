import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, clamp, effectResult, numberField,
  parameterSchema, randomAt, readPath, resamplePath, round, roundPoint
} from "./common.js";

export interface MarkerStrokeParams extends JsonObject {
  width: number;
  opacity: number;
  overlap: number;
  bleed: number;
  edgeRoughness: number;
  spacing: number;
}

const defaults: MarkerStrokeParams = {
  width: 28, opacity: 0.82, overlap: 0.35, bleed: 0.12, edgeRoughness: 0.08, spacing: 0.3
};

export const MARKER_STROKE_DEFINITION: EffectToolDefinition<MarkerStrokeParams> = {
  effectId: "fx.draw.markerStroke",
  toolName: "marker_stroke",
  displayName: "马克笔涂抹",
  version: "1.0.0",
  category: "draw",
  parameterSchema: parameterSchema({
    width: numberField(28, 1, 400),
    opacity: numberField(0.82, 0, 1),
    overlap: numberField(0.35, 0, 1),
    bleed: numberField(0.12, 0, 1),
    edgeRoughness: numberField(0.08, 0, 0.5),
    spacing: numberField(0.3, 0.05, 1)
  }),
  defaults,
  presets: [
    { presetId: "marker_stroke.clean", displayName: "干净荧光笔", params: { ...defaults, opacity: 0.55, bleed: 0.03, edgeRoughness: 0.02 } },
    { presetId: "marker_stroke.paper", displayName: "纸面马克笔", params: { ...defaults } },
    { presetId: "marker_stroke.wet", displayName: "湿润叠色", params: { ...defaults, width: 42, overlap: 0.65, bleed: 0.28, edgeRoughness: 0.16 } }
  ],
  inputSlots: [{ name: "stroke_path", kind: "data", required: true, cardinality: "one", description: "Server-bound marker centerline." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, width: round(params.width, 2), opacity: round(params.opacity) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const path = readPath(context, "stroke_path");
    const spacing = Math.max(0.5, params.width * params.spacing * (1 - params.overlap * 0.5));
    const samples = resamplePath(path, spacing);
    const dabs = samples.map((point, index) => {
      const previous = samples[Math.max(0, index - 1)]!;
      const next = samples[Math.min(samples.length - 1, index + 1)]!;
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const length = Math.hypot(dx, dy) || 1;
      const offset = (randomAt(context.seed, index) - 0.5) * params.width * params.edgeRoughness;
      const bleedScale = 1 + randomAt(context.seed ^ 0x51f15e, index) * params.bleed;
      return {
        center: roundPoint({ x: point.x - dy / length * offset, y: point.y + dx / length * offset }),
        width: round(params.width * bleedScale),
        height: round(params.width * (0.72 + params.overlap * 0.18)),
        opacity: round(params.opacity * (0.9 + randomAt(context.seed ^ 0x21a3, index) * 0.1)),
        angle: round(Math.atan2(dy, dx))
      };
    });
    return effectResult("metadata", {
      algorithm: "overlapping_marker_dabs",
      dabs,
      composite: "multiply-alpha",
      bleed: round(params.bleed),
      edgeRoughness: round(params.edgeRoughness),
      overlap: round(params.overlap),
      revealProgress: round(clamp(context.time / 1.4, 0, 1))
    });
  }
};
