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
  version: "2.0.0",
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
    const sample = (x: number, y: number) => {
      if (x < 0 || x > context.width - 1 || y < 0 || y > context.height - 1) return [0, 0, 0, 0] as const;
      const sx = Math.max(0, Math.min(source.width - 1, Math.round(x / Math.max(1, context.width - 1) * (source.width - 1))));
      const sy = Math.max(0, Math.min(source.height - 1, Math.round(y / Math.max(1, context.height - 1) * (source.height - 1))));
      const offset = (sy * source.width + sx) * 4;
      return [source.data[offset]!, source.data[offset + 1]!, source.data[offset + 2]!, source.data[offset + 3]!] as const;
    };
    const composite = (x: number, y: number, rgba: readonly [number, number, number, number], opacity = 1) => {
      if (x < 0 || x >= context.width || y < 0 || y >= context.height) return;
      const offset = (y * context.width + x) * 4;
      const alpha = rgba[3] / 255 * opacity;
      if (alpha <= 0) return;
      const previousAlpha = output[offset + 3]! / 255;
      const combined = alpha + previousAlpha * (1 - alpha);
      for (let channel = 0; channel < 3; channel += 1) {
        output[offset + channel] = Math.round((rgba[channel]! * alpha
          + output[offset + channel]! * previousAlpha * (1 - alpha)) / combined);
      }
      output[offset + 3] = Math.round(combined * 255);
    };
    if (progress >= 0.999_999) {
      for (let y = 0; y < context.height; y += 1) for (let x = 0; x < context.width; x += 1) {
        composite(x, y, sample(x, y));
      }
      return rgbaPixels(SERVER_THREE_BACKEND.backendId, context.width, context.height, output,
        "source_image", context.time);
    }
    const segments = Math.max(2, params.segmentCount);
    for (let segment = 0; segment < segments; segment += 1) {
      const order = params.direction === "right_to_left" ? segments - 1 - segment
        : params.direction === "center_out" ? Math.abs(segment - (segments - 1) / 2) * 2 : segment;
      const local = Math.max(0, Math.min(1, (progress - order / segments * params.stagger) / Math.max(0.1, 1 - params.stagger)));
      if (local <= 0) continue;
      const left = Math.floor(segment / segments * context.width);
      const right = Math.max(left + 1, Math.floor((segment + 1) / segments * context.width));
      const segmentCenter = (left + right - 1) / 2;
      const angle = params.rotationDegrees * Math.PI / 180 * (1 - local);
      const cosine = Math.cos(angle);
      const widthScale = Math.max(0.055, Math.abs(cosine));
      const halfWidth = Math.max(0.5, (right - left) * widthScale / 2);
      const visibleLeft = Math.max(0, Math.floor(segmentCenter - halfWidth));
      const visibleRight = Math.min(context.width - 1, Math.ceil(segmentCenter + halfWidth));
      const alternating = segment % 2 === 0 ? -1 : 1;
      const travelY = (1 - local) * params.travelDistance * context.height * 0.12 * alternating;
      const depthPixels = Math.min(24, Math.round(params.extrusionDepth * Math.min(context.width, context.height) * 0.045));
      for (let depth = depthPixels; depth >= 1; depth -= 1) {
        const depthRatio = depth / Math.max(1, depthPixels);
        const depthX = Math.round(depth * (cosine < 0 ? -1 : 1));
        const depthY = Math.round(depth * 0.42);
        for (let y = 0; y < context.height; y += 1) for (let x = visibleLeft; x <= visibleRight; x += 1) {
          const localX = (x - segmentCenter) / widthScale + segmentCenter;
          const sourceX = cosine < 0 ? right - 1 - (localX - left) : localX;
          if (sourceX < left || sourceX >= right) continue;
          const rgba = sample(sourceX, y - travelY);
          composite(x + depthX, Math.round(y + depthY), [
            Math.round(rgba[0] * (0.18 + 0.22 * (1 - depthRatio))),
            Math.round(rgba[1] * (0.2 + 0.24 * (1 - depthRatio))),
            Math.round(rgba[2] * (0.24 + 0.28 * (1 - depthRatio))),
            rgba[3]
          ], 0.72);
        }
      }
      const faceShade = 0.62 + 0.38 * Math.abs(cosine);
      for (let y = 0; y < context.height; y += 1) for (let x = visibleLeft; x <= visibleRight; x += 1) {
        const localX = (x - segmentCenter) / widthScale + segmentCenter;
        const sourceX = cosine < 0 ? right - 1 - (localX - left) : localX;
        if (sourceX < left || sourceX >= right) continue;
        const rgba = sample(sourceX, y - travelY);
        composite(x, y, [
          Math.round(rgba[0] * faceShade),
          Math.round(rgba[1] * faceShade),
          Math.round(rgba[2] * Math.min(1.08, faceShade + 0.05)),
          rgba[3]
        ]);
      }
    }
    return rgbaPixels(SERVER_THREE_BACKEND.backendId, context.width, context.height, output,
      "source_image", context.time);
  }
};
