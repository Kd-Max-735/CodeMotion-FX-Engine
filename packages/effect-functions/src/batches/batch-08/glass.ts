import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import { GPU_BACKEND, JSON_SCHEMA, clamp, round, singleBinding } from "./common.js";
import { parseMaterialSurface, parsePixelLayer, type Rgba } from "./visual-inputs.js";

export interface GlassParams extends JsonObject {
  blur: number;
  refraction: number;
  tintColor: string;
  tintStrength: number;
  border: number;
  opacity: number;
}

export interface GlassOutput {
  readonly materialModel: "dielectric_transmission";
  readonly rgba: Rgba;
  readonly tintRgb: readonly [number, number, number];
  readonly blurSigma: number;
  readonly indexOfRefraction: number;
  readonly borderHighlight: number;
  readonly transmission: number;
}

const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/u;

function normalizeColor(value: string): string {
  return value.toUpperCase();
}

function colorToRgb(value: string): readonly [number, number, number] {
  return Object.freeze([
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255
  ] as const);
}

const defaults: GlassParams = Object.freeze({
  blur: 12,
  refraction: 0.35,
  tintColor: "#FFFFFF",
  tintStrength: 0.18,
  border: 1.5,
  opacity: 0.72
});

export const GLASS_DEFINITION: EffectToolDefinition<GlassParams, AuthorizedEffectInputs, GlassOutput> = {
  effectId: "fx.material.glass",
  toolName: "glass",
  displayName: "玻璃材质",
  version: "1.2.0",
  category: "material",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["blur", "refraction", "tintColor"],
    properties: {
      blur: { type: "number", minimum: 0, maximum: 40, default: 12 },
      refraction: { type: "number", minimum: 0, maximum: 1, default: 0.35 },
      tintColor: { type: "string", pattern: COLOR_PATTERN.source, default: "#FFFFFF" },
      tintStrength: { type: "number", minimum: 0, maximum: 1, default: 0.18 },
      border: { type: "number", minimum: 0, maximum: 10, default: 1.5 },
      opacity: { type: "number", minimum: 0, maximum: 1, default: 0.72 }
    }
  },
  defaults,
  presets: [
    { presetId: "glass.clear", displayName: "清透玻璃", params: { blur: 7, refraction: 0.22, tintColor: "#FFFFFF", tintStrength: 0.06, border: 1, opacity: 0.55 } },
    { presetId: "glass.frosted", displayName: "蓝色磨砂玻璃", params: { blur: 24, refraction: 0.18, tintColor: "#8BCBFF", tintStrength: 0.32, border: 2, opacity: 0.78 } },
    { presetId: "glass.prism", displayName: "绿色棱镜玻璃", params: { blur: 4, refraction: 0.72, tintColor: "#ADFFDB", tintStrength: 0.3, border: 3.5, opacity: 0.68 } }
  ],
  inputSlots: [
    { name: "source_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized image or video viewed through the glass material." },
    { name: "target_layer", kind: "data", required: true, cardinality: "one", description: "Server-resolved material surface." },
    { name: "backdrop_layer", kind: "data", required: true, cardinality: "one", description: "Server-resolved backdrop sampled behind the glass." }
  ],
  primaryBackend: GPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Glass transmission and refraction require the server GPU material path." },
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ blur: round(params.blur), refraction: round(params.refraction),
    tintColor: normalizeColor(params.tintColor), tintStrength: round(params.tintStrength),
    border: round(params.border), opacity: round(params.opacity) }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const surface = parseMaterialSurface(singleBinding(context, "target_layer"));
    const backdrop = parsePixelLayer(singleBinding(context, "backdrop_layer"));
    if (!COLOR_PATTERN.test(params.tintColor)) throw new TypeError("tintColor must be a #RRGGBB color.");
    const tint = colorToRgb(params.tintColor);
    const fresnel = (1 - surface.facing) ** 5;
    const borderHighlight = clamp(params.border / 10 * 0.55 + fresnel * params.border / 3);
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
        tintRgb: tint,
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
