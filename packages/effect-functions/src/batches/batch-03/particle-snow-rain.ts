import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_03_BACKEND,
  BATCH_03_REJECT_FALLBACK,
  CLOSED_SCHEMA,
  VALID_PARAMS,
  createParticleBuffer,
  particleTextureResult,
  seededSigned,
  seededUnit,
  setParticle
} from "./shared.js";

export interface ParticleSnowRainParams extends JsonObject {
  mode: "snow" | "rain";
  density: number;
  fallSpeed: number;
  wind: number;
  turbulence: number;
  size: number;
  depth: number;
  opacity: number;
}

const defaults: ParticleSnowRainParams = { mode: "snow", density: 0.55, fallSpeed: 180, wind: 20, turbulence: 0.35, size: 5, depth: 0.7, opacity: 0.85 };

export const PARTICLE_SNOW_RAIN_DEFINITION: EffectToolDefinition<ParticleSnowRainParams> = {
  effectId: "fx.particle.snowRain",
  toolName: "particle_snow_rain",
  displayName: "雨雪粒子",
  version: "1.0.0",
  category: "particle",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      mode: { type: "string", enum: ["snow", "rain"], default: "snow" },
      density: { type: "number", minimum: 0.01, maximum: 1, default: 0.55 },
      fallSpeed: { type: "number", minimum: 10, maximum: 2000, default: 180 },
      wind: { type: "number", minimum: -800, maximum: 800, default: 20 },
      turbulence: { type: "number", minimum: 0, maximum: 1, default: 0.35 },
      size: { type: "number", minimum: 0.5, maximum: 50, default: 5 },
      depth: { type: "number", minimum: 0, maximum: 1, default: 0.7 },
      opacity: { type: "number", minimum: 0, maximum: 1, default: 0.85 }
    }
  },
  defaults,
  presets: [
    { presetId: "weather.snow", displayName: "轻柔飘雪", params: { ...defaults } },
    { presetId: "weather.blizzard", displayName: "暴风雪", params: { ...defaults, density: 0.92, fallSpeed: 420, wind: 360, turbulence: 0.8, size: 7, depth: 1 } },
    { presetId: "weather.rain", displayName: "急雨", params: { ...defaults, mode: "rain", density: 0.78, fallSpeed: 1100, wind: 85, turbulence: 0.08, size: 2, depth: 0.85, opacity: 0.68 } }
  ],
  inputSlots: [],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const count = Math.ceil((context.width * context.height / 5_000) * params.density
      * (params.mode === "rain" ? 1.4 : 1));
    const buffer = createParticleBuffer(context, count, params.mode === "rain" ? "streak" : "disc");
    const wrap = (value: number, size: number) => ((value % size) + size) % size;
    for (let index = 0; index < count; index += 1) {
      const z = seededUnit(context.seed, index) * params.depth;
      const speedScale = 0.45 + z * 0.9;
      const vx = params.wind * speedScale + seededSigned(context.seed, index + 40)
        * params.turbulence * (params.mode === "snow" ? 60 : 20);
      const vy = params.fallSpeed * speedScale;
      const initialX = seededUnit(context.seed, index + 20) * context.width;
      const initialY = seededUnit(context.seed, index + 30) * context.height;
      const flutter = params.mode === "snow"
        ? Math.sin(context.time * (1.5 + z) + seededUnit(context.seed, index + 50) * Math.PI * 2)
          * params.turbulence * params.size * 3
        : 0;
      setParticle(buffer, index, {
        x: wrap(initialX + vx * context.time + flutter, context.width),
        y: wrap(initialY + vy * context.time, context.height),
        vx,
        vy,
        size: params.size * (0.55 + z * 0.9) * (params.mode === "rain" ? 0.65 : 1),
        opacity: params.opacity * (0.5 + z * 0.5),
        color: params.mode === "rain" ? [165, 205, 255, 255] : [255, 255, 255, 255]
      });
    }
    return particleTextureResult(context, buffer);
  }
};
