import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import {
  GPU_BACKEND,
  JSON_SCHEMA,
  assertExactKeys,
  clamp,
  isRecord,
  optionalSingleBinding,
  round,
  singleBinding,
  unitNumber
} from "./common.js";
import { parseMaterialSurface, type Rgba } from "./visual-inputs.js";

export interface HologramParams extends JsonObject {
  scanline: number;
  flicker: number;
  glitch: number;
  depth: number;
  brightness: number;
  opacity: number;
  colorMode: "cyan" | "green" | "magenta";
}

export interface HologramOutput {
  readonly materialModel: "emissive_hologram";
  readonly emissive: Rgba;
  readonly scanlineLevel: number;
  readonly flickerLevel: number;
  readonly glitchOffset: number;
  readonly depthParallax: number;
}

const COLORS: Readonly<Record<HologramParams["colorMode"], readonly [number, number, number]>> = Object.freeze({
  cyan: Object.freeze([0.12, 0.92, 1] as const),
  green: Object.freeze([0.2, 1, 0.48] as const),
  magenta: Object.freeze([1, 0.18, 0.86] as const)
});

function parseDepth(value: unknown): number {
  if (!isRecord(value)) throw new TypeError("depth sample binding must be an object.");
  assertExactKeys(value, ["version", "depth"], "depth sample binding");
  if (value.version !== "depth-sample-v1") throw new TypeError("depth sample version is unsupported.");
  return unitNumber(value.depth, "depth sample");
}

const defaults: HologramParams = Object.freeze({
  scanline: 0.65,
  flicker: 0.18,
  glitch: 0.12,
  depth: 0.4,
  brightness: 1.2,
  opacity: 0.72,
  colorMode: "cyan"
});

export const HOLOGRAM_DEFINITION: EffectToolDefinition<HologramParams, AuthorizedEffectInputs, HologramOutput> = {
  effectId: "fx.material.hologram",
  toolName: "hologram",
  displayName: "全息投影材质",
  version: "1.0.0",
  category: "material",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["scanline", "flicker", "glitch", "depth"],
    properties: {
      scanline: { type: "number", minimum: 0, maximum: 1, default: 0.65 },
      flicker: { type: "number", minimum: 0, maximum: 1, default: 0.18 },
      glitch: { type: "number", minimum: 0, maximum: 1, default: 0.12 },
      depth: { type: "number", minimum: 0, maximum: 1, default: 0.4 },
      brightness: { type: "number", minimum: 0, maximum: 3, default: 1.2 },
      opacity: { type: "number", minimum: 0, maximum: 1, default: 0.72 },
      colorMode: { type: "string", enum: ["cyan", "green", "magenta"], default: "cyan" }
    }
  },
  defaults,
  presets: [
    { presetId: "hologram.clean", displayName: "清晰全息", params: { scanline: 0.42, flicker: 0.08, glitch: 0.04, depth: 0.32, brightness: 1.1, opacity: 0.78, colorMode: "cyan" } },
    { presetId: "hologram.unstable", displayName: "故障投影", params: { scanline: 0.78, flicker: 0.48, glitch: 0.62, depth: 0.55, brightness: 1.5, opacity: 0.66, colorMode: "magenta" } },
    { presetId: "hologram.deep", displayName: "深层扫描", params: { scanline: 0.86, flicker: 0.14, glitch: 0.16, depth: 0.9, brightness: 1.3, opacity: 0.74, colorMode: "green" } }
  ],
  inputSlots: [
    { name: "target_layer", kind: "data", required: true, cardinality: "one", description: "Server-resolved material surface." },
    { name: "depth_map", kind: "depth-map", required: false, cardinality: "one", description: "Optional server-authorized depth sample for parallax." }
  ],
  primaryBackend: GPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Emissive scanlines, glitches, and depth parallax require the server GPU material path." },
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ scanline: round(params.scanline), flicker: round(params.flicker), glitch: round(params.glitch), depth: round(params.depth), brightness: round(params.brightness), opacity: round(params.opacity), colorMode: params.colorMode }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const surface = parseMaterialSurface(singleBinding(context, "target_layer"));
    const depthValue = optionalSingleBinding(context, "depth_map");
    const sampledDepth = depthValue === undefined ? surface.facing : parseDepth(depthValue);
    const phase = context.time * 37.1 + context.seed * 0.017;
    const flickerLevel = clamp(1 - params.flicker * (0.5 + 0.5 * Math.sin(phase * 2.17)));
    const scanlineLevel = clamp(1 - params.scanline * (0.5 + 0.5 * Math.sin((context.frame + sampledDepth * 41) * 0.73)));
    const glitchGate = Math.sin(phase * 9.13) > 1 - params.glitch * 2;
    const glitchOffset = glitchGate ? params.glitch * Math.sin(phase * 23.7) : 0;
    const color = COLORS[params.colorMode];
    const energy = clamp(surface.luminance * params.brightness * flickerLevel * scanlineLevel, 0, 3);
    const emissive = Object.freeze([
      round(clamp(color[0] * energy, 0, 1)),
      round(clamp(color[1] * energy, 0, 1)),
      round(clamp(color[2] * energy, 0, 1)),
      round(params.opacity)
    ]) as Rgba;
    return {
      kind: "texture",
      backendId: GPU_BACKEND.backendId,
      output: Object.freeze({
        materialModel: "emissive_hologram",
        emissive,
        scanlineLevel: round(scanlineLevel),
        flickerLevel: round(flickerLevel),
        glitchOffset: round(glitchOffset),
        depthParallax: round((sampledDepth - 0.5) * params.depth)
      }),
      degraded: false,
      warnings: depthValue === undefined ? ["No depth map bound; using surface facing for parallax."] : []
    };
  }
};
