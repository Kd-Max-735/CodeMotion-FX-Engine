import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition, ServerEffectRenderContext } from "../../types.js";
import { TRANSITION_BACKEND, effectProgress, round, valid, type MotionEasing } from "./helpers.js";

export interface PageTurnParams extends JsonObject {
  direction: "left" | "right";
  duration: number;
  curlRadius: number;
  perspective: number;
  shadowStrength: number;
  easing: MotionEasing;
}

export function renderPageTurn(context: ServerEffectRenderContext, params: Readonly<PageTurnParams>) {
  const progress = effectProgress(context, params.duration, params.easing);
  const sign = params.direction === "left" ? -1 : 1;
  return {
    kind: "metadata" as const,
    backendId: TRANSITION_BACKEND.backendId,
    output: {
      algorithm: "page-turn-mesh",
      progress,
      sourceWeights: { from: round(1 - progress), to: progress },
      sheet: {
        rotationYDegrees: round(sign * 180 * progress),
        curlDegrees: round(sign * Math.sin(Math.PI * progress) * 75),
        curlRadius: params.curlRadius,
        perspective: params.perspective,
        shadowOpacity: round(params.shadowStrength * Math.sin(Math.PI * progress))
      }
    },
    degraded: false,
    warnings: []
  };
}

export const PAGE_TURN_DEFINITION: EffectToolDefinition<PageTurnParams> = {
  effectId: "fx.transition.pageTurn",
  toolName: "page_turn",
  displayName: "翻页转场",
  version: "1.0.0",
  category: "transition",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      direction: { type: "string", enum: ["left", "right"], default: "left" },
      duration: { type: "number", minimum: 0.2, maximum: 5, default: 1 },
      curlRadius: { type: "number", minimum: 0.05, maximum: 1, default: 0.35 },
      perspective: { type: "number", minimum: 0, maximum: 1, default: 0.6 },
      shadowStrength: { type: "number", minimum: 0, maximum: 1, default: 0.45 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults: { direction: "left", duration: 1, curlRadius: 0.35, perspective: 0.6, shadowStrength: 0.45, easing: "ease_in_out" },
  presets: [
    { presetId: "page_turn.gentle", displayName: "柔和翻页", params: { direction: "left", duration: 1.4, curlRadius: 0.5, perspective: 0.45, shadowStrength: 0.3, easing: "ease_in_out" } },
    { presetId: "page_turn.crisp", displayName: "利落翻页", params: { direction: "right", duration: 0.65, curlRadius: 0.18, perspective: 0.75, shadowStrength: 0.6, easing: "ease_out" } },
    { presetId: "page_turn.dramatic", displayName: "戏剧翻页", params: { direction: "left", duration: 1.8, curlRadius: 0.25, perspective: 0.9, shadowStrength: 0.8, easing: "ease_in" } }
  ],
  inputSlots: [
    { name: "from_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized outgoing video." },
    { name: "to_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized incoming video." }
  ],
  primaryBackend: TRANSITION_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Page curl geometry requires the declared server GPU backend." },
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, duration: round(params.duration), curlRadius: round(params.curlRadius), perspective: round(params.perspective), shadowStrength: round(params.shadowStrength) }),
  validateParams: valid,
  render: renderPageTurn
};
