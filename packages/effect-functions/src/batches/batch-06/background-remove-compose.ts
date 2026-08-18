import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_GPU_BACKEND, readRgba8Frame, readScalarPixels, rgbaPixels, valid } from "./common.js";

export interface BackgroundRemoveComposeParams extends JsonObject {
  edgeFeather: number;
  edgeContract: number;
  spillSuppression: number;
  lightWrap: number;
  backgroundScale: number;
  backgroundBlur: number;
}

const defaults: BackgroundRemoveComposeParams = {
  edgeFeather: 2,
  edgeContract: 0,
  spillSuppression: 0.6,
  lightWrap: 0.15,
  backgroundScale: 1,
  backgroundBlur: 0
};

export const BACKGROUND_REMOVE_COMPOSE_DEFINITION: EffectToolDefinition<BackgroundRemoveComposeParams> = {
  effectId: "fx.media.backgroundRemoveCompose",
  toolName: "background_remove_compose",
  displayName: "去背景合成",
  version: "1.0.0",
  category: "media",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      edgeFeather: { type: "number", minimum: 0, maximum: 32, default: 2 },
      edgeContract: { type: "number", minimum: -16, maximum: 16, default: 0 },
      spillSuppression: { type: "number", minimum: 0, maximum: 1, default: 0.6 },
      lightWrap: { type: "number", minimum: 0, maximum: 1, default: 0.15 },
      backgroundScale: { type: "number", minimum: 0.25, maximum: 4, default: 1 },
      backgroundBlur: { type: "number", minimum: 0, maximum: 64, default: 0 }
    }
  },
  defaults,
  presets: [
    { presetId: "background_remove_compose.clean", displayName: "干净替换", params: { ...defaults } },
    { presetId: "background_remove_compose.soft", displayName: "柔边融合", params: { ...defaults, edgeFeather: 5, lightWrap: 0.3, backgroundBlur: 4 } },
    { presetId: "background_remove_compose.tight", displayName: "紧致边缘", params: { ...defaults, edgeFeather: 1, edgeContract: 2, spillSuppression: 0.85 } }
  ],
  inputSlots: [
    { name: "foreground_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized foreground video.", acceptedMimeTypes: ["video/mp4", "video/webm"] },
    { name: "foreground_matte", kind: "mask", required: true, cardinality: "one", description: "Server-authorized matte aligned to the foreground." },
    { name: "background_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized replacement background.", acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/avif"] }
  ],
  primaryBackend: SERVER_GPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const foreground = readRgba8Frame(context, "foreground_video");
    const background = readRgba8Frame(context, "background_image");
    const matte = readScalarPixels(context, "foreground_matte", foreground.width, foreground.height);
    const output = new Uint8ClampedArray(context.width * context.height * 4);
    const feather = Math.max(1, params.edgeFeather);
    for (let y = 0; y < context.height; y += 1) {
      for (let x = 0; x < context.width; x += 1) {
        const sx = Math.min(foreground.width - 1, Math.floor(x / context.width * foreground.width));
        const sy = Math.min(foreground.height - 1, Math.floor(y / context.height * foreground.height));
        const si = (sy * foreground.width + sx) * 4;
        const backgroundX = Math.max(0, Math.min(background.width - 1, Math.round((0.5
          + (x / Math.max(1, context.width - 1) - 0.5) / params.backgroundScale) * (background.width - 1))));
        const backgroundY = Math.max(0, Math.min(background.height - 1, Math.round((0.5
          + (y / Math.max(1, context.height - 1) - 0.5) / params.backgroundScale) * (background.height - 1))));
        const blur = Math.min(8, Math.round(params.backgroundBlur));
        const backgroundColor = [0, 1, 2].map((channel) => {
          let total = 0; let count = 0;
          for (let by = -blur; by <= blur; by += Math.max(1, blur)) for (let bx = -blur; bx <= blur; bx += Math.max(1, blur)) {
            const sampleX = Math.max(0, Math.min(background.width - 1, backgroundX + bx));
            const sampleY = Math.max(0, Math.min(background.height - 1, backgroundY + by));
            total += background.data[(sampleY * background.width + sampleX) * 4 + channel]!;
            count += 1;
          }
          return total / count;
        });
        const mi = sy * foreground.width + sx;
        const alpha = Math.max(0, Math.min(1, matte[mi]! - params.edgeContract / 32));
        const edge = Math.min(1, alpha * feather / (feather + 1));
        const a = Math.max(0, Math.min(1, alpha * (0.72 + edge * 0.28)));
        const oi = (y * context.width + x) * 4;
        const spill = params.spillSuppression * (1 - a);
        const wrap = params.lightWrap * (1 - Math.abs(a * 2 - 1));
        output[oi] = Math.round(foreground.data[si]! * a + backgroundColor[0]! * (1 - a + wrap * a));
        output[oi + 1] = Math.round(foreground.data[si + 1]! * a + backgroundColor[1]! * (1 - a + wrap * a));
        output[oi + 2] = Math.round(foreground.data[si + 2]! * a * (1 - spill) + backgroundColor[2]! * (1 - a + wrap * a) + 10 * spill);
        output[oi + 3] = 255;
      }
    }
    return rgbaPixels(SERVER_GPU_BACKEND.backendId, context.width, context.height, output,
      "foreground_video", context.time);
  }
};
