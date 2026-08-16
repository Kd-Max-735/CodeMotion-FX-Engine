import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_THREE_BACKEND, blockedRender, valid, type Easing } from "./common.js";

type RevealDirection = "left_to_right" | "right_to_left" | "center_out";

export interface TextLogoRevealParams extends JsonObject {
  startTime: number;
  duration: number;
  segmentCount: number;
  stagger: number;
  extrusionDepth: number;
  travelDistance: number;
  rotationDegrees: number;
  direction: RevealDirection;
  easing: Easing;
}

const defaults: TextLogoRevealParams = {
  startTime: 0,
  duration: 1.8,
  segmentCount: 12,
  stagger: 0.45,
  extrusionDepth: 0.3,
  travelDistance: 1.2,
  rotationDegrees: 70,
  direction: "left_to_right",
  easing: "ease_out"
};

export const TEXT_LOGO_REVEAL_DEFINITION: EffectToolDefinition<TextLogoRevealParams> = {
  effectId: "fx.3d.textLogoReveal",
  toolName: "text_logo_reveal",
  displayName: "三维文字标志揭示",
  version: "1.0.0",
  category: "3d",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      startTime: { type: "number", minimum: 0, maximum: 3600, default: 0 },
      duration: { type: "number", exclusiveMinimum: 0, maximum: 30, default: 1.8 },
      segmentCount: { type: "integer", minimum: 2, maximum: 128, default: 12 },
      stagger: { type: "number", minimum: 0, maximum: 0.9, default: 0.45 },
      extrusionDepth: { type: "number", minimum: 0, maximum: 5, default: 0.3 },
      travelDistance: { type: "number", minimum: 0, maximum: 20, default: 1.2 },
      rotationDegrees: { type: "number", minimum: -360, maximum: 360, default: 70 },
      direction: { type: "string", enum: ["left_to_right", "right_to_left", "center_out"], default: "left_to_right" },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_out" }
    }
  },
  defaults,
  presets: [
    { presetId: "text_logo_reveal.clean", displayName: "干净推进", params: { ...defaults, extrusionDepth: 0.15, rotationDegrees: 25 } },
    { presetId: "text_logo_reveal.dimensional", displayName: "立体翻转", params: { ...defaults } },
    { presetId: "text_logo_reveal.center", displayName: "中心展开", params: { ...defaults, duration: 2.4, direction: "center_out", stagger: 0.65, travelDistance: 2 } }
  ],
  inputSlots: [
    { name: "logo_geometry", kind: "model", required: true, cardinality: "one", description: "Server-created text or logo geometry to reveal." },
    { name: "typeface", kind: "font", required: false, cardinality: "one", description: "Optional server-authorized font used while creating text geometry." }
  ],
  primaryBackend: SERVER_THREE_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: () => blockedRender(
    "text_logo_reveal",
    "an owner-authorized logo geometry/font and server-three frame renderer adapter"
  )
};
