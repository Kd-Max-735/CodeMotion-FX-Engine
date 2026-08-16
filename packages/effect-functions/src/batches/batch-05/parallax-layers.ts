import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition, ServerEffectRenderContext } from "../../types.js";
import { CAMERA_BACKEND, cameraOutput, effectProgress, frameOutput, hasInput, invalid, round, valid, type MotionEasing, type Vector3 } from "./helpers.js";

export interface ParallaxLayersParams extends JsonObject {
  travelX: number;
  travelY: number;
  travelZ: number;
  depthStrength: number;
  nearDepth: number;
  farDepth: number;
  layerCount: number;
  duration: number;
  easing: MotionEasing;
}

export function renderParallaxLayers(context: ServerEffectRenderContext, params: Readonly<ParallaxLayersParams>) {
  const progress = effectProgress(context, params.duration, params.easing);
  const position: Vector3 = {
    x: round(params.travelX * progress),
    y: round(params.travelY * progress),
    z: round(params.travelZ * progress)
  };
  const rotation: Vector3 = { x: 0, y: 0, z: 0 };
  const layers = Array.from({ length: params.layerCount }, (_, index) => {
    const normalizedDepth = params.layerCount === 1 ? 0 : index / (params.layerCount - 1);
    const depth = params.nearDepth + (params.farDepth - params.nearDepth) * normalizedDepth;
    const disparity = params.depthStrength * (1 - normalizedDepth);
    return {
      index,
      depth: round(depth),
      offsetX: round(-position.x * disparity),
      offsetY: round(-position.y * disparity),
      scale: round(1 + position.z * disparity * 0.01)
    };
  });
  return frameOutput(context, "depth_map_parallax_layers", {
    sourceSlot: "source_video",
    depthSlot: "depth_map",
    targetSlot: hasInput(context, "camera_target") ? "camera_target" : null,
    ...cameraOutput("depth-map-parallax-layers", position, rotation, 50, progress),
    depthBindingMode: "server-depth-map",
    layers
  });
}

export const PARALLAX_LAYERS_DEFINITION: EffectToolDefinition<ParallaxLayersParams> = {
  effectId: "fx.3d.parallaxLayers",
  toolName: "parallax_layers",
  displayName: "景深分层视差",
  version: "1.0.0",
  category: "3d",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      travelX: { type: "number", minimum: -20, maximum: 20, default: 1.5 },
      travelY: { type: "number", minimum: -20, maximum: 20, default: 0 },
      travelZ: { type: "number", minimum: -50, maximum: 50, default: 2 },
      depthStrength: { type: "number", minimum: 0, maximum: 2, default: 0.65 },
      nearDepth: { type: "number", minimum: 0, maximum: 0.9, default: 0.1 },
      farDepth: { type: "number", minimum: 0.1, maximum: 1, default: 0.9 },
      layerCount: { type: "integer", minimum: 2, maximum: 32, default: 8 },
      duration: { type: "number", minimum: 0.5, maximum: 30, default: 4 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults: { travelX: 1.5, travelY: 0, travelZ: 2, depthStrength: 0.65, nearDepth: 0.1, farDepth: 0.9, layerCount: 8, duration: 4, easing: "ease_in_out" },
  presets: [
    { presetId: "parallax_layers.subtle", displayName: "轻微视差", params: { travelX: 0.8, travelY: 0, travelZ: 1, depthStrength: 0.35, nearDepth: 0.1, farDepth: 0.9, layerCount: 6, duration: 5, easing: "ease_in_out" } },
    { presetId: "parallax_layers.push", displayName: "纵深推进", params: { travelX: 0, travelY: 0, travelZ: 8, depthStrength: 0.8, nearDepth: 0.05, farDepth: 1, layerCount: 12, duration: 4, easing: "ease_in" } },
    { presetId: "parallax_layers.diagonal", displayName: "斜向穿行", params: { travelX: -4, travelY: 2, travelZ: 4, depthStrength: 1.1, nearDepth: 0.08, farDepth: 0.95, layerCount: 16, duration: 6, easing: "ease_in_out" } }
  ],
  inputSlots: [
    { name: "source_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized source video." },
    { name: "depth_map", kind: "depth-map", required: true, cardinality: "one", description: "Server-authorized depth map used to construct spatial layers." },
    { name: "camera_target", kind: "data", required: false, cardinality: "one", description: "Optional server-authorized convergence target." }
  ],
  primaryBackend: CAMERA_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Depth-aware server-side spatial reconstruction is required." },
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, travelX: round(params.travelX), travelY: round(params.travelY), travelZ: round(params.travelZ), depthStrength: round(params.depthStrength), nearDepth: round(params.nearDepth), farDepth: round(params.farDepth), layerCount: Math.round(params.layerCount), duration: round(params.duration) }),
  validateParams: (params) => params.nearDepth < params.farDepth ? valid() : invalid("$.nearDepth", "nearDepth must be smaller than farDepth"),
  render: renderParallaxLayers
};
