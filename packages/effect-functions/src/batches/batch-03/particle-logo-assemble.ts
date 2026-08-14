import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { BATCH_03_GPU_BACKEND, CLOSED_SCHEMA, VALID_PARAMS, metadataResult, round, seededSigned, seededUnit } from "./shared.js";

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
  primaryBackend: BATCH_03_GPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Logo 轮廓采样和大规模吸引场没有等价 CPU 降级。" },
  performanceGrade: "extreme",
  normalizeParams: (params) => ({ ...params, particleCount: Math.round(params.particleCount) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const progress = Math.min(1, Math.max(0, context.time / params.duration));
    const samples = Array.from({ length: 6 }, (_, index) => ({
      targetSample: round(seededUnit(context.seed, index * 2)),
      radialOffset: round(seededSigned(context.seed, index * 2 + 1) * params.scatterRadius * (1 - progress)),
      swirlRadians: round(params.swirl * (1 - progress) * Math.PI * 2)
    }));
    return metadataResult(context, { algorithm: "authorized_alpha_target_attraction", seed: context.seed, progress: round(progress), targetSampling: "logo_image_alpha", samples });
  }
};
