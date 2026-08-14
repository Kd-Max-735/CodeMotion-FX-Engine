import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_04_BACKEND,
  REJECT_FALLBACK,
  bounded,
  boundedInt,
  fixedSteps,
  indexList,
  rounded,
  simulationResult,
  validParams
} from "./runtime.js";

export interface FluidLiteParams extends JsonObject {
  gridSize: number;
  viscosity: number;
  densityDiffusion: number;
  vorticity: number;
  injectionStrength: number;
  buoyancy: number;
  pressureIterations: number;
}

export const FLUID_LITE_DEFAULTS: FluidLiteParams = {
  gridSize: 16,
  viscosity: 0.025,
  densityDiffusion: 0.018,
  vorticity: 1.4,
  injectionStrength: 4.5,
  buoyancy: 1.2,
  pressureIterations: 4
};

function normalize(params: Readonly<FluidLiteParams>): FluidLiteParams {
  return {
    gridSize: boundedInt(params.gridSize, 8, 24, FLUID_LITE_DEFAULTS.gridSize),
    viscosity: rounded(bounded(params.viscosity, 0, 0.2, FLUID_LITE_DEFAULTS.viscosity), 3),
    densityDiffusion: rounded(bounded(params.densityDiffusion, 0, 0.2, FLUID_LITE_DEFAULTS.densityDiffusion), 3),
    vorticity: rounded(bounded(params.vorticity, 0, 6, FLUID_LITE_DEFAULTS.vorticity), 2),
    injectionStrength: rounded(bounded(params.injectionStrength, 0, 10, FLUID_LITE_DEFAULTS.injectionStrength), 2),
    buoyancy: rounded(bounded(params.buoyancy, 0, 5, FLUID_LITE_DEFAULTS.buoyancy), 2),
    pressureIterations: boundedInt(params.pressureIterations, 1, 8, FLUID_LITE_DEFAULTS.pressureIterations)
  };
}

function neighbor(index: number, dx: number, dy: number, size: number): number {
  const x = Math.min(size - 1, Math.max(0, index % size + dx));
  const y = Math.min(size - 1, Math.max(0, Math.floor(index / size) + dy));
  return y * size + x;
}

