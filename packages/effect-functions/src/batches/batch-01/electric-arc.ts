import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, animatedSeed, effectResult,
  integerField, numberField, parameterSchema, randomAt, round, roundPoint
} from "./common.js";

export interface ElectricArcParams extends JsonObject {
  segmentCount: number;
  branchCount: number;
  noise: number;
  glow: number;
  intensity: number;
  branchLength: number;
  flickerRate: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  arcCount: number;
  spread: number;
  color: string;
}

const defaults: ElectricArcParams = {
  segmentCount: 32, branchCount: 4, noise: 24, glow: 14, intensity: 1.5, branchLength: 0.25, flickerRate: 12,
  startX: 0.18, startY: 0.5, endX: 0.82, endY: 0.5, arcCount: 4, spread: 0.18, color: "#48d8ff"
};

export const ELECTRIC_ARC_DEFINITION: EffectToolDefinition<ElectricArcParams> = {
  effectId: "fx.light.electricArc",
  toolName: "electric_arc",
  displayName: "电弧连接",
  version: "1.1.0",
  category: "light",
  parameterSchema: parameterSchema({
    segmentCount: integerField(32, 4, 256),
    branchCount: integerField(4, 0, 32),
    noise: numberField(24, 0, 300),
    glow: numberField(14, 0, 150),
    intensity: numberField(1.5, 0, 10),
    branchLength: numberField(0.25, 0.02, 0.8),
    flickerRate: numberField(12, 0, 60),
    startX: numberField(0.18, 0, 1),
    startY: numberField(0.5, 0, 1),
    endX: numberField(0.82, 0, 1),
    endY: numberField(0.5, 0, 1),
    arcCount: integerField(4, 1, 12),
    spread: numberField(0.18, 0, 1),
    color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", default: "#48d8ff" }
  }),
  defaults,
  presets: [
    { presetId: "electric_arc.tesla", displayName: "特斯拉细弧", params: { ...defaults, segmentCount: 48, branchCount: 2, noise: 12, glow: 8, intensity: 1.1 } },
    { presetId: "electric_arc.energy", displayName: "能量连接", params: { ...defaults } },
    { presetId: "electric_arc.overload", displayName: "过载电弧", params: { ...defaults, segmentCount: 72, branchCount: 10, noise: 48, glow: 28, intensity: 3, branchLength: 0.38, flickerRate: 20 } }
  ],
  inputSlots: [{ name: "source_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized base image under the electric arcs." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({
    ...params,
    segmentCount: Math.round(params.segmentCount),
    branchCount: Math.round(params.branchCount),
    arcCount: Math.round(params.arcCount),
    startX: round(params.startX),
    startY: round(params.startY),
    endX: round(params.endX),
    endY: round(params.endY),
    spread: round(params.spread),
    color: params.color.toLowerCase()
  }),
  validateParams: (params) => Math.hypot(params.endX - params.startX, params.endY - params.startY) >= 0.02
    ? VALID_PARAMS
    : { valid: false, issues: [{ path: "$.data", message: "Electric arc endpoints must be distinct." }] },
  render: (context, params) => {
    const seed = animatedSeed(context, params.flickerRate, 313);
    const baseStart = { x: params.startX * (context.width - 1), y: params.startY * (context.height - 1) };
    const baseEnd = { x: params.endX * (context.width - 1), y: params.endY * (context.height - 1) };
    const baseDx = baseEnd.x - baseStart.x;
    const baseDy = baseEnd.y - baseStart.y;
    const baseLength = Math.hypot(baseDx, baseDy) || 1;
    const normalX = -baseDy / baseLength;
    const normalY = baseDx / baseLength;
    const spreadPixels = params.spread * Math.min(context.width, context.height) * 0.5;
    const arcs = Array.from({ length: params.arcCount }, (_, arcIndex) => {
      const lane = params.arcCount === 1 ? 0 : arcIndex / (params.arcCount - 1) - 0.5;
      const startShift = lane * spreadPixels;
      const endShift = (lane * 0.72 + (randomAt(seed ^ 0x61f3, arcIndex) - 0.5) * 0.28) * spreadPixels;
      const start = { x: baseStart.x + normalX * startShift, y: baseStart.y + normalY * startShift };
      const end = { x: baseEnd.x + normalX * endShift, y: baseEnd.y + normalY * endShift };
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      const points = Array.from({ length: params.segmentCount + 1 }, (_, index) => {
        const t = index / params.segmentCount;
        const envelope = Math.sin(t * Math.PI);
        const low = Math.sin(t * Math.PI * 4 + randomAt(seed, arcIndex) * Math.PI * 2);
        const high = randomAt(seed ^ Math.imul(arcIndex + 1, 911), index) * 2 - 1;
        const offset = (low * 0.45 + high * 0.55) * params.noise * envelope;
        return roundPoint({ x: start.x + dx * t - dy / length * offset, y: start.y + dy * t + dx / length * offset });
      });
      return { points, lane: arcIndex };
    });
    const flattened = arcs.flatMap((arc) => arc.points.slice(1, -1));
    const branches = Array.from({ length: params.branchCount }, (_, index) => {
      const origin = flattened[Math.floor(randomAt(seed ^ 0xb4a1, index) * Math.max(1, flattened.length))] ?? baseStart;
      const angle = randomAt(seed ^ 0x5f21, index) * Math.PI * 2;
      const length = Math.hypot(context.width, context.height) * params.branchLength * (0.25 + randomAt(seed, index + 700) * 0.75);
      const steps = Math.max(3, Math.round(params.segmentCount * params.branchLength));
      const points = Array.from({ length: steps }, (_, step) => {
        const t = step / (steps - 1);
        const deviation = (randomAt(seed ^ index, step + 1200) - 0.5) * params.noise * t;
        return roundPoint({
          x: origin.x + Math.cos(angle) * length * t - Math.sin(angle) * deviation,
          y: origin.y + Math.sin(angle) * length * t + Math.cos(angle) * deviation
        });
      });
      return { points, intensity: round(params.intensity * (1 - index / Math.max(1, params.branchCount) * 0.7)) };
    });
    return effectResult("metadata", {
      algorithm: "positioned_distributed_harmonic_arc",
      arcs,
      branches,
      glowRadius: round(params.glow),
      intensity: round(params.intensity),
      color: params.color,
      coordinateSpace: "pixel",
      colorSpace: "linear-srgb"
    });
  }
};
