import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_04_BACKEND,
  REJECT_FALLBACK,
  bounded,
  boundedInt,
  fixedSteps,
  indexList,
  pointList,
  rounded,
  simulationResult,
  validParams
} from "./runtime.js";

export interface ClothParams extends JsonObject {
  resolution: number;
  clothWidth: number;
  stiffness: number;
  damping: number;
  gravity: number;
  windStrength: number;
  solverIterations: number;
}

export const CLOTH_DEFAULTS: ClothParams = {
  resolution: 8,
  clothWidth: 1.2,
  stiffness: 0.82,
  damping: 0.025,
  gravity: 5,
  windStrength: 1.1,
  solverIterations: 4
};

function normalize(params: Readonly<ClothParams>): ClothParams {
  return {
    resolution: boundedInt(params.resolution, 4, 14, CLOTH_DEFAULTS.resolution),
    clothWidth: rounded(bounded(params.clothWidth, 0.5, 1.8, CLOTH_DEFAULTS.clothWidth), 2),
    stiffness: rounded(bounded(params.stiffness, 0.1, 1, CLOTH_DEFAULTS.stiffness), 2),
    damping: rounded(bounded(params.damping, 0, 0.2, CLOTH_DEFAULTS.damping), 3),
    gravity: rounded(bounded(params.gravity, 0, 20, CLOTH_DEFAULTS.gravity), 2),
    windStrength: rounded(bounded(params.windStrength, 0, 8, CLOTH_DEFAULTS.windStrength), 2),
    solverIterations: boundedInt(params.solverIterations, 1, 8, CLOTH_DEFAULTS.solverIterations)
  };
}

export const CLOTH_DEFINITION: EffectToolDefinition<ClothParams> = {
  effectId: "fx.sim.cloth",
  toolName: "sim_cloth",
  displayName: "布料模拟",
  version: "1.0.0",
  category: "simulation",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      resolution: { type: "integer", minimum: 4, maximum: 14, default: 8 },
      clothWidth: { type: "number", minimum: 0.5, maximum: 1.8, default: 1.2 },
      stiffness: { type: "number", minimum: 0.1, maximum: 1, default: 0.82 },
      damping: { type: "number", minimum: 0, maximum: 0.2, default: 0.025 },
      gravity: { type: "number", minimum: 0, maximum: 20, default: 5 },
      windStrength: { type: "number", minimum: 0, maximum: 8, default: 1.1 },
      solverIterations: { type: "integer", minimum: 1, maximum: 8, default: 4 }
    }
  },
  defaults: CLOTH_DEFAULTS,
  presets: [
    { presetId: "cloth.silk", displayName: "轻盈丝绸", params: { ...CLOTH_DEFAULTS, stiffness: 0.45, damping: 0.012, gravity: 2.5, windStrength: 2.8 } },
    { presetId: "cloth.canvas", displayName: "厚重帆布", params: { ...CLOTH_DEFAULTS, stiffness: 0.95, damping: 0.08, gravity: 10, windStrength: 0.5 } },
    { presetId: "cloth.flag", displayName: "强风旗帜", params: { ...CLOTH_DEFAULTS, resolution: 12, windStrength: 6, solverIterations: 6 } }
  ],
  inputSlots: [
    { name: "mesh", kind: "model", required: false, cardinality: "one", description: "Optional owner-locked server cloth mesh vertices." },
    { name: "pins", kind: "data", required: false, cardinality: "one", description: "Optional owner-locked server pin index set." }
  ],
  primaryBackend: BATCH_04_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: normalize,
  validateParams: validParams,
  render: (context, rawParams) => {
    const params = normalize(rawParams);
    const steps = fixedSteps(context, 60, 300);
    const count = params.resolution * params.resolution;
    const spacing = params.clothWidth / (params.resolution - 1);
    const boundVertices = pointList(context.inputs, "mesh", "vertices", count);
    const positions = Array.from({ length: count }, (_, index) => {
      const column = index % params.resolution;
      const row = Math.floor(index / params.resolution);
      const bound = boundVertices[index];
      return {
        x: bound?.x ?? -params.clothWidth / 2 + column * spacing,
        y: bound?.y ?? -0.75 + row * spacing,
        previousX: bound?.x ?? -params.clothWidth / 2 + column * spacing,
        previousY: bound?.y ?? -0.75 + row * spacing
      };
    });
    const serverPins = indexList(context.inputs, "pins", "indices", count - 1);
    const pins = serverPins.size > 0 ? serverPins : new Set([0, params.resolution - 1]);
    const links: [number, number][] = [];
    for (let row = 0; row < params.resolution; row += 1) {
      for (let column = 0; column < params.resolution; column += 1) {
        const index = row * params.resolution + column;
        if (column + 1 < params.resolution) links.push([index, index + 1]);
        if (row + 1 < params.resolution) links.push([index, index + params.resolution]);
      }
    }
    for (let step = 0; step < steps.count; step += 1) {
      const wind = params.windStrength * Math.sin(step * steps.dt * 1.7);
      for (let index = 0; index < positions.length; index += 1) {
        if (pins.has(index)) continue;
        const point = positions[index]!;
        const velocityX = (point.x - point.previousX) * (1 - params.damping);
        const velocityY = (point.y - point.previousY) * (1 - params.damping);
        point.previousX = point.x;
        point.previousY = point.y;
        point.x += velocityX + wind * steps.dt ** 2;
        point.y += velocityY + params.gravity * steps.dt ** 2;
      }
      for (let iteration = 0; iteration < params.solverIterations; iteration += 1) {
        for (const [leftIndex, rightIndex] of links) {
          const left = positions[leftIndex]!;
          const right = positions[rightIndex]!;
          const dx = right.x - left.x;
          const dy = right.y - left.y;
          const distance = Math.max(1e-6, Math.hypot(dx, dy));
          const correction = (distance - spacing) / distance * 0.5 * params.stiffness;
          if (!pins.has(leftIndex)) {
            left.x += dx * correction;
            left.y += dy * correction;
          }
          if (!pins.has(rightIndex)) {
            right.x -= dx * correction;
            right.y -= dy * correction;
          }
        }
      }
    }
    const maxDisplacement = positions.reduce((maximum, point, index) => {
      const column = index % params.resolution;
      const row = Math.floor(index / params.resolution);
      const originX = boundVertices[index]?.x ?? -params.clothWidth / 2 + column * spacing;
      const originY = boundVertices[index]?.y ?? -0.75 + row * spacing;
      return Math.max(maximum, Math.hypot(point.x - originX, point.y - originY));
    }, 0);
    return simulationResult("fx.sim.cloth", steps.count, steps.dt,
      { vertices: positions.map((point, index) => ({ index, x: rounded(point.x), y: rounded(point.y), pinned: pins.has(index) })) },
      { vertexCount: positions.length, constraintCount: links.length, pinCount: pins.size, maxDisplacement: rounded(maxDisplacement) },
      steps.capped);
  }
};
