import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_GPU_BACKEND, readRgba8Frames, rgbaPixels, valid } from "./common.js";

export interface PhotoStackParams extends JsonObject {
  visibleCount: number;
  revealInterval: number;
  spreadX: number;
  spreadY: number;
  maxRotation: number;
  depthGap: number;
  startTime: number;
}

const defaults: PhotoStackParams = {
  visibleCount: 6,
  revealInterval: 0.35,
  spreadX: 0.16,
  spreadY: 0.1,
  maxRotation: 8,
  depthGap: 0.02,
  startTime: 0
};

export const PHOTO_STACK_DEFINITION: EffectToolDefinition<PhotoStackParams> = {
  effectId: "fx.media.photoStack",
  toolName: "photo_stack",
  displayName: "照片叠放",
  version: "1.0.0",
  category: "media",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      visibleCount: { type: "integer", minimum: 2, maximum: 32, default: 6 },
      revealInterval: { type: "number", minimum: 0, maximum: 10, default: 0.35 },
      spreadX: { type: "number", minimum: 0, maximum: 1, default: 0.16 },
      spreadY: { type: "number", minimum: 0, maximum: 1, default: 0.1 },
      maxRotation: { type: "number", minimum: 0, maximum: 45, default: 8 },
      depthGap: { type: "number", minimum: 0, maximum: 1, default: 0.02 },
      startTime: { type: "number", minimum: 0, maximum: 3600, default: 0 }
    }
  },
  defaults,
  presets: [
    { presetId: "photo_stack.neat", displayName: "整齐相册", params: { ...defaults, spreadX: 0.05, spreadY: 0.04, maxRotation: 3 } },
    { presetId: "photo_stack.casual", displayName: "随手叠放", params: { ...defaults } },
    { presetId: "photo_stack.scattered", displayName: "散落桌面", params: { ...defaults, visibleCount: 10, spreadX: 0.35, spreadY: 0.25, maxRotation: 20, revealInterval: 0.18 } }
  ],
  inputSlots: [{ name: "source_images", kind: "image", required: true, cardinality: "many", description: "Ordered owner-authorized photos.", acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/avif"] }],
  primaryBackend: SERVER_GPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const sources = readRgba8Frames(context, "source_images");
    const visible = Math.max(1, Math.min(sources.length, params.visibleCount,
      params.revealInterval === 0 ? sources.length : Math.floor((context.time - params.startTime) / params.revealInterval) + 1));
    const output = new Uint8ClampedArray(context.width * context.height * 4);
    for (let offset = 0; offset < output.length; offset += 4) {
      output[offset] = 18; output[offset + 1] = 20; output[offset + 2] = 24; output[offset + 3] = 255;
    }
    for (let index = 0; index < visible; index += 1) {
      const source = sources[index]!;
      const scale = Math.max(0.55, 0.86 - (visible - 1 - index) * params.depthGap);
      const cardWidth = Math.floor(context.width * scale);
      const cardHeight = Math.floor(context.height * scale);
      const spreadIndex = index - (visible - 1) / 2;
      const left = Math.round((context.width - cardWidth) / 2 + spreadIndex * params.spreadX * context.width);
      const top = Math.round((context.height - cardHeight) / 2 + Math.sin(index * 2.17) * params.spreadY * context.height);
      const angle = Math.sin(index * 3.71 + 0.4) * params.maxRotation * Math.PI / 180;
      const cosine = Math.cos(angle); const sine = Math.sin(angle);
      for (let y = 0; y < cardHeight; y += 1) for (let x = 0; x < cardWidth; x += 1) {
        const localX = x - cardWidth / 2; const localY = y - cardHeight / 2;
        const tx = Math.round(left + cardWidth / 2 + localX * cosine - localY * sine);
        const ty = Math.round(top + cardHeight / 2 + localX * sine + localY * cosine);
        if (tx < 0 || ty < 0 || tx >= context.width || ty >= context.height) continue;
        const sx = Math.min(source.width - 1, Math.floor(x / cardWidth * source.width));
        const sy = Math.min(source.height - 1, Math.floor(y / cardHeight * source.height));
        const si = (sy * source.width + sx) * 4; const oi = (ty * context.width + tx) * 4;
        output[oi] = source.data[si]!; output[oi + 1] = source.data[si + 1]!; output[oi + 2] = source.data[si + 2]!; output[oi + 3] = 255;
      }
    }
    return rgbaPixels(SERVER_GPU_BACKEND.backendId, context.width, context.height, output,
      "source_images", context.time);
  }
};