export const FLUID_LITE_DEFINITION: EffectToolDefinition<FluidLiteParams> = {
  effectId: "fx.sim.fluidLite",
  toolName: "sim_fluid_lite",
  displayName: "轻量流体",
  version: "1.0.0",
  category: "simulation",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      gridSize: { type: "integer", minimum: 8, maximum: 24, default: 16 },
      viscosity: { type: "number", minimum: 0, maximum: 0.2, default: 0.025 },
      densityDiffusion: { type: "number", minimum: 0, maximum: 0.2, default: 0.018 },
      vorticity: { type: "number", minimum: 0, maximum: 6, default: 1.4 },
      injectionStrength: { type: "number", minimum: 0, maximum: 10, default: 4.5 },
      buoyancy: { type: "number", minimum: 0, maximum: 5, default: 1.2 },
      pressureIterations: { type: "integer", minimum: 1, maximum: 8, default: 4 }
    }
  },
  defaults: FLUID_LITE_DEFAULTS,
  presets: [
    { presetId: "fluid_lite.smoke", displayName: "缓升烟雾", params: { ...FLUID_LITE_DEFAULTS, viscosity: 0.055, densityDiffusion: 0.035, buoyancy: 2.5, vorticity: 0.8 } },
    { presetId: "fluid_lite.ink", displayName: "浓墨扩散", params: { ...FLUID_LITE_DEFAULTS, injectionStrength: 8, densityDiffusion: 0.01, viscosity: 0.08, buoyancy: 0.3 } },
    { presetId: "fluid_lite.swirl", displayName: "旋涡流体", params: { ...FLUID_LITE_DEFAULTS, gridSize: 22, vorticity: 4.8, viscosity: 0.008, pressureIterations: 7 } }
  ],
  inputSlots: [{
    name: "obstacle_mask",
    kind: "mask",
    required: false,
    cardinality: "one",
    description: "Optional owner-locked server obstacle-cell mask."
  }],
  primaryBackend: BATCH_04_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: normalize,
  validateParams: validParams,
  render: (context, rawParams) => {
    const params = normalize(rawParams);
    const steps = fixedSteps(context, 30, 180);
    const cellCount = params.gridSize ** 2;
    const blocked = indexList(context.inputs, "obstacle_mask", "blockedIndices", cellCount - 1);
    let density = new Float64Array(cellCount);
    let velocityX = new Float64Array(cellCount);
    let velocityY = new Float64Array(cellCount);
    const pressure = new Float64Array(cellCount);
    const divergence = new Float64Array(cellCount);
    for (let step = 0; step < steps.count; step += 1) {
      const sourceX = Math.floor(params.gridSize * (0.35 + 0.3 * ((step % 60) / 59)));
      const sourceY = Math.floor(params.gridSize * 0.72);
      const source = sourceY * params.gridSize + sourceX;
      if (!blocked.has(source)) {
        density[source] = Math.min(20, density[source]! + params.injectionStrength * steps.dt);
        velocityY[source] = velocityY[source]! - params.injectionStrength * 0.15 * steps.dt;
        velocityX[source] = velocityX[source]!
          + (step % 2 === 0 ? 1 : -1) * params.vorticity * 0.04;
      }
      const nextDensity = new Float64Array(cellCount);
      const nextVelocityX = new Float64Array(cellCount);
      const nextVelocityY = new Float64Array(cellCount);
      for (let index = 0; index < cellCount; index += 1) {
        if (blocked.has(index)) continue;
        const left = neighbor(index, -1, 0, params.gridSize);
        const right = neighbor(index, 1, 0, params.gridSize);
        const up = neighbor(index, 0, -1, params.gridSize);
        const down = neighbor(index, 0, 1, params.gridSize);
        const densityLaplacian = density[left]! + density[right]! + density[up]! + density[down]! - 4 * density[index]!;
        const velocityLaplacianX = velocityX[left]! + velocityX[right]! + velocityX[up]! + velocityX[down]! - 4 * velocityX[index]!;
        const velocityLaplacianY = velocityY[left]! + velocityY[right]! + velocityY[up]! + velocityY[down]! - 4 * velocityY[index]!;
        const curl = (velocityY[right]! - velocityY[left]! - velocityX[down]! + velocityX[up]!) * 0.5;
        nextDensity[index] = Math.max(0, density[index]! + densityLaplacian * params.densityDiffusion);
        nextVelocityX[index] = velocityX[index]! + velocityLaplacianX * params.viscosity + curl * params.vorticity * steps.dt * 0.05;
        nextVelocityY[index] = velocityY[index]! + velocityLaplacianY * params.viscosity
          - nextDensity[index]! * params.buoyancy * steps.dt * 0.02;
      }
      density = nextDensity;
      velocityX = nextVelocityX;
      velocityY = nextVelocityY;
      for (let index = 0; index < cellCount; index += 1) {
        if (blocked.has(index)) continue;
        divergence[index] = -0.5 * (velocityX[neighbor(index, 1, 0, params.gridSize)]!
          - velocityX[neighbor(index, -1, 0, params.gridSize)]!
          + velocityY[neighbor(index, 0, 1, params.gridSize)]!
          - velocityY[neighbor(index, 0, -1, params.gridSize)]!);
        pressure[index] = 0;
      }
      for (let iteration = 0; iteration < params.pressureIterations; iteration += 1) {
        for (let index = 0; index < cellCount; index += 1) {
          if (blocked.has(index)) continue;
          pressure[index] = (divergence[index]!
            + pressure[neighbor(index, -1, 0, params.gridSize)]!
            + pressure[neighbor(index, 1, 0, params.gridSize)]!
            + pressure[neighbor(index, 0, -1, params.gridSize)]!
            + pressure[neighbor(index, 0, 1, params.gridSize)]!) / 4;
        }
      }
      for (let index = 0; index < cellCount; index += 1) {
        if (blocked.has(index)) continue;
        velocityX[index] = velocityX[index]! - 0.5
          * (pressure[neighbor(index, 1, 0, params.gridSize)]!
            - pressure[neighbor(index, -1, 0, params.gridSize)]!);
        velocityY[index] = velocityY[index]! - 0.5
          * (pressure[neighbor(index, 0, 1, params.gridSize)]!
            - pressure[neighbor(index, 0, -1, params.gridSize)]!);
      }
    }
    const cells = Array.from({ length: cellCount }, (_, index) => ({
      density: rounded(density[index]!, 5),
      vx: rounded(velocityX[index]!, 5),
      vy: rounded(velocityY[index]!, 5),
      blocked: blocked.has(index)
    }));
    const totalDensity = density.reduce((sum, value) => sum + value, 0);
    const maxVelocity = velocityX.reduce((maximum, value, index) =>
      Math.max(maximum, Math.hypot(value, velocityY[index]!)), 0);
    return simulationResult("fx.sim.fluidLite", steps.count, steps.dt,
      { gridSize: params.gridSize, cells },
      { cellCount, blockedCellCount: blocked.size, totalDensity: rounded(totalDensity), maxVelocity: rounded(maxVelocity) },
      steps.capped);
  }
};
