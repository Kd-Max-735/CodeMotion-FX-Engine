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
  setParticle
} from "./shared.js";

export interface ParticleTrailParams extends JsonObject {
  emissionRate: number;
  trailLength: number;
  speed: number;
  width: number;
  fade: number;
  waviness: number;
  lifetime: number;
}

const defaults: ParticleTrailParams = { emissionRate: 180, trailLength: 1.2, speed: 220, width: 10, fade: 0.72, waviness: 0.18, lifetime: 1.6 };

export const PARTICLE_TRAIL_DEFINITION: EffectToolDefinition<ParticleTrailParams> = {
  effectId: "fx.particle.trail",
  toolName: "particle_trail",
  displayName: "粒子拖尾",
  version: "1.0.0",
  category: "particle",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      emissionRate: { type: "number", minimum: 1, maximum: 5000, default: 180 },
      trailLength: { type: "number", minimum: 0.05, maximum: 10, default: 1.2 },
      speed: { type: "number", minimum: 0, maximum: 2000, default: 220 },
      width: { type: "number", minimum: 0.5, maximum: 200, default: 10 },
      fade: { type: "number", minimum: 0, maximum: 1, default: 0.72 },
      waviness: { type: "number", minimum: 0, maximum: 1, default: 0.18 },
      lifetime: { type: "number", minimum: 0.05, maximum: 20, default: 1.6 }
    }
  },
  defaults,
  presets: [
    { presetId: "trail.silk", displayName: "丝带余辉", params: { ...defaults, emissionRate: 300, trailLength: 2.8, speed: 120, width: 18, fade: 0.45, waviness: 0.1, lifetime: 3.2 } },
    { presetId: "trail.comet", displayName: "彗星拖尾", params: { ...defaults } },
    { presetId: "trail.electric", displayName: "电光轨迹", params: { ...defaults, emissionRate: 520, trailLength: 0.55, speed: 620, width: 4, fade: 0.9, waviness: 0.7, lifetime: 0.65 } }
  ],
  inputSlots: [{ name: "source_image", kind: "image", required: false, cardinality: "one", description: "可选的服务端授权拖尾主体图像。" }],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const source = rgbaInput(context, "source_image", false);
    const historyWindow = Math.min(context.time, params.trailLength, params.lifetime);
    const count = Math.floor(params.emissionRate * historyWindow);
    const buffer = createParticleBuffer(context, count, "disc", source === undefined
      ? {}
      : { sourceComposite: { slot: "source_image", opacity: 1 } });
    for (let index = 0; index < count; index += 1) {
      const age = index / params.emissionRate;
      const sampleTime = Math.max(0, context.time - age);
      const phase = sampleTime * 0.9;
      const headX = context.width * (0.5 + Math.sin(phase) * 0.28);
      const headY = context.height * (0.5 + Math.cos(sampleTime * 0.7) * 0.22);
      const tangentX = Math.cos(phase) * context.width * 0.28 * 0.9;
      const tangentY = -Math.sin(sampleTime * 0.7) * context.height * 0.22 * 0.7;
      const tangentLength = Math.max(0.000001, Math.hypot(tangentX, tangentY));
      const lateral = seededSigned(context.seed, index) * params.waviness * params.width;
      const normalX = -tangentY / tangentLength;
      const normalY = tangentX / tangentLength;
      setParticle(buffer, index, {
        x: headX - tangentX / tangentLength * params.speed * age + normalX * lateral,
        y: headY - tangentY / tangentLength * params.speed * age + normalY * lateral,
        vx: tangentX,
        vy: tangentY,
        size: params.width,
        opacity: Math.exp(-params.fade * age) * (1 - age / params.lifetime),
        color: [110, 210, 255, 255]
      });
    }
    return particleTextureResult(context, buffer);
  }
};
