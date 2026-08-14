import type { JsonObject } from "@codemotion/core";
import { CPU_BACKEND, REJECT_FALLBACK, SOURCE_FRAME_SLOT, VALID_PARAMS, byte, clamp, frameInput, frameResult, pixelAt, round, sampleBilinear, type Batch02Definition } from "./common.js";

export interface ChromaticAberrationParams extends JsonObject { amount: number; radial: number; angle: number; falloff: number; mix: number; }
const defaults: ChromaticAberrationParams = { amount: 4, radial: 0.7, angle: 0, falloff: 1, mix: 0.8 };

export const CHROMATIC_ABERRATION_DEFINITION: Batch02Definition<ChromaticAberrationParams> = {
  effectId: "fx.post.chromaticAberration", toolName: "chromatic_aberration", displayName: "色差", version: "1.0.0", category: "post",
  parameterSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, required: ["amount"], properties: {
    amount: { type: "number", minimum: 0, maximum: 24, multipleOf: 0.1, default: 4 }, radial: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.7 },
    angle: { type: "integer", minimum: -180, maximum: 180, default: 0 }, falloff: { type: "number", minimum: 0, maximum: 3, multipleOf: 0.01, default: 1 }, mix: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.8 }
  } }, defaults,
  presets: [
    { presetId: "chromatic-aberration.lens", displayName: "镜头边缘", params: { ...defaults, amount: 2.5, radial: 1, falloff: 1.8, mix: 0.6 } },
    { presetId: "chromatic-aberration.retro", displayName: "复古色散", params: { ...defaults, amount: 7, radial: 0.35, angle: 12, falloff: 0.7 } },
    { presetId: "chromatic-aberration.extreme", displayName: "强烈色散", params: { ...defaults, amount: 15, radial: 0.8, angle: -20, mix: 1 } }
  ],
  inputSlots: [SOURCE_FRAME_SLOT], primaryBackend: CPU_BACKEND, fallbackStrategy: REJECT_FALLBACK, performanceGrade: "medium",
  normalizeParams: (params) => ({ amount: round(params.amount, 1), radial: round(params.radial), angle: Math.round(params.angle), falloff: round(params.falloff), mix: round(params.mix) }), validateParams: () => VALID_PARAMS,
  render(context, params) {
    const frame = frameInput(context); const output: number[] = []; const radians = params.angle * Math.PI / 180;
    for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
      const nx = (x - (frame.width - 1) / 2) / Math.max(1, frame.width / 2); const ny = (y - (frame.height - 1) / 2) / Math.max(1, frame.height / 2);
      const radius = Math.sqrt(nx * nx + ny * ny); const edge = Math.pow(clamp(radius), params.falloff);
      const constantX = Math.cos(radians); const constantY = Math.sin(radians);
      const radialLength = Math.max(0.0001, radius); const radialX = nx / radialLength; const radialY = ny / radialLength;
      const dx = params.amount * ((1 - params.radial) * constantX + params.radial * radialX * edge);
      const dy = params.amount * ((1 - params.radial) * constantY + params.radial * radialY * edge);
      const red = sampleBilinear(frame, x + dx, y + dy); const blue = sampleBilinear(frame, x - dx, y - dy); const base = pixelAt(frame, x, y);
      output.push(byte(base[0]! + (red[0]! - base[0]!) * params.mix), base[1]!, byte(base[2]! + (blue[2]! - base[2]!) * params.mix), base[3]!);
    }
    return frameResult(CHROMATIC_ABERRATION_DEFINITION, frame, output);
  }
};
