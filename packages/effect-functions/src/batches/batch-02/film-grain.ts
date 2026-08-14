import type { JsonObject } from "@codemotion/core";
import { CPU_BACKEND, REJECT_FALLBACK, SOURCE_FRAME_SLOT, VALID_PARAMS, byte, clamp, frameInput, frameResult, hash, luminance, pixelAt, round, type Batch02Definition } from "./common.js";

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
    const frame = frameInput(context); const output: number[] = []; const temporalFrame = Math.round(context.frame * params.temporal); const seed = context.seed + temporalFrame * 104729;
    for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
      const base = pixelAt(frame, x, y); const light = luminance(base);
      const response = params.response === "shadows" ? 1 - light * 0.7 : params.response === "highlights" ? 0.3 + light * 0.7 : 1;
      const gx = Math.floor(x / params.size); const gy = Math.floor(y / params.size);
      const monoNoise = (hash(seed, gx, gy) - 0.5) * 2; const strength = params.amount * response * 96;
      const noises = params.monochrome ? [monoNoise, monoNoise, monoNoise] : [monoNoise, (hash(seed, gx, gy, 1) - 0.5) * 2, (hash(seed, gx, gy, 2) - 0.5) * 2];
      output.push(byte(base[0]! + noises[0]! * strength), byte(base[1]! + noises[1]! * strength), byte(base[2]! + noises[2]! * strength), byte(clamp(base[3]!, 0, 255)));
    }
    return frameResult(FILM_GRAIN_DEFINITION, frame, output);
  }
};
