import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_03_BACKEND,
  BATCH_03_REJECT_FALLBACK,
  CLOSED_SCHEMA,
  VALID_PARAMS,
  createParticleBuffer,
  particleTextureResult,
  rgbaInput,
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
  burstInterval: number;
  centerX: number;
  centerY: number;
  direction: number;
  emissionDuration: number;
  intensity: number;
  color: string;
}

const defaults: ParticleSparkParams = {
  count: 180, speed: 680, spread: 360, lifetime: 0.65, gravity: 520,
  glow: 1.4, size: 3, burstInterval: 0.75,
  centerX: 0.5, centerY: 0.5, direction: 0, emissionDuration: 3, intensity: 1, color: "#ffb030"
};

export const PARTICLE_SPARK_DEFINITION: EffectToolDefinition<ParticleSparkParams> = {
  effectId: "fx.particle.spark",
  toolName: "particle_spark",
  displayName: "火花粒子",
  version: "2.0.0",
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
      size: { type: "number", minimum: 0.2, maximum: 30, default: 3 },
      burstInterval: { type: "number", minimum: 0.1, maximum: 10, default: 0.75 },
      centerX: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      centerY: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      direction: { type: "number", minimum: -180, maximum: 180, default: 0 },
      emissionDuration: { type: "number", minimum: 0.1, maximum: 30, default: 3 },
      intensity: { type: "number", minimum: 0.1, maximum: 3, default: 1 },
      color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", default: "#ffb030" }
    }
  },
  defaults,
  presets: [
    { presetId: "spark.flicker", displayName: "零星闪烁", params: { ...defaults, count: 42, speed: 180, lifetime: 1.1, gravity: 120, glow: 0.8, size: 2, burstInterval: 0.55 } },
    { presetId: "spark.impact", displayName: "冲击火花", params: { ...defaults, emissionDuration: 0.1 } },
    { presetId: "spark.grinder", displayName: "砂轮飞溅", params: { ...defaults, count: 680, speed: 1250, spread: 95, lifetime: 0.42, gravity: 900, glow: 2.2, size: 1.5, burstInterval: 0.28 } }
  ],
  inputSlots: [{ name: "background_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的火花背景图像；不进入模型 data。" }],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, count: Math.round(params.count), color: params.color.toLowerCase() }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    rgbaInput(context, "background_image", true);
    const maximumBursts = Math.max(1, Math.ceil(params.emissionDuration / params.burstInterval));
    const latestBurst = Math.min(maximumBursts - 1, Math.floor(Math.max(0, context.time) / params.burstInterval));
    const aliveBursts: { burst: number; age: number }[] = [];
    for (let burst = 0; burst <= latestBurst; burst += 1) {
      const age = context.time - burst * params.burstInterval;
      if (age >= 0 && age <= params.lifetime) aliveBursts.push({ burst, age });
    }
    const effectiveCount = Math.max(1, Math.round(params.count * params.intensity));
    const buffer = createParticleBuffer(context, aliveBursts.length * effectiveCount, "streak", {
      sourceComposite: { slot: "background_image", opacity: 1 },
      glow: params.glow
    });
    for (let index = 0; index < buffer.count; index += 1) {
      const burst = aliveBursts[Math.floor(index / effectiveCount)]!;
      const localIndex = index % effectiveCount;
      const stream = burst.burst * effectiveCount + localIndex;
      const age = burst.age;
      const angle = (params.direction + (seededUnit(context.seed, stream * 2) - 0.5) * params.spread) * Math.PI / 180;
      const velocity = params.speed * params.intensity * (0.55 + seededUnit(context.seed, stream * 2 + 1) * 0.9);
      const vx = Math.cos(angle) * velocity;
      const vy = Math.sin(angle) * velocity + params.gravity * age;
      setParticle(buffer, index, {
        x: context.width * params.centerX + vx * age,
        y: context.height * params.centerY + Math.sin(angle) * velocity * age + params.gravity * age * age * 0.5,
        vx,
        vy,
        size: params.size,
        opacity: (1 - age / params.lifetime) * Math.min(1, 0.45 + params.glow * 0.28),
        color: [Number.parseInt(params.color.slice(1, 3), 16), Number.parseInt(params.color.slice(3, 5), 16), Number.parseInt(params.color.slice(5, 7), 16), 255]
      });
    }
    return particleTextureResult(context, buffer);
  }
};
