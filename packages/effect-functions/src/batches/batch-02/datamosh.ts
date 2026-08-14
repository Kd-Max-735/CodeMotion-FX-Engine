import type { JsonObject } from "@codemotion/core";
import { CPU_BACKEND, REJECT_FALLBACK, SOURCE_FRAME_SLOT, VALID_PARAMS, assertMatchingDimensions, byte, frameInput, frameResult, hash, pixelAt, round, sampleNearest, type Batch02Definition } from "./common.js";

export interface DatamoshParams extends JsonObject { blockSize: number; carry: number; motionX: number; motionY: number; corruption: number; smear: number; seedOffset: number; }
const defaults: DatamoshParams = { blockSize: 12, carry: 0.72, motionX: 8, motionY: 2, corruption: 0.45, smear: 0.35, seedOffset: 0 };
const previousSlot = Object.freeze({ name: "previous_frame", kind: "image" as const, required: true, cardinality: "one" as const, description: "Owner-authorized previous RGBA frame bound by the server." });

export const DATAMOSH_DEFINITION: Batch02Definition<DatamoshParams> = {
  effectId: "fx.distort.datamosh", toolName: "datamosh", displayName: "数据错帧", version: "1.0.0", category: "distort",
  parameterSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, required: ["carry"], properties: {
    blockSize: { type: "integer", minimum: 2, maximum: 64, default: 12 }, carry: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.72 },
    motionX: { type: "integer", minimum: -96, maximum: 96, default: 8 }, motionY: { type: "integer", minimum: -96, maximum: 96, default: 2 }, corruption: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.45 },
    smear: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.35 }, seedOffset: { type: "integer", minimum: 0, maximum: 100000, default: 0 }
  } }, defaults,
  presets: [
    { presetId: "datamosh.echo", displayName: "轻微残帧", params: { ...defaults, blockSize: 8, carry: 0.4, motionX: 3, motionY: 1, corruption: 0.25, smear: 0.2 } },
    { presetId: "datamosh.motion", displayName: "运动块漂移", params: { ...defaults, blockSize: 16, carry: 0.82, motionX: 18, motionY: -4, corruption: 0.6, smear: 0.5 } },
    { presetId: "datamosh.breakdown", displayName: "强烈码流崩解", params: { ...defaults, blockSize: 24, carry: 0.95, motionX: -32, motionY: 12, corruption: 0.82, smear: 0.75 } }
  ],
  inputSlots: [SOURCE_FRAME_SLOT, previousSlot], primaryBackend: CPU_BACKEND, fallbackStrategy: REJECT_FALLBACK, performanceGrade: "heavy",
  normalizeParams: (params) => ({ blockSize: Math.round(params.blockSize), carry: round(params.carry), motionX: Math.round(params.motionX), motionY: Math.round(params.motionY), corruption: round(params.corruption), smear: round(params.smear), seedOffset: Math.round(params.seedOffset) }), validateParams: () => VALID_PARAMS,
  render(context, params) {
    const frame = frameInput(context); const previous = frameInput(context, "previous_frame"); assertMatchingDimensions(frame, previous); const output: number[] = []; const seed = context.seed + params.seedOffset + context.frame * 65537;
    for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
      const blockX = Math.floor(x / params.blockSize); const blockY = Math.floor(y / params.blockSize); const active = hash(seed, blockX, blockY) < params.corruption; const current = pixelAt(frame, x, y);
      if (!active) { output.push(...current); continue; }
      const variance = (hash(seed, blockX, blockY, 1) * 2 - 1) * params.blockSize * 0.4;
      const sourceX = x - params.motionX - variance; const sourceY = y - params.motionY + variance * 0.25;
      const carried = sampleNearest(previous, sourceX, sourceY); const trailing = sampleNearest(previous, sourceX - params.motionX * params.smear, sourceY - params.motionY * params.smear);
      for (let channel = 0; channel < 3; channel += 1) { const temporal = carried[channel]! * (1 - params.smear) + trailing[channel]! * params.smear; output.push(byte(current[channel]! + (temporal - current[channel]!) * params.carry)); }
      output.push(current[3]!);
    }
    return frameResult(DATAMOSH_DEFINITION, frame, output);
  }
};
