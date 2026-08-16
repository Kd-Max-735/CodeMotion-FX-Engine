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
  seededSigned,
  seededUnit,
  setParticle
} from "./shared.js";

export interface ParticleEmitterParams extends JsonObject {
  rate: number;
  speed: number;
  direction: number;
  spread: number;
  lifetime: number;
  size: number;
  gravity: number;
  drag: number;
}

const defaults: ParticleEmitterParams = { rate: 120, speed: 260, direction: -90, spread: 35, lifetime: 2.2, size: 8, gravity: 180, drag: 0.08 };

export const PARTICLE_EMITTER_DEFINITION: EffectToolDefinition<ParticleEmitterParams> = {
  effectId: "fx.particle.emitter",
  toolName: "particle_emitter",
  displayName: "粒子发射器",
  version: "1.0.0",
  category: "particle",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      rate: { type: "number", minimum: 1, maximum: 5000, default: 120 },
      speed: { type: "number", minimum: 0, maximum: 2000, default: 260 },
      direction: { type: "number", minimum: -180, maximum: 180, default: -90 },
      spread: { type: "number", minimum: 0, maximum: 180, default: 35 },
      lifetime: { type: "number", minimum: 0.05, maximum: 20, default: 2.2 },
      size: { type: "number", minimum: 0.5, maximum: 200, default: 8 },
      gravity: { type: "number", minimum: -2000, maximum: 2000, default: 180 },
      drag: { type: "number", minimum: 0, maximum: 1, default: 0.08 }
    }
  },
  defaults,
  presets: [
    { presetId: "emitter.mist", displayName: "轻雾喷发", params: { ...defaults, rate: 260, speed: 70, spread: 90, lifetime: 4.5, size: 14, gravity: -12, drag: 0.2 } },
    { presetId: "emitter.fountain", displayName: "喷泉", params: { ...defaults } },
    { presetId: "emitter.jet", displayName: "高速喷流", params: { ...defaults, rate: 420, speed: 720, spread: 12, lifetime: 0.8, size: 4, gravity: 40, drag: 0.02 } }
  ],
  inputSlots: [{ name: "particle_texture", kind: "texture", required: false, cardinality: "one", description: "可选的服务端授权粒子纹理；缺省使用程序化圆形。" }],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const texture = rgbaInput(context, "particle_texture", false, false);
    const firstEmission = Math.max(0, Math.ceil((context.time - params.lifetime) * params.rate));
    const lastEmission = Math.max(firstEmission, Math.floor(context.time * params.rate));
    const count = lastEmission - firstEmission;
    const buffer = createParticleBuffer(context, count, texture === undefined ? "disc" : "sprite",
      texture === undefined ? {} : { spriteSlot: "particle_texture" });
    for (let index = 0; index < count; index += 1) {
      const emissionIndex = firstEmission + index;
      const birthTime = emissionIndex / params.rate;
      const age = Math.max(0, context.time - birthTime);
      const angle = (params.direction + seededSigned(context.seed, emissionIndex * 3 + 1)
        * params.spread * 0.5) * Math.PI / 180;
      const initialSpeed = params.speed * (0.75 + seededUnit(context.seed, emissionIndex * 3 + 2) * 0.5);
      const travelTime = params.drag > 0.000001
        ? (1 - Math.exp(-params.drag * age)) / params.drag
        : age;
      const velocityScale = Math.exp(-params.drag * age);
      const vx = Math.cos(angle) * initialSpeed * velocityScale;
      const vy = Math.sin(angle) * initialSpeed * velocityScale + params.gravity * age;
      setParticle(buffer, index, {
        x: context.width * 0.5 + Math.cos(angle) * initialSpeed * travelTime,
        y: context.height * 0.5 + Math.sin(angle) * initialSpeed * travelTime + params.gravity * age * age * 0.5,
        vx,
        vy,
        size: params.size * (0.8 + seededUnit(context.seed, emissionIndex * 3 + 3) * 0.4),
        opacity: 1 - age / params.lifetime,
        color: [255, 255, 255, 255]
      });
    }
    return particleTextureResult(context, buffer);
  }
};
