import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, effectResult,
  numberField, parameterSchema, resamplePath, round, roundPoint
} from "./common.js";

export interface WavePathParams extends JsonObject {
  amplitude: number;
  wavelength: number;
  phase: number;
  speed: number;
  taper: number;
  sampleSpacing: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const defaults: WavePathParams = {
  amplitude: 24, wavelength: 160, phase: 0, speed: 0.25, taper: 0, sampleSpacing: 8,
  startX: 0.15, startY: 0.5, endX: 0.85, endY: 0.5
};

export const WAVE_PATH_DEFINITION: EffectToolDefinition<WavePathParams> = {
  effectId: "fx.vector.wavePath",
  toolName: "wave_path",
  displayName: "路径波浪形变",
  version: "2.0.0",
  category: "vector",
  parameterSchema: parameterSchema({
    amplitude: numberField(24, 0, 500),
    wavelength: numberField(160, 4, 2000),
    phase: numberField(0, -360, 360),
    speed: numberField(0.25, -10, 10),
    taper: numberField(0, 0, 1),
    sampleSpacing: numberField(8, 1, 64),
    startX: numberField(0.15, 0, 1),
    startY: numberField(0.5, 0, 1),
    endX: numberField(0.85, 0, 1),
    endY: numberField(0.5, 0, 1)
  }),
  defaults,
  presets: [
    { presetId: "wave_path.gentle", displayName: "柔和波纹", params: { ...defaults, amplitude: 12, wavelength: 220 } },
    { presetId: "wave_path.ribbon", displayName: "飘带波浪", params: { ...defaults, amplitude: 36, wavelength: 180, speed: 0.5 } },
    { presetId: "wave_path.ripple", displayName: "密集振荡", params: { ...defaults, amplitude: 18, wavelength: 72, speed: 1.2 } }
  ],
  inputSlots: [{ name: "source_image", kind: "image", required: true, cardinality: "one", description: "Owner-authorized image receiving the positioned wave path." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "light",
  normalizeParams: (params) => ({ ...params, phase: round(params.phase, 3), speed: round(params.speed, 3) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const source = {
      points: [
        { x: params.startX * Math.max(1, context.width - 1), y: params.startY * Math.max(1, context.height - 1) },
        { x: params.endX * Math.max(1, context.width - 1), y: params.endY * Math.max(1, context.height - 1) }
      ],
      closed: false
    };
    const points = resamplePath(source, params.sampleSpacing);
    const phase = (params.phase * Math.PI / 180) + context.time * params.speed * Math.PI * 2;
    const output = points.map((point, index) => {
      const previous = points[Math.max(0, index - 1)]!;
      const next = points[Math.min(points.length - 1, index + 1)]!;
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const length = Math.hypot(dx, dy) || 1;
      const progress = points.length <= 1 ? 0 : index / (points.length - 1);
      const edgeEnvelope = 1 - params.taper * Math.abs(progress * 2 - 1);
      const displacement = Math.sin(progress * Math.max(1, points.length - 1) * params.sampleSpacing
        / params.wavelength * Math.PI * 2 + phase) * params.amplitude * edgeEnvelope;
      return roundPoint({ x: point.x - dy / length * displacement, y: point.y + dx / length * displacement });
    });
    return effectResult("metadata", {
      algorithm: "arc_length_normal_wave",
      points: output,
      sourcePoints: points,
      closed: source.closed,
      phaseRadians: round(phase),
      amplitude: round(params.amplitude),
      wavelength: round(params.wavelength),
      taper: round(params.taper)
    });
  }
};
