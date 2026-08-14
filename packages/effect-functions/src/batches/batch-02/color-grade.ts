import type { JsonObject } from "@codemotion/core";
import { CPU_BACKEND, REJECT_FALLBACK, SOURCE_FRAME_SLOT, VALID_PARAMS, byte, clamp, frameInput, frameResult, luminance, pixelAt, round, type Batch02Definition } from "./common.js";

export interface ColorGradeParams extends JsonObject {
  exposure: number; contrast: number; saturation: number; temperature: number; tint: number;
  lift: number; gamma: number; gain: number; mix: number;
}
const defaults: ColorGradeParams = { exposure: 0, contrast: 1, saturation: 1, temperature: 0, tint: 0, lift: 0, gamma: 1, gain: 1, mix: 1 };

export const COLOR_GRADE_DEFINITION: Batch02Definition<ColorGradeParams> = {
  effectId: "fx.post.colorGrade", toolName: "color_grade", displayName: "色彩分级", version: "1.0.0", category: "post",
  parameterSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, required: ["exposure"], properties: {
    exposure: { type: "number", minimum: -3, maximum: 3, multipleOf: 0.01, default: 0 }, contrast: { type: "number", minimum: 0.5, maximum: 2, multipleOf: 0.01, default: 1 },
    saturation: { type: "number", minimum: 0, maximum: 2, multipleOf: 0.01, default: 1 }, temperature: { type: "number", minimum: -1, maximum: 1, multipleOf: 0.01, default: 0 },
    tint: { type: "number", minimum: -1, maximum: 1, multipleOf: 0.01, default: 0 }, lift: { type: "number", minimum: -0.25, maximum: 0.25, multipleOf: 0.01, default: 0 },
    gamma: { type: "number", minimum: 0.2, maximum: 3, multipleOf: 0.01, default: 1 }, gain: { type: "number", minimum: 0.5, maximum: 2, multipleOf: 0.01, default: 1 },
    mix: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 1 }
  } }, defaults,
  presets: [
    { presetId: "color-grade.cinematic", displayName: "电影冷暖", params: { ...defaults, contrast: 1.2, saturation: 0.92, temperature: -0.12, tint: 0.08, lift: -0.03, gamma: 0.92, gain: 1.08 } },
    { presetId: "color-grade.warm", displayName: "暖阳", params: { ...defaults, exposure: 0.18, contrast: 1.08, saturation: 1.1, temperature: 0.3, tint: 0.04, gain: 1.06 } },
    { presetId: "color-grade.faded", displayName: "褪色胶片", params: { ...defaults, contrast: 0.82, saturation: 0.72, lift: 0.08, gamma: 1.1, gain: 0.9 } }
  ],
  inputSlots: [SOURCE_FRAME_SLOT], primaryBackend: CPU_BACKEND, fallbackStrategy: REJECT_FALLBACK, performanceGrade: "medium",
  normalizeParams: (params) => ({ exposure: round(params.exposure), contrast: round(params.contrast), saturation: round(params.saturation), temperature: round(params.temperature), tint: round(params.tint), lift: round(params.lift), gamma: round(params.gamma), gain: round(params.gain), mix: round(params.mix) }), validateParams: () => VALID_PARAMS,
  render(context, params) {
    const frame = frameInput(context); const output: number[] = []; const exposure = 2 ** params.exposure;
    for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
      const base = pixelAt(frame, x, y); const neutral = luminance(base); const graded: number[] = [];
      const temperatureShift = [params.temperature * 0.12, 0, -params.temperature * 0.12];
      const tintShift = [params.tint * 0.03, -params.tint * 0.08, params.tint * 0.03];
      for (let channel = 0; channel < 3; channel += 1) {
        let value = base[channel]! / 255;
        value = neutral + (value - neutral) * params.saturation;
        value = (value + temperatureShift[channel]! + tintShift[channel]!) * exposure;
        value = (value - 0.5) * params.contrast + 0.5;
        value = clamp(value + params.lift);
        value = Math.pow(value, 1 / params.gamma) * params.gain;
        graded[channel] = clamp(value) * 255;
      }
      output.push(byte(base[0]! + (graded[0]! - base[0]!) * params.mix), byte(base[1]! + (graded[1]! - base[1]!) * params.mix), byte(base[2]! + (graded[2]! - base[2]!) * params.mix), base[3]!);
    }
    return frameResult(COLOR_GRADE_DEFINITION, frame, output);
  }
};
