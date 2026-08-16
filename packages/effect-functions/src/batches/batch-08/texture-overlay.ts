import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import { GPU_BACKEND, JSON_SCHEMA, clamp, round, singleBinding } from "./common.js";
import { parsePixelLayer, parseTextureSample, type Rgba } from "./visual-inputs.js";

export interface TextureOverlayParams extends JsonObject {
  blendMode: "normal" | "multiply" | "screen" | "overlay" | "soft_light";
  opacity: number;
  scale: number;
  motion: number;
  motionAngle: number;
  premultipliedAlpha: boolean;
}

export interface TextureOverlayOutput {
  readonly rgba: Rgba;
  readonly uvOffset: readonly [number, number];
  readonly uvScale: readonly [number, number];
  readonly textureSize: readonly [number, number];
  readonly blendMode: TextureOverlayParams["blendMode"];
  readonly premultipliedAlpha: boolean;
}

function blendChannel(base: number, source: number, mode: TextureOverlayParams["blendMode"]): number {
  if (mode === "multiply") return base * source;
  if (mode === "screen") return base + source - base * source;
  if (mode === "overlay") return base <= 0.5 ? 2 * base * source : 1 - 2 * (1 - base) * (1 - source);
  if (mode === "soft_light") {
    return source <= 0.5
      ? base - (1 - 2 * source) * base * (1 - base)
      : base + (2 * source - 1) * (Math.sqrt(base) - base);
  }
  return source;
}

function composite(base: Rgba, texture: Rgba, params: TextureOverlayParams): Rgba {
  const sourceAlpha = clamp(texture[3] * params.opacity);
  const baseAlpha = base[3];
  const outputAlpha = sourceAlpha + baseAlpha * (1 - sourceAlpha);
  const premultiplied = ([0, 1, 2] as const).map((channel) => {
    const blended = blendChannel(base[channel], texture[channel], params.blendMode);
    return clamp(
      sourceAlpha * (1 - baseAlpha) * texture[channel]
      + sourceAlpha * baseAlpha * blended
      + (1 - sourceAlpha) * baseAlpha * base[channel]
    );
  });
  const rgb = params.premultipliedAlpha || outputAlpha === 0
    ? premultiplied
    : premultiplied.map((channel) => clamp(channel / outputAlpha));
  return Object.freeze([round(rgb[0]!), round(rgb[1]!), round(rgb[2]!), round(outputAlpha)]);
}

const defaults: TextureOverlayParams = Object.freeze({
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
  version: "1.0.0",
  category: "composite",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["blendMode", "opacity"],
    properties: {
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
    { presetId: "texture-overlay.paper", displayName: "柔和纸纹", params: { blendMode: "soft_light", opacity: 0.28, scale: 1.4, motion: 0, motionAngle: 0, premultipliedAlpha: true } },
    { presetId: "texture-overlay.grain", displayName: "动态颗粒", params: { blendMode: "overlay", opacity: 0.42, scale: 0.8, motion: 0.12, motionAngle: 35, premultipliedAlpha: true } },
    { presetId: "texture-overlay.ink", displayName: "浓重墨理", params: { blendMode: "multiply", opacity: 0.7, scale: 1.1, motion: 0, motionAngle: 0, premultipliedAlpha: true } }
  ],
  inputSlots: [
    { name: "base_layer", kind: "data", required: true, cardinality: "one", description: "Server-resolved base layer sample." },
    { name: "overlay_texture", kind: "texture", required: true, cardinality: "one", description: "Server-authorized overlay texture and decoded sample." }
  ],
  primaryBackend: GPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Texture compositing requires the deterministic server GPU path." },
  performanceGrade: "medium",
  normalizeParams: (params) => ({ blendMode: params.blendMode, opacity: round(params.opacity), scale: round(params.scale), motion: round(params.motion), motionAngle: round(params.motionAngle), premultipliedAlpha: params.premultipliedAlpha }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const base = parsePixelLayer(singleBinding(context, "base_layer"));
    const texture = parseTextureSample(singleBinding(context, "overlay_texture"));
    const radians = params.motionAngle * Math.PI / 180;
    const distance = params.motion === 0
      ? 0
      : (context.time % (params.scale / Math.abs(params.motion))) * params.motion / params.scale;
    const uvScale = round(1 / params.scale);
    return {
      kind: "texture",
      backendId: GPU_BACKEND.backendId,
      output: Object.freeze({
        rgba: composite(base.sample, texture.sample, params),
        uvOffset: Object.freeze([round(Math.cos(radians) * distance), round(Math.sin(radians) * distance)]) as readonly [number, number],
        uvScale: Object.freeze([uvScale, uvScale]) as readonly [number, number],
        textureSize: Object.freeze([texture.width, texture.height]) as readonly [number, number],
        blendMode: params.blendMode,
        premultipliedAlpha: params.premultipliedAlpha
      }),
      degraded: false,
      warnings: []
    };
  }
};
