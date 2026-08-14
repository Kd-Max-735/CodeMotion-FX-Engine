import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition, ServerEffectRenderContext } from "../../types.js";
import { TRANSITION_BACKEND, effectProgress, invalid, mix, round, valid, type MotionEasing } from "./helpers.js";

export interface PortalParams extends JsonObject {
  duration: number;
  innerRadius: number;
  outerRadius: number;
  swirlTurns: number;
  edgeSoftness: number;
  glowStrength: number;
  easing: MotionEasing;
}

export function renderPortal(context: ServerEffectRenderContext, params: Readonly<PortalParams>) {
  const progress = effectProgress(context, params.duration, params.easing);
  const radius = mix(params.innerRadius, params.outerRadius, progress);
  return {
    kind: "metadata" as const,
    backendId: TRANSITION_BACKEND.backendId,
    output: {
      algorithm: "radial-portal-wipe",
      progress,
      aperture: {
        radius: round(radius),
        featherWidth: round(params.edgeSoftness * Math.max(radius, 0.001)),
        rotationDegrees: round(params.swirlTurns * 360 * progress),
        glowStrength: params.glowStrength
      },
      composite: { inside: "to_video", outside: "from_video" }
    },
    degraded: false,
    warnings: []
  };
}

export const PORTAL_DEFINITION: EffectToolDefinition<PortalParams> = {
  effectId: "fx.transition.portal",
  toolName: "portal",
  displayName: "传送门转场",
  version: "1.0.0",
  category: "transition",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      duration: { type: "number", minimum: 0.2, maximum: 6, default: 1.2 },
      innerRadius: { type: "number", minimum: 0, maximum: 0.5, default: 0.06 },
      outerRadius: { type: "number", minimum: 0.2, maximum: 2, default: 1.05 },
      swirlTurns: { type: "number", minimum: -4, maximum: 4, default: 0.75 },
      edgeSoftness: { type: "number", minimum: 0, maximum: 0.5, default: 0.12 },
      glowStrength: { type: "number", minimum: 0, maximum: 1, default: 0.55 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults: { duration: 1.2, innerRadius: 0.06, outerRadius: 1.05, swirlTurns: 0.75, edgeSoftness: 0.12, glowStrength: 0.55, easing: "ease_in_out" },
  presets: [
    { presetId: "portal.clean", displayName: "干净开启", params: { duration: 1, innerRadius: 0.04, outerRadius: 1.1, swirlTurns: 0, edgeSoftness: 0.08, glowStrength: 0.25, easing: "ease_out" } },
    { presetId: "portal.vortex", displayName: "旋涡传送", params: { duration: 1.4, innerRadius: 0.05, outerRadius: 1.2, swirlTurns: 1.5, edgeSoftness: 0.14, glowStrength: 0.7, easing: "ease_in_out" } },
    { presetId: "portal.reverse", displayName: "反向旋转", params: { duration: 1.8, innerRadius: 0.1, outerRadius: 1, swirlTurns: -1, edgeSoftness: 0.22, glowStrength: 0.9, easing: "ease_in" } }
  ],
  inputSlots: [
    { name: "from_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized outgoing video." },
    { name: "to_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized incoming video." },
    { name: "portal_mask", kind: "mask", required: false, cardinality: "one", description: "Optional server-authorized aperture mask." }
  ],
  primaryBackend: TRANSITION_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Portal compositing requires the declared server GPU backend." },
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, duration: round(params.duration), innerRadius: round(params.innerRadius), outerRadius: round(params.outerRadius), swirlTurns: round(params.swirlTurns), edgeSoftness: round(params.edgeSoftness), glowStrength: round(params.glowStrength) }),
  validateParams: (params) => params.innerRadius < params.outerRadius ? valid() : invalid("$.innerRadius", "innerRadius must be smaller than outerRadius"),
  render: renderPortal
};
