import type { JsonObject } from "@codemotion/core";
import { CPU_BACKEND, REJECT_FALLBACK, SOURCE_FRAME_SLOT, VALID_PARAMS, byte, frameInput, frameResult, pixelAt, round, sampleBilinear, type Batch02Definition } from "./common.js";

export interface RgbSplitParams extends JsonObject { distance: number; angle: number; redScale: number; blueScale: number; mode: "symmetric" | "outward"; mix: number; }
const defaults: RgbSplitParams = { distance: 6, angle: 0, redScale: 1, blueScale: 1, mode: "symmetric", mix: 0.9 };

export const RGB_SPLIT_DEFINITION: Batch02Definition<RgbSplitParams> = {
  effectId: "fx.distort.rgbSplit", toolName: "rgb_split", displayName: "RGB 分离", version: "1.0.0", category: "distort",
  parameterSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, required: ["distance"], properties: {
    distance: { type: "number", minimum: 0, maximum: 64, multipleOf: 0.1, default: 6 }, angle: { type: "integer", minimum: -180, maximum: 180, default: 0 },
    redScale: { type: "number", minimum: 0, maximum: 2, multipleOf: 0.01, default: 1 }, blueScale: { type: "number", minimum: 0, maximum: 2, multipleOf: 0.01, default: 1 },
    mode: { type: "string", enum: ["symmetric", "outward"], default: "symmetric" }, mix: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.9 }
  } }, defaults,
  presets: [
    { presetId: "rgb-split.clean", displayName: "清晰分边", params: { ...defaults, distance: 3, mix: 0.65 } },
    { presetId: "rgb-split.diagonal", displayName: "对角分离", params: { ...defaults, distance: 10, angle: 45, redScale: 1.2, blueScale: 0.8 } },
    { presetId: "rgb-split.outward", displayName: "向外爆色", params: { ...defaults, distance: 18, mode: "outward", mix: 1 } }
  ],
  inputSlots: [SOURCE_FRAME_SLOT], primaryBackend: CPU_BACKEND, fallbackStrategy: REJECT_FALLBACK, performanceGrade: "medium",
  normalizeParams: (params) => ({ distance: round(params.distance, 1), angle: Math.round(params.angle), redScale: round(params.redScale), blueScale: round(params.blueScale), mode: params.mode, mix: round(params.mix) }), validateParams: () => VALID_PARAMS,
  render(context, params) {
    const frame = frameInput(context); const output: number[] = []; const radians = params.angle * Math.PI / 180;
    for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
      let dx = Math.cos(radians) * params.distance; let dy = Math.sin(radians) * params.distance;
      if (params.mode === "outward") { const cx = x - (frame.width - 1) / 2; const cy = y - (frame.height - 1) / 2; const length = Math.max(1, Math.sqrt(cx * cx + cy * cy)); dx = cx / length * params.distance; dy = cy / length * params.distance; }
      const base = pixelAt(frame, x, y); const red = sampleBilinear(frame, x + dx * params.redScale, y + dy * params.redScale); const blue = sampleBilinear(frame, x - dx * params.blueScale, y - dy * params.blueScale);
      output.push(byte(base[0]! + (red[0]! - base[0]!) * params.mix), base[1]!, byte(base[2]! + (blue[2]! - base[2]!) * params.mix), base[3]!);
    }
    return frameResult(RGB_SPLIT_DEFINITION, frame, output);
  }
};
