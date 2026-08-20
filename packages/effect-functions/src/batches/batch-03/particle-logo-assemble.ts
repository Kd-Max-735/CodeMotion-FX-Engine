import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInput, EffectToolDefinition, ServerEffectRenderContext } from "../../types.js";
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
  target: string;
  particleCount: number;
  duration: number;
  scatterRadius: number;
  swirl: number;
  attraction: number;
  damping: number;
  particleSize: number;
}

const defaults: ParticleLogoAssembleParams = { target: "main subject", particleCount: 2200, duration: 2.4, scatterRadius: 0.8, swirl: 0.45, attraction: 0.72, damping: 0.8, particleSize: 3 };

function maskInput(context: ServerEffectRenderContext): Uint8Array | undefined {
  const binding = context.inputs.subject_mask;
  if (binding === undefined || Array.isArray(binding)) return undefined;
  const single = binding as AuthorizedEffectInput<unknown>;
  if (typeof single.binding !== "object" || single.binding === null) return undefined;
  const value = single.binding as Record<string, unknown>;
  return value.data instanceof Uint8Array || value.data instanceof Uint8ClampedArray ? new Uint8Array(value.data) : undefined;
}

export const PARTICLE_LOGO_ASSEMBLE_DEFINITION: EffectToolDefinition<ParticleLogoAssembleParams> = {
  effectId: "fx.particle.logoAssemble",
  toolName: "particle_logo_assemble",
  displayName: "粒子 Logo 聚合",
  version: "1.0.0",
  category: "particle",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      target: { type: "string", minLength: 1, maxLength: 80, pattern: "^[\\p{L}\\p{N}][\\p{L}\\p{N} ,.'()/-]{0,79}$", default: "main subject" },
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
  inputSlots: [
    { name: "logo_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的目标图。" },
    { name: "subject_mask", kind: "mask", required: true, cardinality: "one", description: "Server-derived SAM3 mask for the requested target." }
  ],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "extreme",
  normalizeParams: (params) => ({ ...params, target: params.target.trim().toLowerCase(), particleCount: Math.round(params.particleCount) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const logo = rgbaInput(context, "logo_image", true)!;
    const mask = maskInput(context);
    const allTargets = opaquePixelIndices(logo);
    const targets = mask === undefined ? allTargets : allTargets.filter((index) => (mask[index] ?? 0) >= 128);
    if (targets.length === 0) throw new RangeError("subject_mask does not contain visible target pixels.");
    const progress = clamp(context.time / params.duration, 0, 1);
    const visible = progress * progress * (3 - 2 * progress);
    const attracted = 1 - (1 - visible) ** (1 + params.attraction * 2);
    const settled = attracted * (0.6 + params.damping * 0.4) + progress * (0.4 - params.damping * 0.4);
    const buffer = createParticleBuffer(context, params.particleCount, "disc", {
      sourceComposite: progress >= 1
        ? { slot: "logo_image", opacity: 1 }
        : { slot: "logo_image", opacity: 1, ...(mask === undefined ? {} : { excludeMask: mask }) },
      glow: 0.55
    });
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
        opacity: progress >= 1 ? 0 : clamp(visible * (0.28 + settled * 0.72), 0, 1),
        color: pixelAtIndex(logo, targetIndex)
      });
    }
    return particleTextureResult(context, buffer);
  }
};
