import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import { GPU_BACKEND, JSON_SCHEMA, round, singleBinding } from "./common.js";

export interface TextureOverlayParams extends JsonObject {
  target: string;
  blendMode: "normal" | "multiply" | "screen" | "overlay" | "soft_light";
  opacity: number;
  scale: number;
  motion: number;
  motionAngle: number;
  premultipliedAlpha: boolean;
}

export interface TextureOverlayOutput {
  readonly uvOffset: readonly [number, number];
  readonly uvScale: readonly [number, number];
  readonly textureSize: readonly [number, number];
  readonly blendMode: TextureOverlayParams["blendMode"];
  readonly opacity: number;
  readonly premultipliedAlpha: boolean;
}

const defaults: TextureOverlayParams = Object.freeze({
  target: "main subject",
  blendMode: "overlay",
  opacity: 0.45,
  scale: 1,
  motion: 0,
  motionAngle: 0,
  premultipliedAlpha: true
});

export const TEXTURE_OVERLAY_DEFINITION: EffectToolDefinition<TextureOverlayParams, AuthorizedEffectInputs, TextureOverlayOutput> = {
  effectId: "fx.composite.textureOverlay",
  toolName: "texture_overlay",
  displayName: "纹理叠加",
  version: "2.0.0",
  category: "composite",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["target", "blendMode", "opacity"],
    properties: {
      target: { type: "string", minLength: 1, maxLength: 80, pattern: "^[\\p{L}\\p{N}][\\p{L}\\p{N} ,.'()/-]{0,79}$", default: "main subject" },
      blendMode: { type: "string", enum: ["normal", "multiply", "screen", "overlay", "soft_light"], default: "overlay" },
      opacity: { type: "number", minimum: 0, maximum: 1, default: 0.45 },
      scale: { type: "number", minimum: 0.05, maximum: 20, default: 1 },
      motion: { type: "number", minimum: -5, maximum: 5, default: 0 },
      motionAngle: { type: "number", minimum: -180, maximum: 180, default: 0 },
      premultipliedAlpha: { type: "boolean", default: true }
    }
  },
  defaults,
  presets: [
    { presetId: "texture-overlay.paper", displayName: "柔和纸纹", params: { ...defaults, blendMode: "soft_light", opacity: 0.28, scale: 1.4 } },
    { presetId: "texture-overlay.grain", displayName: "动态颗粒", params: { ...defaults, blendMode: "overlay", opacity: 0.42, scale: 0.8, motion: 0.12, motionAngle: 35 } },
    { presetId: "texture-overlay.ink", displayName: "浓重墨理", params: { ...defaults, blendMode: "multiply", opacity: 0.7, scale: 1.1 } }
  ],
  inputSlots: [
    { name: "base_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized decoded base image." },
    { name: "overlay_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized decoded texture image." },
    { name: "subject_mask", kind: "mask", required: true, cardinality: "one", description: "Server-derived SAM3.1 mask for the requested object in base_image." }
  ],
  primaryBackend: GPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Texture compositing requires the deterministic server GPU path." },
  performanceGrade: "medium",
  normalizeParams: (params) => ({ target: params.target.trim().toLowerCase(), blendMode: params.blendMode, opacity: round(params.opacity), scale: round(params.scale), motion: round(params.motion), motionAngle: round(params.motionAngle), premultipliedAlpha: params.premultipliedAlpha }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    singleBinding(context, "base_image");
    singleBinding(context, "overlay_image");
    singleBinding(context, "subject_mask");
    const radians = params.motionAngle * Math.PI / 180;
    const distance = params.motion === 0
      ? 0
      : (context.time % (params.scale / Math.abs(params.motion))) * params.motion / params.scale;
    const uvScale = round(1 / params.scale);
    return {
      kind: "texture",
      backendId: GPU_BACKEND.backendId,
      output: Object.freeze({
        uvOffset: Object.freeze([round(Math.cos(radians) * distance), round(Math.sin(radians) * distance)]) as readonly [number, number],
        uvScale: Object.freeze([uvScale, uvScale]) as readonly [number, number],
        textureSize: Object.freeze([context.width, context.height]) as readonly [number, number],
        blendMode: params.blendMode,
        opacity: params.opacity,
        premultipliedAlpha: params.premultipliedAlpha
      }),
      degraded: false,
      warnings: []
    };
  }
};
