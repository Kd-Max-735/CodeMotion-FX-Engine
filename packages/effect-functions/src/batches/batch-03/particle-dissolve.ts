import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { BATCH_03_GPU_BACKEND, CLOSED_SCHEMA, VALID_PARAMS, metadataResult, round, seededSigned, seededUnit } from "./shared.js";

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
  primaryBackend: BATCH_03_GPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "目标像素采样和粒子合成需要服务器 GPU。" },
  performanceGrade: "extreme",
  normalizeParams: (params) => ({ ...params, particleCount: Math.round(params.particleCount) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const direction = params.direction * Math.PI / 180;
    const samples = Array.from({ length: 6 }, (_, index) => {
      const activation = seededUnit(context.seed, index);
      const active = activation <= params.progress;
      const variance = seededSigned(context.seed, index + 100) * params.turbulence;
      return { active, activation: round(activation), vx: round(active ? Math.cos(direction + variance) * params.force : 0), vy: round(active ? Math.sin(direction + variance) * params.force : 0) };
    });
    return metadataResult(context, { algorithm: "target_pixel_threshold_dissolve", seed: context.seed, sourceOpacity: round(1 - params.progress), samples });
  }
};
