import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_GPU_BACKEND, frameResult, round, timedProgress, valid, type Easing } from "./common.js";

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
    { name: "source_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized source image." },
    { name: "source_depth", kind: "depth-map", required: true, cardinality: "one", description: "Server-authorized depth map aligned to the image." }
  ],
  primaryBackend: SERVER_GPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const progress = timedProgress(context.time, params.startTime, params.duration, params.easing);
    const centered = progress * 2 - 1;
    return frameResult(SERVER_GPU_BACKEND.backendId, {
      operation: "depth_displaced_mesh",
      colorSlot: "source_image",
      depthSlot: "source_depth",
      mesh: [params.meshDensity, Math.max(16, Math.round(params.meshDensity * context.height / context.width))],
      camera: {
        x: round(params.motionX * centered),
        y: round(params.motionY * centered),
        z: params.cameraDistance
      },
      displacement: params.depthScale,
      edgeExpansion: params.edgeExpansion
    });
  }
};
