import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { COLOR_SCHEMA, REJECT_FALLBACK, SERVER_CPU_BACKEND, audioSeries, clamp,
  metadataResult, normalizeColor, round, schema, valid } from "./shared.js";

export interface SpectrumBarsParams extends JsonObject {
  barCount: number;
  gain: number;
  smoothing: number;
  falloff: number;
  logarithmic: boolean;
  barColor: string;
  backgroundColor: string;
}

const defaults: SpectrumBarsParams = {
  barCount: 48, gain: 1, smoothing: 0.55, falloff: 1.1, logarithmic: true,
  barColor: "#00F5D4", backgroundColor: "#001219"
};
function sampledAverage(values: readonly number[], start: number, end: number): number {
  const first = Math.min(values.length - 1, Math.floor(start));
  const last = Math.min(values.length - 1, Math.max(first, Math.ceil(end) - 1));
  let sum = 0;
  for (let index = first; index <= last; index += 1) sum += values[index]!;
  return sum / (last - first + 1);
}

export const spectrumBarsDefinition: EffectToolDefinition<SpectrumBarsParams> = {
  effectId: "fx.audio.spectrumBars",
  toolName: "spectrum_bars",
  displayName: "频谱柱",
  version: "1.0.0",
  category: "audio-data",
  parameterSchema: schema({
    barCount: { type: "integer", minimum: 8, maximum: 128, default: defaults.barCount },
    gain: { type: "number", minimum: 0.1, maximum: 4, default: defaults.gain },
    smoothing: { type: "number", minimum: 0, maximum: 0.95, default: defaults.smoothing },
    falloff: { type: "number", minimum: 0.25, maximum: 4, default: defaults.falloff },
    logarithmic: { type: "boolean", default: defaults.logarithmic },
    barColor: { ...COLOR_SCHEMA, default: defaults.barColor },
    backgroundColor: { ...COLOR_SCHEMA, default: defaults.backgroundColor }
  }),
  defaults,
  presets: [
    { presetId: "batch07.spectrum.balanced", displayName: "均衡频谱", params: { ...defaults } },
    { presetId: "batch07.spectrum.club", displayName: "俱乐部", params: { ...defaults, barCount: 72, gain: 1.7, smoothing: 0.3, falloff: 0.75, barColor: "#FF006E" } },
    { presetId: "batch07.spectrum.calm", displayName: "柔和监听", params: { ...defaults, barCount: 32, gain: 0.75, smoothing: 0.82, falloff: 1.5, logarithmic: false, barColor: "#90E0EF" } }
  ],
  inputSlots: [{ name: "audio_analysis", kind: "audio", required: true, cardinality: "one",
    description: "Server-authorized normalized frequency analysis; never model-visible." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "light",
  normalizeParams: (params) => ({ ...params, gain: round(params.gain), smoothing: round(params.smoothing),
    falloff: round(params.falloff), barColor: normalizeColor(params.barColor),
    backgroundColor: normalizeColor(params.backgroundColor) }),
  validateParams: () => valid(),
  render: (context, params) => {
    const bins = audioSeries(context, "frequencyBins", 8192, 0, 1);
    const previous = audioSeries(context, "previousFrequencyBins", 8192, 0, 1, false);
    const bars = Array.from({ length: params.barCount }, (_, index) => {
      const startRatio = params.logarithmic ? (Math.exp(index / params.barCount * Math.log(10)) - 1) / 9
        : index / params.barCount;
      const endRatio = params.logarithmic ? (Math.exp((index + 1) / params.barCount * Math.log(10)) - 1) / 9
        : (index + 1) / params.barCount;
      const current = sampledAverage(bins, startRatio * bins.length, endRatio * bins.length);
      const prior = previous.length === 0 ? current
        : sampledAverage(previous, startRatio * previous.length, endRatio * previous.length);
      const smoothed = current * (1 - params.smoothing) + prior * params.smoothing;
      return round(clamp((smoothed * params.gain) ** params.falloff, 0, 1), 5);
    });
    return metadataResult({ algorithm: "frequency_band_aggregation", bars,
      logarithmic: params.logarithmic, colors: [params.barColor, params.backgroundColor] });
  }
};
