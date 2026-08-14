import type { JsonObject } from "@codemotion/core";
import { CPU_BACKEND, REJECT_FALLBACK, SOURCE_FRAME_SLOT, VALID_PARAMS, byte, frameInput, frameResult, hash, pixelAt, round, sampleNearest, type Batch02Definition } from "./common.js";

export interface GlitchSliceParams extends JsonObject { sliceSize: number; displacement: number; density: number; direction: "horizontal" | "vertical"; channelJitter: number; seedOffset: number; mix: number; }
const defaults: GlitchSliceParams = { sliceSize: 8, displacement: 18, density: 0.35, direction: "horizontal", channelJitter: 3, seedOffset: 0, mix: 0.85 };

export const GLITCH_SLICE_DEFINITION: Batch02Definition<GlitchSliceParams> = {
  effectId: "fx.distort.glitchSlice", toolName: "glitch_slice", displayName: "故障切片", version: "1.0.0", category: "distort",
  parameterSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, required: ["displacement"], properties: {
    sliceSize: { type: "integer", minimum: 1, maximum: 64, default: 8 }, displacement: { type: "integer", minimum: 0, maximum: 160, default: 18 }, density: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.35 },
    direction: { type: "string", enum: ["horizontal", "vertical"], default: "horizontal" }, channelJitter: { type: "integer", minimum: 0, maximum: 24, default: 3 }, seedOffset: { type: "integer", minimum: 0, maximum: 100000, default: 0 },
    mix: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.85 }
  } }, defaults,
  presets: [
    { presetId: "glitch-slice.subtle", displayName: "轻微信号跳动", params: { ...defaults, sliceSize: 4, displacement: 6, density: 0.18, channelJitter: 1, mix: 0.55 } },
    { presetId: "glitch-slice.broadcast", displayName: "广播故障", params: { ...defaults, sliceSize: 10, displacement: 32, density: 0.48, channelJitter: 5 } },
    { presetId: "glitch-slice.vertical", displayName: "纵向撕裂", params: { ...defaults, direction: "vertical", sliceSize: 14, displacement: 55, density: 0.62, channelJitter: 8, mix: 1 } }
  ],
  inputSlots: [SOURCE_FRAME_SLOT], primaryBackend: CPU_BACKEND, fallbackStrategy: REJECT_FALLBACK, performanceGrade: "medium",
  normalizeParams: (params) => ({ sliceSize: Math.round(params.sliceSize), displacement: Math.round(params.displacement), density: round(params.density), direction: params.direction, channelJitter: Math.round(params.channelJitter), seedOffset: Math.round(params.seedOffset), mix: round(params.mix) }), validateParams: () => VALID_PARAMS,
  render(context, params) {
    const frame = frameInput(context); const output: number[] = []; const seed = context.seed + params.seedOffset + context.frame * 8191;
    for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
      const slice = Math.floor((params.direction === "horizontal" ? y : x) / params.sliceSize); const active = hash(seed, slice, 0) < params.density;
      const signed = hash(seed, slice, 1) * 2 - 1; const shift = active ? Math.round(signed * params.displacement) : 0;
      const sx = params.direction === "horizontal" ? x + shift : x; const sy = params.direction === "vertical" ? y + shift : y;
      const base = pixelAt(frame, x, y); const shifted = sampleNearest(frame, sx, sy);
      const jitter = active ? Math.round((hash(seed, slice, 2) * 2 - 1) * params.channelJitter) : 0;
      const red = params.direction === "horizontal" ? sampleNearest(frame, sx + jitter, sy)[0]! : sampleNearest(frame, sx, sy + jitter)[0]!;
      const blue = params.direction === "horizontal" ? sampleNearest(frame, sx - jitter, sy)[2]! : sampleNearest(frame, sx, sy - jitter)[2]!;
      const effect = [red, shifted[1]!, blue, base[3]!];
      output.push(byte(base[0]! + (effect[0]! - base[0]!) * params.mix), byte(base[1]! + (effect[1]! - base[1]!) * params.mix), byte(base[2]! + (effect[2]! - base[2]!) * params.mix), base[3]!);
    }
    return frameResult(GLITCH_SLICE_DEFINITION, frame, output);
  }
};
