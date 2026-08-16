import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  COLOR_SCHEMA,
  REJECT_FALLBACK,
  SERVER_CPU_BACKEND,
  hashSeed,
  metadataResult,
  normalizeColor,
  round,
  schema,
  valid
} from "./shared.js";

export interface NoiseFieldParams extends JsonObject {
  seed: number;
  gridSize: number;
  scale: number;
  octaves: number;
  persistence: number;
  speed: number;
  lowColor: string;
  highColor: string;
}

const defaults: NoiseFieldParams = {
  seed: 17,
  gridSize: 24,
  scale: 2.5,
  octaves: 4,
  persistence: 0.5,
  speed: 0.25,
  lowColor: "#102A43",
  highColor: "#F0F4F8"
};

function lattice(seed: number, x: number, y: number): number {
  const mixed = hashSeed(seed ^ Math.imul(x, 0x1f123bb5), Math.imul(y, 0x5f356495));
  return mixed / 0xffffffff;
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = lattice(seed, x0, y0) * (1 - tx) + lattice(seed, x0 + 1, y0) * tx;
  const b = lattice(seed, x0, y0 + 1) * (1 - tx) + lattice(seed, x0 + 1, y0 + 1) * tx;
  return a * (1 - ty) + b * ty;
}

export const noiseFieldDefinition: EffectToolDefinition<NoiseFieldParams> = {
  effectId: "fx.gen.noiseField",
  toolName: "noise_field",
  displayName: "噪声场",
  version: "1.0.0",
  category: "generative",
  parameterSchema: schema({
    seed: { type: "integer", minimum: 0, maximum: 2147483647, default: defaults.seed },
    gridSize: { type: "integer", minimum: 8, maximum: 64, default: defaults.gridSize },
    scale: { type: "number", minimum: 0.25, maximum: 12, default: defaults.scale },
    octaves: { type: "integer", minimum: 1, maximum: 6, default: defaults.octaves },
    persistence: { type: "number", minimum: 0.1, maximum: 0.85, default: defaults.persistence },
    speed: { type: "number", minimum: -4, maximum: 4, default: defaults.speed },
    lowColor: { ...COLOR_SCHEMA, default: defaults.lowColor },
    highColor: { ...COLOR_SCHEMA, default: defaults.highColor }
  }),
  defaults,
  presets: [
    { presetId: "batch07.noise.mist", displayName: "柔雾", params: { ...defaults, scale: 1.2, octaves: 3, persistence: 0.42, speed: 0.12 } },
    { presetId: "batch07.noise.terrain", displayName: "地形", params: { ...defaults, gridSize: 40, scale: 4.5, octaves: 5, persistence: 0.58, speed: 0 } },
    { presetId: "batch07.noise.turbulence", displayName: "湍流", params: { ...defaults, seed: 91, scale: 7, octaves: 6, persistence: 0.7, speed: 1.2 } }
  ],
  inputSlots: [],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({
    ...params,
    scale: round(params.scale),
    persistence: round(params.persistence),
    speed: round(params.speed),
    lowColor: normalizeColor(params.lowColor),
    highColor: normalizeColor(params.highColor)
  }),
  validateParams: (params) => params.gridSize ** 2 * params.octaves <= 24_576
    ? valid()
    : {
        valid: false,
        issues: [{ path: "$", message: "gridSize squared times octaves must not exceed 24,576" }]
      },
  render: (context, params) => {
    const seed = hashSeed(context.seed, params.seed);
    const phase = context.time * params.speed;
    const values: number[] = [];
    for (let y = 0; y < params.gridSize; y += 1) {
      for (let x = 0; x < params.gridSize; x += 1) {
        let amplitude = 1;
        let frequency = 1;
        let total = 0;
        let weight = 0;
        for (let octave = 0; octave < params.octaves; octave += 1) {
          const nx = ((x / (params.gridSize - 1)) * params.scale + phase) * frequency;
          const ny = ((y / (params.gridSize - 1)) * params.scale + phase * 0.618) * frequency;
          total += valueNoise(seed + octave * 1013, nx, ny) * amplitude;
          weight += amplitude;
          amplitude *= params.persistence;
          frequency *= 2;
        }
        values.push(round(total / weight, 5));
      }
    }
    return metadataResult({ algorithm: "fractal_value_noise", width: params.gridSize,
      height: params.gridSize, values, colors: [params.lowColor, params.highColor], seed });
  }
};
