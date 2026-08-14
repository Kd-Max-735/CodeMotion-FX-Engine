import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { COLOR_SCHEMA, REJECT_FALLBACK, SERVER_CPU_BACKEND, audioSeries, clamp,
  metadataResult, normalizeColor, round, schema, valid } from "./shared.js";

export interface WaveformParams extends JsonObject {
  sampleCount: number;
  gain: number;
  smoothing: number;
  thickness: number;
  horizontalScale: number;
  mirror: boolean;
  lineColor: string;
  backgroundColor: string;
}

const defaults: WaveformParams = {
  sampleCount: 256, gain: 1, smoothing: 0.35, thickness: 2,
  horizontalScale: 1, mirror: false, lineColor: "#F8F9FA", backgroundColor: "#212529"
};
function interpolate(values: readonly number[], position: number): number {
  const left = Math.floor(position);
  const right = Math.min(values.length - 1, left + 1);
  const fraction = position - left;
  return values[left]! * (1 - fraction) + values[right]! * fraction;
}

export const waveformDefinition: EffectToolDefinition<WaveformParams> = {
  effectId: "fx.audio.waveform",
  toolName: "waveform",
  displayName: "音频波形",
  version: "1.0.0",
  category: "audio-data",
  parameterSchema: schema({
    sampleCount: { type: "integer", minimum: 32, maximum: 512, default: defaults.sampleCount },
    gain: { type: "number", minimum: 0.1, maximum: 4, default: defaults.gain },
    smoothing: { type: "number", minimum: 0, maximum: 0.95, default: defaults.smoothing },
    thickness: { type: "number", minimum: 0.5, maximum: 12, default: defaults.thickness },
    horizontalScale: { type: "number", minimum: 0.25, maximum: 4, default: defaults.horizontalScale },
    mirror: { type: "boolean", default: defaults.mirror },
    lineColor: { ...COLOR_SCHEMA, default: defaults.lineColor },
    backgroundColor: { ...COLOR_SCHEMA, default: defaults.backgroundColor }
  }),
  defaults,
  presets: [
    { presetId: "batch07.waveform.clean", displayName: "清晰波形", params: { ...defaults } },
    { presetId: "batch07.waveform.voice", displayName: "语音轨", params: { ...defaults, sampleCount: 384, gain: 1.5, smoothing: 0.65, thickness: 1.5, horizontalScale: 1.5 } },
    { presetId: "batch07.waveform.mirrored", displayName: "镜像脉冲", params: { ...defaults, sampleCount: 192, gain: 1.8, smoothing: 0.15, thickness: 3, mirror: true, lineColor: "#F15BB5" } }
  ],
  inputSlots: [{ name: "audio_analysis", kind: "data", required: true, cardinality: "one",
    description: "Server-authorized normalized time-domain analysis; never model-visible." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "light",
  normalizeParams: (params) => ({ ...params, gain: round(params.gain), smoothing: round(params.smoothing),
    thickness: round(params.thickness), horizontalScale: round(params.horizontalScale),
    lineColor: normalizeColor(params.lineColor), backgroundColor: normalizeColor(params.backgroundColor) }),
  validateParams: () => valid(),
  render: (context, params) => {
    const samples = audioSeries(context, "waveformSamples", 65_536, -1, 1);
    const previous = audioSeries(context, "previousWaveformSamples", 65_536, -1, 1, false);
    const points = Array.from({ length: params.sampleCount }, (_, index) => {
      const ratio = index / Math.max(1, params.sampleCount - 1);
      const sourcePosition = ratio * (samples.length - 1);
      const current = interpolate(samples, sourcePosition);
      const prior = previous.length === 0 ? current
        : interpolate(previous, ratio * (previous.length - 1));
      const value = clamp((current * (1 - params.smoothing) + prior * params.smoothing) * params.gain, -1, 1);
      return { x: round((ratio - 0.5) * 2 * params.horizontalScale, 5), y: round(value, 5) };
    });
    const mirrored = params.mirror ? points.map((point) => ({ x: point.x, y: round(-point.y, 5) })) : [];
    return metadataResult({ algorithm: "time_domain_linear_resampling", points, mirrored,
      thickness: params.thickness, colors: [params.lineColor, params.backgroundColor] });
  }
};
