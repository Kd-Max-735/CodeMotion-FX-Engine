import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import { GPU_BACKEND, JSON_SCHEMA, clamp, round, singleBinding } from "./common.js";
import { parseMaterialSurface, parseTextureSample, type Rgba } from "./visual-inputs.js";

export interface MetalParams extends JsonObject {
  roughness: number;
  specular: number;
  brushed: number;
  anisotropy: number;
  tone: "silver" | "gold" | "copper" | "dark";
}

export interface MetalOutput {
  readonly materialModel: "conductive_pbr";
  readonly f0: Rgba;
  readonly roughness: number;
  readonly anisotropy: number;
  readonly brushFrequency: number;
  readonly reflectedLuminance: number;
}

const TONES: Readonly<Record<MetalParams["tone"], readonly [number, number, number]>> = Object.freeze({
  silver: Object.freeze([0.95, 0.93, 0.88] as const),
  gold: Object.freeze([1, 0.71, 0.29] as const),
  copper: Object.freeze([0.95, 0.45, 0.23] as const),
  dark: Object.freeze([0.24, 0.26, 0.28] as const)
});

const defaults: MetalParams = Object.freeze({
  roughness: 0.32,
  specular: 0.82,
  brushed: 0.45,
  anisotropy: 0.55,
  tone: "silver"
});

export const METAL_DEFINITION: EffectToolDefinition<MetalParams, AuthorizedEffectInputs, MetalOutput> = {
  effectId: "fx.material.metal",
  toolName: "metal",
  displayName: "金属材质",
  version: "1.0.0",
  category: "material",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["roughness", "specular", "tone"],
    properties: {
      roughness: { type: "number", minimum: 0.02, maximum: 1, default: 0.32 },
      specular: { type: "number", minimum: 0, maximum: 1, default: 0.82 },
      brushed: { type: "number", minimum: 0, maximum: 1, default: 0.45 },
      anisotropy: { type: "number", minimum: 0, maximum: 1, default: 0.55 },
      tone: { type: "string", enum: ["silver", "gold", "copper", "dark"], default: "silver" }
    }
  },
  defaults,
  presets: [
    { presetId: "metal.polished", displayName: "抛光银", params: { roughness: 0.08, specular: 0.96, brushed: 0.08, anisotropy: 0.12, tone: "silver" } },
    { presetId: "metal.brushed", displayName: "拉丝钢", params: { roughness: 0.4, specular: 0.78, brushed: 0.85, anisotropy: 0.9, tone: "silver" } },
    { presetId: "metal.gold", displayName: "暖金属", params: { roughness: 0.24, specular: 0.9, brushed: 0.32, anisotropy: 0.42, tone: "gold" } }
  ],
  inputSlots: [
    { name: "source_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized image receiving the metal material." },
    { name: "target_layer", kind: "data", required: true, cardinality: "one", description: "Server-resolved material surface." },
    { name: "environment_texture", kind: "texture", required: true, cardinality: "one", description: "Required server-authorized reflection environment." }
  ],
  primaryBackend: GPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Conductive PBR shading requires the server GPU material path." },
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ roughness: round(params.roughness), specular: round(params.specular), brushed: round(params.brushed), anisotropy: round(params.anisotropy), tone: params.tone }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const surface = parseMaterialSurface(singleBinding(context, "target_layer"));
    const environment = parseTextureSample(singleBinding(context, "environment_texture"));
    const tone = TONES[params.tone];
    const f0 = Object.freeze([
      round(tone[0] * params.specular * (0.75 + surface.baseColor[0] * 0.25)),
      round(tone[1] * params.specular * (0.75 + surface.baseColor[1] * 0.25)),
      round(tone[2] * params.specular * (0.75 + surface.baseColor[2] * 0.25)),
      1
    ]) as Rgba;
    const environmentLuminance = (environment.sample[0] + environment.sample[1]
      + environment.sample[2]) / 3;
    const fresnel = (1 - surface.facing) ** 5;
    const reflected = environmentLuminance
      * (params.specular + (1 - params.specular) * fresnel)
      * (0.75 + surface.luminance * 0.25);
    return {
      kind: "texture",
      backendId: GPU_BACKEND.backendId,
      output: Object.freeze({
        materialModel: "conductive_pbr",
        f0,
        roughness: params.roughness,
        anisotropy: round(params.anisotropy * params.brushed),
        brushFrequency: round(8 + params.brushed * 120),
        reflectedLuminance: round(clamp(reflected * params.specular * (1 - params.roughness * 0.55)))
      }),
      degraded: false,
      warnings: []
    };
  }
};
