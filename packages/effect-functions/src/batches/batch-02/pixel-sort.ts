import type { JsonObject } from "@codemotion/core";
import type { EffectParameterValidationResult } from "../../types.js";
import { CPU_BACKEND, REJECT_FALLBACK, SOURCE_FRAME_SLOT, byte, frameInput, frameResult, luminance, pixelAt, round, type Batch02Definition } from "./common.js";

export interface PixelSortParams extends JsonObject { direction: "horizontal" | "vertical"; lowThreshold: number; highThreshold: number; minimumRun: number; order: "ascending" | "descending"; mix: number; }
const defaults: PixelSortParams = { direction: "horizontal", lowThreshold: 0.2, highThreshold: 0.85, minimumRun: 4, order: "ascending", mix: 1 };

function validate(params: Readonly<PixelSortParams>): EffectParameterValidationResult {
  return params.lowThreshold <= params.highThreshold ? { valid: true } : { valid: false, issues: [{ path: "$.lowThreshold", message: "must not exceed highThreshold" }] };
}

export const PIXEL_SORT_DEFINITION: Batch02Definition<PixelSortParams> = {
  effectId: "fx.distort.pixelSort", toolName: "pixel_sort", displayName: "像素排序", version: "1.0.0", category: "distort",
  parameterSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, required: ["lowThreshold", "highThreshold"], properties: {
    direction: { type: "string", enum: ["horizontal", "vertical"], default: "horizontal" }, lowThreshold: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.2 },
    highThreshold: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.85 }, minimumRun: { type: "integer", minimum: 2, maximum: 128, default: 4 },
    order: { type: "string", enum: ["ascending", "descending"], default: "ascending" }, mix: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 1 }
  } }, defaults,
  presets: [
    { presetId: "pixel-sort.highlights", displayName: "高光拖曳", params: { ...defaults, lowThreshold: 0.62, highThreshold: 1, minimumRun: 3 } },
    { presetId: "pixel-sort.midtones", displayName: "中间调排序", params: { ...defaults, lowThreshold: 0.25, highThreshold: 0.75, minimumRun: 6, mix: 0.8 } },
    { presetId: "pixel-sort.vertical", displayName: "纵向降序", params: { ...defaults, direction: "vertical", lowThreshold: 0.1, highThreshold: 0.9, order: "descending", minimumRun: 3 } }
  ],
  inputSlots: [SOURCE_FRAME_SLOT], primaryBackend: CPU_BACKEND, fallbackStrategy: REJECT_FALLBACK, performanceGrade: "heavy",
  normalizeParams: (params) => ({ direction: params.direction, lowThreshold: round(params.lowThreshold), highThreshold: round(params.highThreshold), minimumRun: Math.round(params.minimumRun), order: params.order, mix: round(params.mix) }), validateParams: validate,
  render(context, params) {
    const frame = frameInput(context); const pixels: number[][] = [];
    for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) pixels.push([...pixelAt(frame, x, y)]);
    const lineCount = params.direction === "horizontal" ? frame.height : frame.width; const lineLength = params.direction === "horizontal" ? frame.width : frame.height;
    const indexAt = (line: number, position: number) => params.direction === "horizontal" ? line * frame.width + position : position * frame.width + line;
    for (let line = 0; line < lineCount; line += 1) {
      let position = 0;
      while (position < lineLength) {
        const firstLight = luminance(pixels[indexAt(line, position)]!);
        if (firstLight < params.lowThreshold || firstLight > params.highThreshold) { position += 1; continue; }
        const start = position;
        while (position < lineLength) { const light = luminance(pixels[indexAt(line, position)]!); if (light < params.lowThreshold || light > params.highThreshold) break; position += 1; }
        if (position - start < params.minimumRun) continue;
        const sorted = Array.from({ length: position - start }, (_, offset) => pixels[indexAt(line, start + offset)]!).sort((left, right) => (luminance(left) - luminance(right)) * (params.order === "ascending" ? 1 : -1));
        sorted.forEach((pixel, offset) => { const target = pixels[indexAt(line, start + offset)]!; pixels[indexAt(line, start + offset)] = target.map((entry, channel) => byte(entry + (pixel[channel]! - entry) * params.mix)); });
      }
    }
    return frameResult(PIXEL_SORT_DEFINITION, frame, pixels.flat());
  }
};
