import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { COLOR_SCHEMA, REJECT_FALLBACK, SERVER_CPU_BACKEND, invalid, metadataResult,
  normalizeColor, round, schema, valid } from "./shared.js";

export interface FractalParams extends JsonObject {
  gridSize: number;
  iterations: number;
  centerX: number;
  centerY: number;
  zoom: number;
  rotation: number;
  speed: number;
  strength: number;
  insideColor: string;
  outsideColor: string;
}

const defaults: FractalParams = {
  gridSize: 48, iterations: 120, centerX: -0.5, centerY: 0, zoom: 1,
  rotation: 0, speed: 0.18, strength: 0.65, insideColor: "#081C15", outsideColor: "#D8F3DC"
};
export const fractalDefinition: EffectToolDefinition<FractalParams> = {
  effectId: "fx.gen.fractal",
  toolName: "fractal",
  displayName: "分形",
  version: "1.1.0",
  category: "generative",
  parameterSchema: schema({
    gridSize: { type: "integer", minimum: 8, maximum: 64, default: defaults.gridSize },
    iterations: { type: "integer", minimum: 16, maximum: 256, default: defaults.iterations },
    centerX: { type: "number", minimum: -2.5, maximum: 1, default: defaults.centerX },
    centerY: { type: "number", minimum: -1.5, maximum: 1.5, default: defaults.centerY },
    zoom: { type: "number", minimum: 0.25, maximum: 200, default: defaults.zoom },
    rotation: { type: "number", minimum: -180, maximum: 180, default: defaults.rotation },
    speed: { type: "number", minimum: -2, maximum: 2, default: defaults.speed },
    strength: { type: "number", minimum: 0, maximum: 1, default: defaults.strength },
    insideColor: { ...COLOR_SCHEMA, default: defaults.insideColor },
    outsideColor: { ...COLOR_SCHEMA, default: defaults.outsideColor }
  }),
  defaults,
  presets: [
    { presetId: "batch07.fractal.classic", displayName: "经典集合", params: { ...defaults } },
    { presetId: "batch07.fractal.seahorse", displayName: "海马谷", params: { ...defaults, gridSize: 48, iterations: 160, centerX: -0.745, centerY: 0.11, zoom: 35 } },
    { presetId: "batch07.fractal.orbit", displayName: "旋转轨道", params: { ...defaults, iterations: 120, zoom: 3, rotation: 28, speed: 0.25, insideColor: "#240046", outsideColor: "#FF9E00" } }
  ],
  inputSlots: [{ name: "background_image", kind: "image", required: true, cardinality: "one",
    description: "Server-authorized image refracted and shaded by the animated fractal field." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, centerX: round(params.centerX, 6),
    centerY: round(params.centerY, 6), zoom: round(params.zoom, 4),
    rotation: round(params.rotation, 3), speed: round(params.speed, 4),
    strength: round(params.strength, 4),
    insideColor: normalizeColor(params.insideColor), outsideColor: normalizeColor(params.outsideColor) }),
  validateParams: (params) => params.gridSize * params.gridSize * params.iterations <= 1_048_576
    ? valid() : invalid("$", "gridSize squared times iterations must not exceed 1,048,576"),
  render: (context, params) => {
    const angle = (params.rotation + context.time * params.speed * 30) * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const escape: number[] = [];
    for (let y = 0; y < params.gridSize; y += 1) {
      for (let x = 0; x < params.gridSize; x += 1) {
        const px = ((x / (params.gridSize - 1)) - 0.5) * 3 / params.zoom;
        const py = ((y / (params.gridSize - 1)) - 0.5) * 3 / params.zoom;
        const cx = params.centerX + px * cos - py * sin;
        const cy = params.centerY + px * sin + py * cos;
        let zx = 0;
        let zy = 0;
        let count = 0;
        while (zx * zx + zy * zy <= 4 && count < params.iterations) {
          const nextX = zx * zx - zy * zy + cx;
          zy = 2 * zx * zy + cy;
          zx = nextX;
          count += 1;
        }
        const magnitudeSquared = zx * zx + zy * zy;
        const smoothCount = count < params.iterations && magnitudeSquared > 1
          ? count + 1 - Math.log2(Math.log2(Math.sqrt(magnitudeSquared)))
          : params.iterations;
        escape.push(round(Math.max(0, Math.min(1, smoothCount / params.iterations)), 6));
      }
    }
    return metadataResult({ algorithm: "smooth_mandelbrot_refraction", width: params.gridSize,
      height: params.gridSize, escape, strength: params.strength,
      colors: [params.insideColor, params.outsideColor] });
  }
};
