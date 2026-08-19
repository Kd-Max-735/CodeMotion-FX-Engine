import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, clamp, effectResult, numberField,
  parameterSchema, randomAt, resamplePath, round, roundPoint
} from "./common.js";

export interface MarkerStrokeParams extends JsonObject {
  width: number;
  opacity: number;
  overlap: number;
  bleed: number;
  edgeRoughness: number;
  spacing: number;
  color: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  curve: number;
}

const defaults: MarkerStrokeParams = {
  width: 28, opacity: 0.82, overlap: 0.35, bleed: 0.12, edgeRoughness: 0.08, spacing: 0.3,
  color: "#ff4e76", startX: 0.2, startY: 0.55, endX: 0.8, endY: 0.55, curve: 0
};

export const MARKER_STROKE_DEFINITION: EffectToolDefinition<MarkerStrokeParams> = {
  effectId: "fx.draw.markerStroke",
  toolName: "marker_stroke",
  displayName: "马克笔涂抹",
  version: "2.0.0",
  category: "draw",
  parameterSchema: parameterSchema({
    width: numberField(28, 1, 400),
    opacity: numberField(0.82, 0, 1),
    overlap: numberField(0.35, 0, 1),
    bleed: numberField(0.12, 0, 1),
    edgeRoughness: numberField(0.08, 0, 0.5),
    spacing: numberField(0.3, 0.05, 1),
    color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", default: "#ff4e76" },
    startX: numberField(0.2, 0, 1),
    startY: numberField(0.55, 0, 1),
    endX: numberField(0.8, 0, 1),
    endY: numberField(0.55, 0, 1),
    curve: numberField(0, -1, 1)
  }),
  defaults,
  presets: [
    { presetId: "marker_stroke.clean", displayName: "干净荧光笔", params: { ...defaults, opacity: 0.55, bleed: 0.03, edgeRoughness: 0.02 } },
    { presetId: "marker_stroke.paper", displayName: "纸面马克笔", params: { ...defaults } },
    { presetId: "marker_stroke.wet", displayName: "湿润叠色", params: { ...defaults, width: 42, overlap: 0.65, bleed: 0.28, edgeRoughness: 0.16 } }
  ],
  inputSlots: [{
    name: "source_image",
    kind: "image",
    required: true,
    cardinality: "one",
    description: "Owner-authorized image receiving the semantically positioned marker stroke."
  }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({
    ...params,
    width: round(params.width, 2),
    opacity: round(params.opacity),
    color: params.color.toLowerCase(),
    startX: round(params.startX),
    startY: round(params.startY),
    endX: round(params.endX),
    endY: round(params.endY),
    curve: round(params.curve)
  }),
  validateParams: (params) => Math.hypot(params.endX - params.startX, params.endY - params.startY) < 0.01
    ? { valid: false, issues: [{ path: "$.data", message: "Marker endpoints must be distinct." }] }
    : VALID_PARAMS,
  render: (context, params) => {
    const start = {
      x: params.startX * (context.width - 1),
      y: params.startY * (context.height - 1)
    };
    const end = {
      x: params.endX * (context.width - 1),
      y: params.endY * (context.height - 1)
    };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    const bend = params.curve * Math.min(context.width, context.height) * 0.38;
    const control = {
      x: (start.x + end.x) / 2 - dy / length * bend,
      y: (start.y + end.y) / 2 + dx / length * bend
    };
    const path = {
      closed: false,
      points: Array.from({ length: 33 }, (_, index) => {
        const t = index / 32;
        const inverse = 1 - t;
        return {
          x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
          y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
        };
      })
    };
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
      color: params.color,
      revealProgress: round(clamp(context.time / 1.4, 0, 1))
    });
  }
};
