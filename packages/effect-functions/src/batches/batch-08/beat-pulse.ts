import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import { parseAudioAnalysis } from "./audio-analysis.js";
import { CPU_BACKEND, JSON_SCHEMA, round, singleBinding } from "./common.js";

export interface BeatPulseParams extends JsonObject {
  sensitivity: number;
  decay: number;
  amount: number;
  targetProperty: "scale" | "glow" | "both";
}

export interface BeatPulseOutput {
  readonly analysisVersion: "audio-analysis-v1";
  readonly pulse: number;
  readonly scale: number;
  readonly glow: number;
  readonly targetProperty: BeatPulseParams["targetProperty"];
}

const defaults: BeatPulseParams = Object.freeze({
  sensitivity: 0.62,
  decay: 0.28,
  amount: 0.35,
  targetProperty: "both"
});

export const BEAT_PULSE_DEFINITION: EffectToolDefinition<BeatPulseParams, AuthorizedEffectInputs, BeatPulseOutput> = {
  effectId: "fx.audio.beatPulse",
  toolName: "beat_pulse",
  displayName: "节拍脉冲",
  version: "1.0.0",
  category: "audio",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["sensitivity", "targetProperty"],
    properties: {
      sensitivity: { type: "number", minimum: 0, maximum: 1, default: 0.62 },
      decay: { type: "number", minimum: 0.05, maximum: 2, default: 0.28 },
      amount: { type: "number", minimum: 0, maximum: 2, default: 0.35 },
      targetProperty: { type: "string", enum: ["scale", "glow", "both"], default: "both" }
    }
  },
  defaults,
  presets: [
    { presetId: "beat-pulse.subtle", displayName: "轻柔律动", params: { sensitivity: 0.72, decay: 0.45, amount: 0.18, targetProperty: "scale" } },
    { presetId: "beat-pulse.club", displayName: "强劲节拍", params: { sensitivity: 0.48, decay: 0.2, amount: 0.65, targetProperty: "both" } },
    { presetId: "beat-pulse.neon", displayName: "霓虹闪动", params: { sensitivity: 0.58, decay: 0.32, amount: 0.8, targetProperty: "glow" } }
  ],
  inputSlots: [{
    name: "audio_analysis",
    kind: "audio",
    required: true,
    cardinality: "one",
    description: "Server-bound, versioned analysis frames derived from the authorized audio."
  }],
  primaryBackend: CPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "A real server audio analysis is required." },
  performanceGrade: "light",
  normalizeParams: (params) => ({
    sensitivity: round(params.sensitivity),
    decay: round(params.decay),
    amount: round(params.amount),
    targetProperty: params.targetProperty
  }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const analysis = parseAudioAnalysis(singleBinding(context, "audio_analysis"));
    let pulse = 0;
    for (const frame of analysis.frames) {
      if (frame.time > context.time || frame.beatConfidence < params.sensitivity) continue;
      const elapsed = context.time - frame.time;
      pulse = Math.max(pulse, frame.beatConfidence * Math.exp(-elapsed / params.decay));
    }
    const weighted = round(pulse * params.amount);
    return {
      kind: "metadata",
      backendId: CPU_BACKEND.backendId,
      output: Object.freeze({
        analysisVersion: analysis.version,
        pulse: round(pulse),
        scale: params.targetProperty === "glow" ? 1 : round(1 + weighted),
        glow: params.targetProperty === "scale" ? 0 : weighted,
        targetProperty: params.targetProperty
      }),
      degraded: false,
      warnings: []
    };
  }
};
