import type { JsonObject } from "@codemotion/core";
import { CPU_BACKEND, REJECT_FALLBACK, SOURCE_FRAME_SLOT, VALID_PARAMS, byte, clamp, frameInput, frameResult, hsvToRgb, pixelAt, round, type Batch02Definition } from "./common.js";

export interface AuraFieldParams extends JsonObject {
  intensity: number; centerX: number; centerY: number; radius: number; softness: number;
  ellipticity: number; hue: number; secondaryHue: number; pulseRate: number;
}

const defaults: AuraFieldParams = { intensity: 0.55, centerX: 0.5, centerY: 0.5, radius: 0.42, softness: 0.55, ellipticity: 1, hue: 285, secondaryHue: 190, pulseRate: 0.2 };

export const AURA_FIELD_DEFINITION: Batch02Definition<AuraFieldParams> = {
  effectId: "fx.light.auraField", toolName: "aura_field", displayName: "氛围光场", version: "1.0.0", category: "light",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, required: ["intensity"],
    properties: {
      intensity: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.55 },
      centerX: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.5 },
      centerY: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.5 },
      radius: { type: "number", minimum: 0.05, maximum: 1.5, multipleOf: 0.01, default: 0.42 },
      softness: { type: "number", minimum: 0.05, maximum: 1, multipleOf: 0.01, default: 0.55 },
      ellipticity: { type: "number", minimum: 0.25, maximum: 4, multipleOf: 0.01, default: 1 },
      hue: { type: "integer", minimum: 0, maximum: 360, default: 285 },
      secondaryHue: { type: "integer", minimum: 0, maximum: 360, default: 190 },
      pulseRate: { type: "number", minimum: 0, maximum: 4, multipleOf: 0.01, default: 0.2 }
    }
  }, defaults,
  presets: [
    { presetId: "aura-field.portrait", displayName: "人像柔光", params: { ...defaults, intensity: 0.35, radius: 0.55, softness: 0.8, hue: 32, secondaryHue: 315 } },
    { presetId: "aura-field.neon", displayName: "霓虹光环", params: { ...defaults, intensity: 0.82, radius: 0.3, softness: 0.25, hue: 300, secondaryHue: 185, pulseRate: 1.1 } },
    { presetId: "aura-field.wide", displayName: "宽幅环境光", params: { ...defaults, centerY: 0.65, radius: 0.75, ellipticity: 2.2, intensity: 0.48 } }
  ],
  inputSlots: [SOURCE_FRAME_SLOT], primaryBackend: CPU_BACKEND, fallbackStrategy: REJECT_FALLBACK, performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, intensity: round(params.intensity), centerX: round(params.centerX), centerY: round(params.centerY), radius: round(params.radius), softness: round(params.softness), ellipticity: round(params.ellipticity), hue: Math.round(params.hue), secondaryHue: Math.round(params.secondaryHue), pulseRate: round(params.pulseRate) }),
  validateParams: () => VALID_PARAMS,
  render(context, params) {
    const frame = frameInput(context); const output: number[] = [];
    const pulse = params.pulseRate === 0 ? 1 : 0.82 + 0.18 * Math.sin(context.time * params.pulseRate * Math.PI * 2);
    for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
      const nx = x / Math.max(1, frame.width - 1) - params.centerX;
      const ny = (y / Math.max(1, frame.height - 1) - params.centerY) * params.ellipticity;
      const distance = Math.sqrt(nx * nx + ny * ny);
      const normalized = distance / params.radius;
      const field = Math.exp(-Math.pow(normalized / params.softness, 2));
      const ring = Math.exp(-Math.pow((normalized - 0.72) / Math.max(0.08, params.softness * 0.45), 2));
      const angle = Math.atan2(ny, nx) / (Math.PI * 2) + 0.5;
      const hue = params.hue + (params.secondaryHue - params.hue) * clamp(angle);
      const color = hsvToRgb(hue, 0.62, clamp(0.55 + ring * 0.45));
      const amount = clamp((field * 0.65 + ring * 0.35) * params.intensity * pulse);
      const base = pixelAt(frame, x, y);
      output.push(byte(base[0]! + color[0]! * amount * 0.72), byte(base[1]! + color[1]! * amount * 0.72), byte(base[2]! + color[2]! * amount * 0.72), base[3]!);
    }
    return frameResult(AURA_FIELD_DEFINITION, frame, output);
  }
};
