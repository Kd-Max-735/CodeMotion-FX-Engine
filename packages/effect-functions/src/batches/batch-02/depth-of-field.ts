import type { JsonObject } from "@codemotion/core";
import { CPU_BACKEND, REJECT_FALLBACK, SOURCE_FRAME_SLOT, VALID_PARAMS, assertMatchingDimensions, byte, clamp, depthInput, frameInput, frameResult, pixelAt, round, type Batch02Definition } from "./common.js";

export interface DepthOfFieldParams extends JsonObject {
  focusDepth: number; focusRange: number; blurRadius: number; bokehBoost: number; edgePreservation: number;
}

const defaults: DepthOfFieldParams = { focusDepth: 0.5, focusRange: 0.12, blurRadius: 8, bokehBoost: 0.25, edgePreservation: 0.6 };
const depthSlot = Object.freeze({ name: "depth_field", kind: "depth-map" as const, required: true, cardinality: "one" as const, description: "Owner-authorized normalized depth field bound by the server." });

export const DEPTH_OF_FIELD_DEFINITION: Batch02Definition<DepthOfFieldParams> = {
  effectId: "fx.post.depthOfField", toolName: "depth_of_field", displayName: "景深", version: "1.0.0", category: "post",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", additionalProperties: false, required: ["focusDepth"],
    properties: {
      focusDepth: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.5 },
      focusRange: { type: "number", minimum: 0.01, maximum: 1, multipleOf: 0.01, default: 0.12 },
      blurRadius: { type: "integer", minimum: 0, maximum: 20, default: 8 },
      bokehBoost: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.25 },
      edgePreservation: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.6 }
    }
  }, defaults,
  presets: [
    { presetId: "depth-of-field.subtle", displayName: "轻景深", params: { ...defaults, focusRange: 0.24, blurRadius: 4, bokehBoost: 0.1 } },
    { presetId: "depth-of-field.portrait", displayName: "人像浅景深", params: { ...defaults, focusDepth: 0.42, focusRange: 0.08, blurRadius: 12, bokehBoost: 0.35 } },
    { presetId: "depth-of-field.macro", displayName: "微距焦平面", params: { ...defaults, focusDepth: 0.3, focusRange: 0.03, blurRadius: 18, bokehBoost: 0.55, edgePreservation: 0.8 } }
  ],
  inputSlots: [SOURCE_FRAME_SLOT, depthSlot], primaryBackend: CPU_BACKEND, fallbackStrategy: REJECT_FALLBACK, performanceGrade: "heavy",
  normalizeParams: (params) => ({ focusDepth: round(params.focusDepth), focusRange: round(params.focusRange), blurRadius: Math.round(params.blurRadius), bokehBoost: round(params.bokehBoost), edgePreservation: round(params.edgePreservation) }),
  validateParams: () => VALID_PARAMS,
  render(context, params) {
    const frame = frameInput(context); const depth = depthInput(context); assertMatchingDimensions(frame, depth);
    const output: number[] = [];
    for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) {
      const centerDepth = depth.data[y * frame.width + x]!;
      const distance = Math.max(0, Math.abs(centerDepth - params.focusDepth) - params.focusRange * 0.5);
      const coc = clamp(distance / Math.max(0.001, 1 - params.focusRange * 0.5));
      const radius = Math.ceil(params.blurRadius * coc);
      if (radius === 0) { output.push(...pixelAt(frame, x, y)); continue; }
      const sums = [0, 0, 0, 0]; let weights = 0;
      for (let sy = -radius; sy <= radius; sy += 1) for (let sx = -radius; sx <= radius; sx += 1) {
        if (sx * sx + sy * sy > radius * radius) continue;
        const sampleX = Math.min(frame.width - 1, Math.max(0, x + sx));
        const sampleY = Math.min(frame.height - 1, Math.max(0, y + sy));
        const sampleDepth = depth.data[sampleY * frame.width + sampleX]!;
        const edgeWeight = Math.exp(-Math.abs(sampleDepth - centerDepth) * params.edgePreservation * 12);
        const sample = pixelAt(frame, sampleX, sampleY);
        const brightness = (sample[0]! + sample[1]! + sample[2]!) / 765;
        const weight = edgeWeight * (1 + brightness * params.bokehBoost);
        for (let channel = 0; channel < 4; channel += 1) sums[channel] = sums[channel]! + sample[channel]! * weight;
        weights += weight;
      }
      output.push(byte(sums[0]! / weights), byte(sums[1]! / weights), byte(sums[2]! / weights), byte(sums[3]! / weights));
    }
    return frameResult(DEPTH_OF_FIELD_DEFINITION, frame, output);
  }
};
