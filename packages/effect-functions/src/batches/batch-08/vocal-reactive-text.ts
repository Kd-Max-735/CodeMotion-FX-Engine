import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import { parseAudioAnalysis, smoothedBand, type AudioAnalysisFrame } from "./audio-analysis.js";
import { CPU_BACKEND, JSON_SCHEMA, round, singleBinding } from "./common.js";

export interface VocalReactiveTextParams extends JsonObject {
  band: "full" | "bass" | "mid" | "vocal" | "high";
  mapping: "scale" | "opacity" | "position_y" | "tracking";
  smoothing: number;
  amount: number;
  baseline: number;
}

export interface VocalReactiveTextOutput {
  readonly layerHandle: string;
  readonly fontHandle: string;
  readonly energy: number;
  readonly property: VocalReactiveTextParams["mapping"];
  readonly value: number;
}

interface TextLayerBinding {
  readonly version: "text-layer-v1";
  readonly layerHandle: string;
}

interface FontBinding {
  readonly version: "font-binding-v1";
  readonly fontHandle: string;
}

function parseHandle(value: unknown, version: string, field: string): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${field} binding must be an object.`);
  }
  const record = value as Record<string, unknown>;
  if (record.version !== version || typeof record[field] !== "string"
    || (record[field] as string).length === 0 || Object.keys(record).length !== 2) {
    throw new TypeError(`${field} binding is invalid.`);
  }
  return record[field] as string;
}

function bandSelector(band: VocalReactiveTextParams["band"]): (frame: AudioAnalysisFrame) => number {
  switch (band) {
    case "bass": return (frame) => frame.bass;
    case "mid": return (frame) => frame.mid;
    case "vocal": return (frame) => frame.vocal;
    case "high": return (frame) => frame.high;
    default: return (frame) => frame.rms;
  }
}

const defaults: VocalReactiveTextParams = Object.freeze({
  band: "vocal",
  mapping: "scale",
  smoothing: 0.35,
  amount: 0.4,
  baseline: 1
});

export const VOCAL_REACTIVE_TEXT_DEFINITION: EffectToolDefinition<VocalReactiveTextParams, AuthorizedEffectInputs, VocalReactiveTextOutput> = {
  effectId: "fx.audio.vocalReactiveText",
  toolName: "vocal_reactive_text",
  displayName: "人声响应文字",
  version: "1.0.0",
  category: "audio",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["band", "mapping"],
    properties: {
      band: { type: "string", enum: ["full", "bass", "mid", "vocal", "high"], default: "vocal" },
      mapping: { type: "string", enum: ["scale", "opacity", "position_y", "tracking"], default: "scale" },
      smoothing: { type: "number", minimum: 0, maximum: 1, default: 0.35 },
      amount: { type: "number", minimum: 0, maximum: 3, default: 0.4 },
      baseline: { type: "number", minimum: -2, maximum: 2, default: 1 }
    }
  },
  defaults,
  presets: [
    { presetId: "vocal-text.gentle", displayName: "柔和呼吸", params: { band: "vocal", mapping: "scale", smoothing: 0.65, amount: 0.22, baseline: 1 } },
    { presetId: "vocal-text.lyric", displayName: "歌词跃动", params: { band: "vocal", mapping: "position_y", smoothing: 0.28, amount: 1.2, baseline: 0 } },
    { presetId: "vocal-text.crisp", displayName: "清晰闪现", params: { band: "high", mapping: "opacity", smoothing: 0.12, amount: 1, baseline: 0 } }
  ],
  inputSlots: [
    { name: "audio_analysis", kind: "audio", required: true, cardinality: "one", description: "Server-bound frequency-band analysis derived from authorized audio." },
    { name: "text_layer", kind: "data", required: true, cardinality: "one", description: "Server-resolved text layer target." },
    { name: "text_font", kind: "font", required: true, cardinality: "one", description: "Server-authorized font used by the bound text layer." }
  ],
  primaryBackend: CPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "A real audio analysis, text layer, and authorized font are required." },
  performanceGrade: "light",
  normalizeParams: (params) => ({
    band: params.band,
    mapping: params.mapping,
    smoothing: round(params.smoothing),
    amount: round(params.amount),
    baseline: round(params.baseline)
  }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const analysis = parseAudioAnalysis(singleBinding(context, "audio_analysis"));
    const layerHandle = parseHandle(singleBinding<TextLayerBinding>(context, "text_layer"), "text-layer-v1", "layerHandle");
    const fontHandle = parseHandle(singleBinding<FontBinding>(context, "text_font"), "font-binding-v1", "fontHandle");
    const energy = smoothedBand(analysis, context.time, params.smoothing, bandSelector(params.band));
    return {
      kind: "metadata",
      backendId: CPU_BACKEND.backendId,
      output: Object.freeze({
        layerHandle,
        fontHandle,
        energy: round(energy),
        property: params.mapping,
        value: round(params.baseline + energy * params.amount)
      }),
      degraded: false,
      warnings: []
    };
  }
};
