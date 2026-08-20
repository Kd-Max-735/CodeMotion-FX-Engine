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
  positionX: number;
  positionY: number;
  emissionDuration: number;
  intensity: number;
  color: string;
}

const defaults: ParticleEmitterParams = { rate: 120, speed: 260, direction: -90, spread: 35, lifetime: 2.2, size: 8, gravity: 180, drag: 0.08, positionX: 0.5, positionY: 0.5, emissionDuration: 3, intensity: 1, color: "#74d6ff" };

function hexColor(value: string): readonly number[] {
  const match = /^#([0-9a-f]{6})$/iu.exec(value);
  if (match === null) return [116, 214, 255, 255];
  return [Number.parseInt(match[1]!.slice(0, 2), 16), Number.parseInt(match[1]!.slice(2, 4), 16), Number.parseInt(match[1]!.slice(4, 6), 16), 255];
}

export const PARTICLE_EMITTER_DEFINITION: EffectToolDefinition<ParticleEmitterParams> = {
  effectId: "fx.particle.emitter",
  toolName: "particle_emitter",
  displayName: "粒子发射器",
  version: "1.1.0",
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
      drag: { type: "number", minimum: 0, maximum: 1, default: 0.08 },
      positionX: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      positionY: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      emissionDuration: { type: "number", minimum: 0.1, maximum: 30, default: 3 },
      intensity: { type: "number", minimum: 0.1, maximum: 3, default: 1 },
      color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", default: "#74d6ff" }
    }
  },
  defaults,
  presets: [
    { presetId: "emitter.mist", displayName: "轻雾喷发", params: { ...defaults, rate: 260, speed: 70, spread: 90, lifetime: 4.5, size: 14, gravity: -12, drag: 0.2 } },
    { presetId: "emitter.fountain", displayName: "喷泉", params: { ...defaults } },
    { presetId: "emitter.jet", displayName: "高速喷流", params: { ...defaults, rate: 420, speed: 720, spread: 12, lifetime: 0.8, size: 4, gravity: 40, drag: 0.02 } }
  ],
  inputSlots: [
    { name: "background_image", kind: "image", required: true, cardinality: "one", description: "Owner-authorized image or decoded video frame receiving the particles." },
    { name: "particle_texture", kind: "texture", required: false, cardinality: "one", description: "可选的服务端授权粒子纹理；缺省使用程序化圆形。" }
  ],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    rgbaInput(context, "background_image", true);
    const texture = rgbaInput(context, "particle_texture", false, false);
    const emissionEnd = Math.min(context.time, params.emissionDuration);
    const effectiveRate = params.rate * params.intensity;
    const firstEmission = Math.max(0, Math.ceil((context.time - params.lifetime) * effectiveRate));
    const lastEmission = Math.max(firstEmission, Math.floor(emissionEnd * effectiveRate));
    const count = lastEmission - firstEmission;
    const buffer = createParticleBuffer(context, count, texture === undefined ? "disc" : "sprite",
      texture === undefined
        ? { sourceComposite: { slot: "background_image", opacity: 1 }, glow: 0.72 }
        : { sourceComposite: { slot: "background_image", opacity: 1 }, spriteSlot: "particle_texture", glow: 0.38 });
    for (let index = 0; index < count; index += 1) {
      const emissionIndex = firstEmission + index;
      const birthTime = emissionIndex / effectiveRate;
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
        x: params.positionX * context.width + Math.cos(angle) * initialSpeed * travelTime,
        y: params.positionY * context.height + Math.sin(angle) * initialSpeed * travelTime + params.gravity * age * age * 0.5,
        vx,
        vy,
        size: params.size * (0.8 + seededUnit(context.seed, emissionIndex * 3 + 3) * 0.4),
        opacity: 1 - age / params.lifetime,
        color: hexColor(params.color)
      });
    }
    return particleTextureResult(context, buffer);
  }
};
