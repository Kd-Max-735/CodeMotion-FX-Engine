import type { JsonObject } from "@codemotion/core";
import { CPU_BACKEND, REJECT_FALLBACK, SOURCE_FRAME_SLOT, VALID_PARAMS, byte, frameInput, frameResult, hash, round, type Batch02Definition } from "./common.js";

export interface FilmGrainParams extends JsonObject { amount: number; size: number; monochrome: boolean; response: "uniform" | "shadows" | "highlights"; temporal: number; }
const defaults: FilmGrainParams = { amount: 0.18, size: 2, monochrome: true, response: "uniform", temporal: 0.65 };

export const FILM_GRAIN_DEFINITION: Batch02Definition<FilmGrainParams> = {
  effectId: "fx.post.filmGrain", toolName: "film_grain", displayName: "胶片颗粒", version: "1.0.0", category: "post",
  parameterSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, required: ["amount"], properties: {
    amount: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.18 }, size: { type: "integer", minimum: 1, maximum: 8, default: 2 }, monochrome: { type: "boolean", default: true },
    response: { type: "string", enum: ["uniform", "shadows", "highlights"], default: "uniform" }, temporal: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.65 }
  } }, defaults,
  presets: [
    { presetId: "film-grain.fine", displayName: "细腻胶片", params: { ...defaults, amount: 0.1, size: 1, temporal: 0.35 } },
    { presetId: "film-grain.vintage", displayName: "复古粗颗粒", params: { ...defaults, amount: 0.32, size: 4, response: "shadows", temporal: 0.8 } },
    { presetId: "film-grain.color", displayName: "彩色颗粒", params: { ...defaults, amount: 0.24, size: 2, monochrome: false, response: "highlights" } }
  ],
  inputSlots: [SOURCE_FRAME_SLOT], primaryBackend: CPU_BACKEND, fallbackStrategy: REJECT_FALLBACK, performanceGrade: "light",
  normalizeParams: (params) => ({ amount: round(params.amount), size: Math.round(params.size), monochrome: params.monochrome, response: params.response, temporal: round(params.temporal) }), validateParams: () => VALID_PARAMS,
  render(context, params) {
    const frame = frameInput(context); const output = new Uint8Array(frame.data.length); const temporalFrame = Math.round(context.frame * params.temporal); const seed = context.seed + temporalFrame * 104729;
    for (let blockY = 0; blockY < frame.height; blockY += params.size) for (let blockX = 0; blockX < frame.width; blockX += params.size) {
      const gx = Math.floor(blockX / params.size); const gy = Math.floor(blockY / params.size);
      const redNoise = (hash(seed, gx, gy) - 0.5) * 2;
      const greenNoise = params.monochrome ? redNoise : (hash(seed, gx, gy, 1) - 0.5) * 2;
      const blueNoise = params.monochrome ? redNoise : (hash(seed, gx, gy, 2) - 0.5) * 2;
      const endY = Math.min(frame.height, blockY + params.size); const endX = Math.min(frame.width, blockX + params.size);
      for (let y = blockY; y < endY; y += 1) for (let x = blockX; x < endX; x += 1) {
        const offset = (y * frame.width + x) * 4;
        const red = frame.data[offset]!; const green = frame.data[offset + 1]!; const blue = frame.data[offset + 2]!;
        const light = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
        const response = params.response === "shadows" ? 1 - light * 0.7 : params.response === "highlights" ? 0.3 + light * 0.7 : 1;
        const strength = params.amount * response * 96;
        output[offset] = byte(red + redNoise * strength);
        output[offset + 1] = byte(green + greenNoise * strength);
        output[offset + 2] = byte(blue + blueNoise * strength);
        output[offset + 3] = byte(frame.data[offset + 3]!);
      }
    }
    return frameResult(FILM_GRAIN_DEFINITION, frame, output);
  }
};
