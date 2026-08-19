import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_GPU_BACKEND, readRgba8Frame, readScalarPixels, rgbaPixels, timedProgress, valid, type Easing } from "./common.js";

export interface ImageDepthParallaxParams extends JsonObject {
  startTime: number;
  duration: number;
  motionX: number;
  motionY: number;
  depthScale: number;
  cameraDistance: number;
  meshDensity: number;
  edgeExpansion: number;
  easing: Easing;
}

const defaults: ImageDepthParallaxParams = {
  startTime: 0,
  duration: 4,
  motionX: 0.12,
  motionY: -0.04,
  depthScale: 0.35,
  cameraDistance: 2.5,
  meshDensity: 96,
  edgeExpansion: 0.08,
  easing: "ease_in_out"
};

export const IMAGE_DEPTH_PARALLAX_DEFINITION: EffectToolDefinition<ImageDepthParallaxParams> = {
  effectId: "fx.media.imageDepthParallax",
  toolName: "image_depth_parallax",
  displayName: "图像深度视差",
  version: "1.0.0",
  category: "media",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      startTime: { type: "number", minimum: 0, maximum: 3600, default: 0 },
      duration: { type: "number", exclusiveMinimum: 0, maximum: 120, default: 4 },
      motionX: { type: "number", minimum: -1, maximum: 1, default: 0.12 },
      motionY: { type: "number", minimum: -1, maximum: 1, default: -0.04 },
      depthScale: { type: "number", minimum: 0, maximum: 2, default: 0.35 },
      cameraDistance: { type: "number", minimum: 0.5, maximum: 20, default: 2.5 },
      meshDensity: { type: "integer", minimum: 16, maximum: 256, default: 96 },
      edgeExpansion: { type: "number", minimum: 0, maximum: 0.5, default: 0.08 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults,
  presets: [
    { presetId: "image_depth_parallax.gentle", displayName: "轻柔景深", params: { ...defaults } },
    { presetId: "image_depth_parallax.dramatic", displayName: "强烈穿行", params: { ...defaults, duration: 3, motionX: 0.35, motionY: 0.12, depthScale: 0.8, edgeExpansion: 0.18 } },
    { presetId: "image_depth_parallax.vertical", displayName: "纵向漂移", params: { ...defaults, motionX: 0, motionY: -0.25, duration: 6 } }
  ],
  inputSlots: [
    { name: "source_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized source image.", acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/avif"] },
    { name: "source_depth", kind: "depth-map", required: true, cardinality: "one", description: "Server-authorized depth map aligned to the image." }
  ],
  primaryBackend: SERVER_GPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const source = readRgba8Frame(context, "source_image");
    const depth = readScalarPixels(context, "source_depth", source.width, source.height);
    const progress = timedProgress(context.time, params.startTime, params.duration, params.easing);
    const displacement = params.depthScale * (1 + params.edgeExpansion * 2) / Math.max(0.5, params.cameraDistance);
    const output = new Uint8ClampedArray(context.width * context.height * 4);
    for (let y = 0; y < context.height; y += 1) {
      for (let x = 0; x < context.width; x += 1) {
        const px = x / Math.max(1, context.width - 1);
        const py = y / Math.max(1, context.height - 1);
        const di = Math.min(depth.length - 1, Math.floor(py * (source.height - 1)) * source.width
          + Math.floor(px * (source.width - 1)));
        // Treat the depth map as a relative camera-distance field. Near pixels
        // travel more than far pixels, while a small far-layer motion remains
        // visible even when the map is mostly flat.
        const z = Math.max(0, Math.min(1, depth[di] ?? 0.5));
        const layerFactor = 0.22 + z ** 1.35 * 0.78;
        const sx = Math.max(0, Math.min(source.width - 1, Math.round(px * (source.width - 1)
          - params.motionX * progress * layerFactor * displacement * source.width)));
        const sy = Math.max(0, Math.min(source.height - 1, Math.round(py * (source.height - 1)
          - params.motionY * progress * layerFactor * displacement * source.height)));
        const si = (sy * source.width + sx) * 4;
        const oi = (y * context.width + x) * 4;
        output[oi] = source.data[si]!;
        output[oi + 1] = source.data[si + 1]!;
        output[oi + 2] = source.data[si + 2]!;
        output[oi + 3] = 255;
      }
    }
    return rgbaPixels(SERVER_GPU_BACKEND.backendId, context.width, context.height, output,
      "source_image", context.time);
  }
};
