import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_03_BACKEND,
  BATCH_03_REJECT_FALLBACK,
  CLOSED_SCHEMA,
  VALID_PARAMS,
  clamp,
  createParticleBuffer,
  opaquePixelIndices,
  particleTextureResult,
  pixelAtIndex,
  rgbaInput,
  seededUnit,
  setParticle
} from "./shared.js";

export interface ParticleLogoAssembleParams extends JsonObject {
  particleCount: number;
  duration: number;
  scatterRadius: number;
  swirl: number;
  attraction: number;
  damping: number;
  particleSize: number;
}

const defaults: ParticleLogoAssembleParams = { particleCount: 2200, duration: 2.4, scatterRadius: 0.8, swirl: 0.45, attraction: 0.72, damping: 0.8, particleSize: 3 };

export const PARTICLE_LOGO_ASSEMBLE_DEFINITION: EffectToolDefinition<ParticleLogoAssembleParams> = {
  effectId: "fx.particle.logoAssemble",
  toolName: "particle_logo_assemble",
  displayName: "粒子 Logo 聚合",
  version: "1.0.0",
  category: "particle",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      particleCount: { type: "integer", minimum: 100, maximum: 50000, default: 2200 },
      duration: { type: "number", minimum: 0.2, maximum: 15, default: 2.4 },
      scatterRadius: { type: "number", minimum: 0.05, maximum: 3, default: 0.8 },
      swirl: { type: "number", minimum: -3, maximum: 3, default: 0.45 },
      attraction: { type: "number", minimum: 0.05, maximum: 2, default: 0.72 },
      damping: { type: "number", minimum: 0, maximum: 1, default: 0.8 },
      particleSize: { type: "number", minimum: 0.5, maximum: 30, default: 3 }
    }
  },
  defaults,
  presets: [
    { presetId: "logo.soft", displayName: "柔和汇聚", params: { ...defaults, duration: 4, scatterRadius: 0.5, swirl: 0.18, attraction: 0.42, damping: 0.9 } },
    { presetId: "logo.classic", displayName: "经典聚合", params: { ...defaults } },
    { presetId: "logo.vortex", displayName: "旋涡聚合", params: { ...defaults, particleCount: 5200, duration: 1.6, scatterRadius: 1.5, swirl: 1.8, attraction: 1.25, damping: 0.62, particleSize: 2 } }
  ],
  inputSlots: [{ name: "logo_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的 Logo 目标图；模型参数中不包含其标识。" }],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "extreme",
  normalizeParams: (params) => ({ ...params, particleCount: Math.round(params.particleCount) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const logo = rgbaInput(context, "logo_image", true)!;
    const targets = opaquePixelIndices(logo);
    const progress = clamp(context.time / params.duration, 0, 1);
    const attracted = 1 - (1 - progress) ** (1 + params.attraction * 2);
    const settled = attracted * (0.6 + params.damping * 0.4) + progress * (0.4 - params.damping * 0.4);
    const buffer = createParticleBuffer(context, params.particleCount, "disc");
    const scatterPixels = params.scatterRadius * Math.min(context.width, context.height);
    for (let index = 0; index < params.particleCount; index += 1) {
      const targetIndex = targets[Math.floor(seededUnit(context.seed, index * 5) * targets.length)]!;
      const targetX = targetIndex % logo.width;
      const targetY = Math.floor(targetIndex / logo.width);
      const angle = seededUnit(context.seed, index * 5 + 1) * Math.PI * 2;
      const radius = Math.sqrt(seededUnit(context.seed, index * 5 + 2)) * scatterPixels;
      const swirlAngle = angle + params.swirl * settled * Math.PI * 2;
      const remaining = 1 - settled;
      const offsetX = Math.cos(swirlAngle) * radius * remaining;
      const offsetY = Math.sin(swirlAngle) * radius * remaining;
      const velocityScale = params.duration > 0 ? params.attraction / params.duration : 0;
      setParticle(buffer, index, {
        x: targetX + offsetX,
        y: targetY + offsetY,
        vx: -offsetX * velocityScale,
        vy: -offsetY * velocityScale,
        size: params.particleSize,
        opacity: clamp(0.25 + settled, 0, 1),
        color: pixelAtIndex(logo, targetIndex)
      });
    }
    return particleTextureResult(context, buffer);
  }
};
