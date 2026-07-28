import type { EffectInstance } from "@codemotion/core";

export const LAB_PIPELINE_EFFECT_ID = "fx.lab.pipelineValidation" as const;
export const EFFECT_DRAG_MIME = "application/x-cmfx-effect" as const;

export function isLabPipelineEffect(effect: Pick<EffectInstance, "effectId">): boolean {
  return effect.effectId === LAB_PIPELINE_EFFECT_ID;
}
