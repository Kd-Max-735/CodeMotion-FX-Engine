import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import { parseAudioAnalysis } from "./audio-analysis.js";
import { CPU_BACKEND, JSON_SCHEMA, round, singleBinding } from "./common.js";

export interface OnsetTriggerParams extends JsonObject {
  threshold: number;
  cooldown: number;
  retriggerMode: "rising_edge" | "strongest_in_window";
  strength: number;
}

export interface OnsetTriggerOutput {
  readonly triggered: boolean;
  readonly triggerStrength: number;
  readonly triggerTime: number | null;
  readonly targetEffectHandle: string;
}

interface TargetEffectBinding {
  readonly version: "effect-target-v1";
  readonly handle: string;
}

const defaults: OnsetTriggerParams = Object.freeze({
  threshold: 0.68,
  cooldown: 0.3,
  retriggerMode: "rising_edge",
  strength: 1
});

function parseTarget(value: unknown): TargetEffectBinding {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("target effect binding must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "version" && key !== "handle")
    || record.version !== "effect-target-v1" || typeof record.handle !== "string"
    || record.handle.length === 0 || record.handle.length > 256) {
    throw new TypeError("target effect binding is invalid.");
  }
  return { version: "effect-target-v1", handle: record.handle };
}

export const ONSET_TRIGGER_DEFINITION: EffectToolDefinition<OnsetTriggerParams, AuthorizedEffectInputs, OnsetTriggerOutput> = {
  effectId: "fx.audio.onsetTrigger",
  toolName: "onset_trigger",
  displayName: "起音触发",
  version: "1.0.0",
  category: "audio",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["threshold", "cooldown"],
    properties: {
      threshold: { type: "number", minimum: 0, maximum: 1, default: 0.68 },
      cooldown: { type: "number", minimum: 0, maximum: 5, default: 0.3 },
      retriggerMode: { type: "string", enum: ["rising_edge", "strongest_in_window"], default: "rising_edge" },
      strength: { type: "number", minimum: 0, maximum: 2, default: 1 }
    }
  },
  defaults,
  presets: [
    { presetId: "onset-trigger.precise", displayName: "精准打点", params: { threshold: 0.78, cooldown: 0.35, retriggerMode: "rising_edge", strength: 1 } },
    { presetId: "onset-trigger.sensitive", displayName: "灵敏触发", params: { threshold: 0.46, cooldown: 0.16, retriggerMode: "rising_edge", strength: 0.8 } },
    { presetId: "onset-trigger.impact", displayName: "重击触发", params: { threshold: 0.7, cooldown: 0.55, retriggerMode: "strongest_in_window", strength: 1.5 } }
  ],
  inputSlots: [
    { name: "audio_analysis", kind: "audio", required: true, cardinality: "one", description: "Server-bound onset analysis derived from authorized audio." },
    { name: "target_effect", kind: "data", required: true, cardinality: "one", description: "Server-resolved effect target; never exposed to the model." }
  ],
  primaryBackend: CPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Onset triggering requires real analysis and a server-resolved target." },
  performanceGrade: "light",
  normalizeParams: (params) => ({
    threshold: round(params.threshold),
    cooldown: round(params.cooldown),
    retriggerMode: params.retriggerMode,
    strength: round(params.strength)
  }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const analysis = parseAudioAnalysis(singleBinding(context, "audio_analysis"));
    const target = parseTarget(singleBinding(context, "target_effect"));
    let index = 0;
    for (let cursor = 1; cursor < analysis.frames.length; cursor += 1) {
      if (analysis.frames[cursor]!.time > context.time) break;
      index = cursor;
    }
    const current = analysis.frames[index]!;
    const previous = analysis.frames[Math.max(0, index - 1)]!;
    const crosses = current.onsetStrength >= params.threshold
      && (params.retriggerMode === "strongest_in_window"
        ? current.onsetStrength >= previous.onsetStrength
        : previous.onsetStrength < params.threshold);
    let lastTrigger = Number.NEGATIVE_INFINITY;
    for (let cursor = 1; cursor < index; cursor += 1) {
      const frame = analysis.frames[cursor]!;
      const before = analysis.frames[cursor - 1]!;
      if (frame.onsetStrength >= params.threshold && before.onsetStrength < params.threshold) {
        lastTrigger = frame.time;
      }
    }
    const triggered = crosses && current.time - lastTrigger >= params.cooldown;
    return {
      kind: "metadata",
      backendId: CPU_BACKEND.backendId,
      output: Object.freeze({
        triggered,
        triggerStrength: triggered ? round(current.onsetStrength * params.strength) : 0,
        triggerTime: triggered ? current.time : null,
        targetEffectHandle: target.handle
      }),
      degraded: false,
      warnings: []
    };
  }
};
