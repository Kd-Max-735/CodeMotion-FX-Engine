import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { BATCH_03_CPU_FALLBACK, BATCH_03_GPU_BACKEND, CLOSED_SCHEMA, VALID_PARAMS, metadataResult, round, seededSigned, seededUnit } from "./shared.js";

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
  primaryBackend: BATCH_03_GPU_BACKEND,
  fallbackStrategy: { kind: "server-backend", backend: BATCH_03_CPU_FALLBACK, fidelity: "degraded", requiresFinalApproval: true },
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const particles = Array.from({ length: 8 }, (_, index) => {
      const age = seededUnit(context.seed, index * 3) * params.lifetime;
      const angle = (params.direction + seededSigned(context.seed, index * 3 + 1) * params.spread * 0.5) * Math.PI / 180;
      const velocity = params.speed * (0.75 + seededUnit(context.seed, index * 3 + 2) * 0.5);
      const damp = Math.exp(-params.drag * age);
      return { age: round(age), vx: round(Math.cos(angle) * velocity * damp), vy: round(Math.sin(angle) * velocity * damp + params.gravity * age) };
    });
    return metadataResult(context, { algorithm: "continuous_seeded_emission", seed: context.seed, activeCapacity: Math.ceil(params.rate * params.lifetime), particles });
  }
};
