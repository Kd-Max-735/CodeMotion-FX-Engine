import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { COLOR_SCHEMA, REJECT_FALLBACK, SERVER_CPU_BACKEND, metadataResult,
  normalizeColor, round, schema, valid } from "./shared.js";

type WaveMode = "cross" | "radial" | "diagonal";

export interface WaveSurfaceParams extends JsonObject {
  mode: WaveMode;
  gridSize: number;
  amplitude: number;
  frequencyX: number;
  frequencyY: number;
  damping: number;
  speed: number;
  crestColor: string;
  troughColor: string;
}

const defaults: WaveSurfaceParams = {
  mode: "cross", gridSize: 32, amplitude: 0.55, frequencyX: 3,
  frequencyY: 2, damping: 0.35, speed: 1, crestColor: "#CAF0F8", troughColor: "#0077B6"
};
function heightAt(mode: WaveMode, x: number, y: number, phase: number,
  frequencyX: number, frequencyY: number, damping: number): number {
  if (mode === "radial") {
    const radius = Math.hypot(x, y);
    return Math.sin(radius * frequencyX * Math.PI * 2 - phase) * Math.exp(-radius * damping);
  }
  if (mode === "diagonal") {
    return Math.sin((x * frequencyX + y * frequencyY) * Math.PI - phase)
      * Math.exp(-Math.hypot(x, y) * damping * 0.5);
  }
  return (Math.sin(x * frequencyX * Math.PI + phase)
    + Math.cos(y * frequencyY * Math.PI - phase * 0.8)) * 0.5
    * Math.exp(-Math.hypot(x, y) * damping * 0.5);
}

export const waveSurfaceDefinition: EffectToolDefinition<WaveSurfaceParams> = {
  effectId: "fx.gen.waveSurface",
  toolName: "wave_surface",
  displayName: "波浪曲面",
  version: "1.0.0",
  category: "generative",
  parameterSchema: schema({
    mode: { type: "string", enum: ["cross", "radial", "diagonal"], default: defaults.mode },
    gridSize: { type: "integer", minimum: 8, maximum: 64, default: defaults.gridSize },
    amplitude: { type: "number", minimum: 0.01, maximum: 2, default: defaults.amplitude },
    frequencyX: { type: "number", minimum: 0.25, maximum: 12, default: defaults.frequencyX },
    frequencyY: { type: "number", minimum: 0.25, maximum: 12, default: defaults.frequencyY },
    damping: { type: "number", minimum: 0, maximum: 3, default: defaults.damping },
    speed: { type: "number", minimum: -4, maximum: 4, default: defaults.speed },
    crestColor: { ...COLOR_SCHEMA, default: defaults.crestColor },
    troughColor: { ...COLOR_SCHEMA, default: defaults.troughColor }
  }),
  defaults,
  presets: [
    { presetId: "batch07.wave.ocean", displayName: "交叉海浪", params: { ...defaults } },
    { presetId: "batch07.wave.ripple", displayName: "中心涟漪", params: { ...defaults, mode: "radial", gridSize: 48, amplitude: 0.35, frequencyX: 5.5, damping: 1.2, speed: 1.5 } },
    { presetId: "batch07.wave.fabric", displayName: "斜向织物", params: { ...defaults, mode: "diagonal", amplitude: 0.22, frequencyX: 7, frequencyY: 5, damping: 0.1, speed: 0.35, crestColor: "#F8F9FA", troughColor: "#6C757D" } }
  ],
  inputSlots: [],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, amplitude: round(params.amplitude),
    frequencyX: round(params.frequencyX), frequencyY: round(params.frequencyY),
    damping: round(params.damping), speed: round(params.speed),
    crestColor: normalizeColor(params.crestColor), troughColor: normalizeColor(params.troughColor) }),
  validateParams: () => valid(),
  render: (context, params) => {
    const phase = context.time * params.speed * Math.PI * 2;
    const heights: number[] = [];
    const slopes: number[] = [];
    const epsilon = 2 / (params.gridSize - 1);
    for (let y = 0; y < params.gridSize; y += 1) {
      for (let x = 0; x < params.gridSize; x += 1) {
        const px = x / (params.gridSize - 1) * 2 - 1;
        const py = y / (params.gridSize - 1) * 2 - 1;
        const height = heightAt(params.mode, px, py, phase, params.frequencyX,
          params.frequencyY, params.damping) * params.amplitude;
        const nextX = heightAt(params.mode, px + epsilon, py, phase, params.frequencyX,
          params.frequencyY, params.damping) * params.amplitude;
        const nextY = heightAt(params.mode, px, py + epsilon, phase, params.frequencyX,
          params.frequencyY, params.damping) * params.amplitude;
        heights.push(round(height, 5));
        slopes.push(round(Math.hypot(nextX - height, nextY - height) / epsilon, 5));
      }
    }
    return metadataResult({ algorithm: "damped_parametric_wave_surface", mode: params.mode,
      width: params.gridSize, height: params.gridSize, heights, slopes,
      colors: [params.crestColor, params.troughColor] });
  }
};
