import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_THREE_BACKEND, readRgba8Frame, rgbaPixels, timedProgress, valid, type Easing } from "./common.js";

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
    { name: "source_image", kind: "image", required: true, cardinality: "one", description: "Owner-authorized text or logo artwork rasterized by the server.", acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/avif"] }
  ],
  primaryBackend: SERVER_THREE_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const source = readRgba8Frame(context, "source_image");
    const progress = timedProgress(context.time, params.startTime, params.duration, params.easing);
    const output = new Uint8ClampedArray(context.width * context.height * 4);
    for (let offset = 0; offset < output.length; offset += 4) {
      output[offset] = 8; output[offset + 1] = 10; output[offset + 2] = 16; output[offset + 3] = 255;
    }
    const segments = Math.max(2, params.segmentCount);
    for (let segment = 0; segment < segments; segment += 1) {
      const order = params.direction === "right_to_left" ? segments - 1 - segment
        : params.direction === "center_out" ? Math.abs(segment - (segments - 1) / 2) * 2 : segment;
      const local = Math.max(0, Math.min(1, (progress - order / segments * params.stagger) / Math.max(0.1, 1 - params.stagger)));
      if (local <= 0) continue;
      const left = Math.floor(segment / segments * context.width);
      const right = Math.max(left + 1, Math.floor((segment + 1) / segments * context.width));
      const travel = (1 - local) * params.travelDistance * context.height * 0.12;
      const direction = segment % 2 === 0 ? -1 : 1;
      const rotationShade = Math.sin(params.rotationDegrees * Math.PI / 180 * (1 - local)) * 0.22;
      const shade = 0.7 + local * 0.3 + Math.sin(local * Math.PI) * params.extrusionDepth * 0.08 + rotationShade;
      for (let y = 0; y < context.height; y += 1) for (let x = left; x < right; x += 1) {
        const sy = Math.max(0, Math.min(source.height - 1, Math.round(y / context.height * source.height - travel * direction)));
        const sx = Math.min(source.width - 1, Math.floor(x / context.width * source.width));
        const si = (sy * source.width + sx) * 4; const oi = (y * context.width + x) * 4;
        output[oi] = Math.round(source.data[si]! * shade); output[oi + 1] = Math.round(source.data[si + 1]! * shade);
        output[oi + 2] = Math.round(source.data[si + 2]! * Math.min(1.2, shade + 0.08)); output[oi + 3] = 255;
      }
    }
    return rgbaPixels(SERVER_THREE_BACKEND.backendId, context.width, context.height, output,
      "source_image", context.time);
  }
};
