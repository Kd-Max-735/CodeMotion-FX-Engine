import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import { GPU_BACKEND, JSON_SCHEMA, clamp, round, singleBinding } from "./common.js";
import { parseMaterialSurface, parsePixelLayer, type Rgba } from "./visual-inputs.js";

export interface GlassParams extends JsonObject {
  blur: number;
  refraction: number;
  tint: "clear" | "cool" | "warm" | "mint";
  tintStrength: number;
  border: number;
  opacity: number;
}

export interface GlassOutput {
  readonly materialModel: "dielectric_transmission";
  readonly rgba: Rgba;
  readonly blurSigma: number;
  readonly indexOfRefraction: number;
  readonly borderHighlight: number;
  readonly transmission: number;
}

const TINTS: Readonly<Record<GlassParams["tint"], readonly [number, number, number]>> = Object.freeze({
  clear: Object.freeze([1, 1, 1] as const),
  cool: Object.freeze([0.72, 0.88, 1] as const),
  warm: Object.freeze([1, 0.86, 0.68] as const),
  mint: Object.freeze([0.68, 1, 0.86] as const)
});

const defaults: GlassParams = Object.freeze({
  blur: 12,
  refraction: 0.35,
  tint: "clear",
  tintStrength: 0.18,
  border: 1.5,
  opacity: 0.72
});

export const GLASS_DEFINITION: EffectToolDefinition<GlassParams, AuthorizedEffectInputs, GlassOutput> = {
  effectId: "fx.material.glass",
  toolName: "glass",
  displayName: "玻璃材质",
  version: "1.0.0",
  category: "material",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["blur", "refraction", "tint"],
    properties: {
      blur: { type: "number", minimum: 0, maximum: 40, default: 12 },
      refraction: { type: "number", minimum: 0, maximum: 1, default: 0.35 },
      tint: { type: "string", enum: ["clear", "cool", "warm", "mint"], default: "clear" },
      tintStrength: { type: "number", minimum: 0, maximum: 1, default: 0.18 },
      border: { type: "number", minimum: 0, maximum: 10, default: 1.5 },
      opacity: { type: "number", minimum: 0, maximum: 1, default: 0.72 }
    }
  },
  defaults,
  presets: [
    { presetId: "glass.clear", displayName: "清透玻璃", params: { blur: 7, refraction: 0.22, tint: "clear", tintStrength: 0.06, border: 1, opacity: 0.55 } },
    { presetId: "glass.frosted", displayName: "磨砂玻璃", params: { blur: 24, refraction: 0.18, tint: "cool", tintStrength: 0.2, border: 2, opacity: 0.78 } },
    { presetId: "glass.prism", displayName: "棱镜玻璃", params: { blur: 4, refraction: 0.72, tint: "mint", tintStrength: 0.3, border: 3.5, opacity: 0.68 } }
  ],
  inputSlots: [
    { name: "source_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized image receiving the glass material." },
    { name: "target_layer", kind: "data", required: true, cardinality: "one", description: "Server-resolved material surface." },
    { name: "backdrop_layer", kind: "data", required: true, cardinality: "one", description: "Server-resolved backdrop sampled behind the glass." }
  ],
  primaryBackend: GPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Glass transmission and refraction require the server GPU material path." },
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ blur: round(params.blur), refraction: round(params.refraction), tint: params.tint, tintStrength: round(params.tintStrength), border: round(params.border), opacity: round(params.opacity) }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const surface = parseMaterialSurface(singleBinding(context, "target_layer"));
    const backdrop = parsePixelLayer(singleBinding(context, "backdrop_layer"));
    const tint = TINTS[params.tint];
    const fresnel = (1 - surface.facing) ** 5;
    const borderHighlight = clamp(fresnel * params.border / 3);
    const transmission = 1 - params.opacity;
    const rgba = Object.freeze([
      round(clamp(backdrop.sample[0] * (1 - params.tintStrength) + tint[0] * params.tintStrength + borderHighlight)),
      round(clamp(backdrop.sample[1] * (1 - params.tintStrength) + tint[1] * params.tintStrength + borderHighlight)),
      round(clamp(backdrop.sample[2] * (1 - params.tintStrength) + tint[2] * params.tintStrength + borderHighlight)),
      round(params.opacity)
    ]) as Rgba;
    return {
      kind: "texture",
      backendId: GPU_BACKEND.backendId,
      output: Object.freeze({
        materialModel: "dielectric_transmission",
        rgba,
        blurSigma: round(params.blur / 3),
        indexOfRefraction: round(1 + params.refraction * 0.7),
        borderHighlight: round(borderHighlight),
        transmission: round(transmission)
      }),
      degraded: false,
      warnings: []
    };
  }
};
