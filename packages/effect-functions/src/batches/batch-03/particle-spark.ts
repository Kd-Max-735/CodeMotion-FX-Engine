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
  burstCount: number;
  burstInterval: number;
}

const defaults: ParticleSparkParams = {
  count: 180, speed: 680, spread: 360, lifetime: 0.65, gravity: 520,
  glow: 1.4, size: 3, burstCount: 3, burstInterval: 0.75
};

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
      size: { type: "number", minimum: 0.2, maximum: 30, default: 3 },
      burstCount: { type: "integer", minimum: 1, maximum: 20, default: 3 },
      burstInterval: { type: "number", minimum: 0.1, maximum: 10, default: 0.75 }
    }
  },
  defaults,
  presets: [
    { presetId: "spark.flicker", displayName: "零星闪烁", params: { ...defaults, count: 42, speed: 180, lifetime: 1.1, gravity: 120, glow: 0.8, size: 2, burstCount: 6, burstInterval: 0.55 } },
    { presetId: "spark.impact", displayName: "冲击火花", params: { ...defaults, burstCount: 1 } },
    { presetId: "spark.grinder", displayName: "砂轮飞溅", params: { ...defaults, count: 680, speed: 1250, spread: 95, lifetime: 0.42, gravity: 900, glow: 2.2, size: 1.5, burstCount: 5, burstInterval: 0.28 } }
  ],
  inputSlots: [{ name: "background_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的火花背景图像；不进入模型 data。" }],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, count: Math.round(params.count), burstCount: Math.round(params.burstCount) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    rgbaInput(context, "background_image", true);
    const latestBurst = Math.min(params.burstCount - 1, Math.floor(Math.max(0, context.time) / params.burstInterval));
    const aliveBursts: { burst: number; age: number }[] = [];
    for (let burst = 0; burst <= latestBurst; burst += 1) {
      const age = context.time - burst * params.burstInterval;
      if (age >= 0 && age <= params.lifetime) aliveBursts.push({ burst, age });
    }
    const buffer = createParticleBuffer(context, aliveBursts.length * params.count, "streak", {
      sourceComposite: { slot: "background_image", opacity: 1 },
      glow: params.glow
    });
    for (let index = 0; index < buffer.count; index += 1) {
      const burst = aliveBursts[Math.floor(index / params.count)]!;
      const localIndex = index % params.count;
      const stream = burst.burst * params.count + localIndex;
      const age = burst.age;
      const angle = (seededUnit(context.seed, stream * 2) - 0.5) * params.spread * Math.PI / 180;
      const velocity = params.speed * (0.55 + seededUnit(context.seed, stream * 2 + 1) * 0.9);
      const vx = Math.cos(angle) * velocity;
      const vy = Math.sin(angle) * velocity + params.gravity * age;
      setParticle(buffer, index, {
        x: context.width * 0.5 + vx * age,
        y: context.height * 0.5 + Math.sin(angle) * velocity * age + params.gravity * age * age * 0.5,
        vx,
        vy,
        size: params.size,
        opacity: (1 - age / params.lifetime) * Math.min(1, 0.45 + params.glow * 0.28),
        color: [255, 172 + seededUnit(context.seed, stream + 500) * 83, 48 + seededUnit(context.seed, stream + 700) * 52, 255]
      });
    }
    return particleTextureResult(context, buffer);
  }
};
