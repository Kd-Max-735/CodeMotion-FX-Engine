import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_03_BACKEND,
  BATCH_03_REJECT_FALLBACK,
  CLOSED_SCHEMA,
  VALID_PARAMS,
  createParticleBuffer,
  particleTextureResult,
  seededUnit,
  setParticle
} from "./shared.js";

export interface ParticleSparkParams extends JsonObject {
  count: number;
  speed: number;
  spread: number;
  lifetime: number;
  gravity: number;
  glow: number;
  size: number;
}

const defaults: ParticleSparkParams = { count: 180, speed: 680, spread: 360, lifetime: 0.65, gravity: 520, glow: 1.4, size: 3 };

export const PARTICLE_SPARK_DEFINITION: EffectToolDefinition<ParticleSparkParams> = {
  effectId: "fx.particle.spark",
  toolName: "particle_spark",
  displayName: "火花粒子",
  version: "1.0.0",
  category: "particle",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      count: { type: "integer", minimum: 1, maximum: 10000, default: 180 },
      speed: { type: "number", minimum: 0, maximum: 3000, default: 680 },
      spread: { type: "number", minimum: 1, maximum: 360, default: 360 },
      lifetime: { type: "number", minimum: 0.02, maximum: 5, default: 0.65 },
      gravity: { type: "number", minimum: -2000, maximum: 3000, default: 520 },
      glow: { type: "number", minimum: 0, maximum: 5, default: 1.4 },
      size: { type: "number", minimum: 0.2, maximum: 30, default: 3 }
    }
  },
  defaults,
  presets: [
    { presetId: "spark.flicker", displayName: "零星闪烁", params: { ...defaults, count: 42, speed: 180, lifetime: 1.1, gravity: 120, glow: 0.8, size: 2 } },
    { presetId: "spark.impact", displayName: "冲击火花", params: { ...defaults } },
    { presetId: "spark.grinder", displayName: "砂轮飞溅", params: { ...defaults, count: 680, speed: 1250, spread: 95, lifetime: 0.42, gravity: 900, glow: 2.2, size: 1.5 } }
  ],
  inputSlots: [],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, count: Math.round(params.count) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const age = Math.max(0, context.time);
    const alive = age <= params.lifetime;
    const buffer = createParticleBuffer(context, alive ? params.count : 0, "streak");
    for (let index = 0; index < buffer.count; index += 1) {
      const angle = (seededUnit(context.seed, index * 2) - 0.5) * params.spread * Math.PI / 180;
      const velocity = params.speed * (0.55 + seededUnit(context.seed, index * 2 + 1) * 0.9);
      const vx = Math.cos(angle) * velocity;
      const vy = Math.sin(angle) * velocity + params.gravity * age;
      const glow = Math.min(1, params.glow / 2);
      setParticle(buffer, index, {
        x: context.width * 0.5 + vx * age,
        y: context.height * 0.5 + Math.sin(angle) * velocity * age + params.gravity * age * age * 0.5,
        vx,
        vy,
        size: params.size,
        opacity: (1 - age / params.lifetime) * glow,
        color: [255, 190 + seededUnit(context.seed, index + 500) * 65, 72, 255]
      });
    }
    return particleTextureResult(context, buffer);
  }
};
