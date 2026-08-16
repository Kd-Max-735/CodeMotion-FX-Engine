import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_03_BACKEND,
  BATCH_03_REJECT_FALLBACK,
  CLOSED_SCHEMA,
  VALID_PARAMS,
  createParticleBuffer,
  opaquePixelIndices,
  particleTextureResult,
  pixelAtIndex,
  rgbaInput,
  seededSigned,
  seededUnit,
  setParticle
} from "./shared.js";

export interface ParticleDissolveParams extends JsonObject {
  progress: number;
  particleCount: number;
  force: number;
  direction: number;
  turbulence: number;
  lifetime: number;
  particleSize: number;
}

const defaults: ParticleDissolveParams = { progress: 0.5, particleCount: 4000, force: 320, direction: -35, turbulence: 0.45, lifetime: 1.4, particleSize: 3 };

export const PARTICLE_DISSOLVE_DEFINITION: EffectToolDefinition<ParticleDissolveParams> = {
  effectId: "fx.particle.dissolve",
  toolName: "particle_dissolve",
  displayName: "粒子溶解",
  version: "1.0.0",
  category: "particle",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      progress: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      particleCount: { type: "integer", minimum: 100, maximum: 50000, default: 4000 },
      force: { type: "number", minimum: 0, maximum: 2000, default: 320 },
      direction: { type: "number", minimum: -180, maximum: 180, default: -35 },
      turbulence: { type: "number", minimum: 0, maximum: 1, default: 0.45 },
      lifetime: { type: "number", minimum: 0.05, maximum: 10, default: 1.4 },
      particleSize: { type: "number", minimum: 0.5, maximum: 40, default: 3 }
    }
  },
  defaults,
  presets: [
    { presetId: "dissolve.dust", displayName: "轻柔尘化", params: { ...defaults, particleCount: 6500, force: 90, turbulence: 0.25, lifetime: 2.8, particleSize: 1.5 } },
    { presetId: "dissolve.classic", displayName: "经典溶解", params: { ...defaults } },
    { presetId: "dissolve.blast", displayName: "爆裂消散", params: { ...defaults, particleCount: 2600, force: 950, turbulence: 0.8, lifetime: 0.7, particleSize: 6 } }
  ],
  inputSlots: [{ name: "target_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的被溶解目标图；不进入模型 data。" }],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "extreme",
  normalizeParams: (params) => ({ ...params, particleCount: Math.round(params.particleCount) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const target = rgbaInput(context, "target_image", true)!;
    const targetPixels = opaquePixelIndices(target);
    const direction = params.direction * Math.PI / 180;
    const active: number[] = [];
    for (let index = 0; index < params.particleCount; index += 1) {
      if (seededUnit(context.seed, index * 4) <= params.progress) active.push(index);
    }
    const buffer = createParticleBuffer(context, active.length, "disc", {
      sourceComposite: { slot: "target_image", opacity: 1 - params.progress }
    });
    const age = Math.min(context.time, params.lifetime);
    for (let outputIndex = 0; outputIndex < active.length; outputIndex += 1) {
      const particleIndex = active[outputIndex]!;
      const pixelIndex = targetPixels[Math.floor(seededUnit(context.seed, particleIndex * 4 + 1)
        * targetPixels.length)]!;
      const originX = pixelIndex % target.width;
      const originY = Math.floor(pixelIndex / target.width);
      const angle = direction + seededSigned(context.seed, particleIndex * 4 + 2)
        * params.turbulence * Math.PI;
      const speed = params.force * (0.65 + seededUnit(context.seed, particleIndex * 4 + 3) * 0.7);
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      setParticle(buffer, outputIndex, {
        x: originX + vx * age,
        y: originY + vy * age,
        vx,
        vy,
        size: params.particleSize,
        opacity: 1 - age / params.lifetime,
        color: pixelAtIndex(target, pixelIndex)
      });
    }
    return particleTextureResult(context, buffer);
  }
};
