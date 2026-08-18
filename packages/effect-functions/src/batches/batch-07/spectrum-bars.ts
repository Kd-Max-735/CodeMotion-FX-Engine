import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { COLOR_SCHEMA, REJECT_FALLBACK, SERVER_CPU_BACKEND, audioScalar, audioSeries, clamp,
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
function spectralMagnitude(samples: readonly number[], offset: number, bin: number): number {
  const windowSize = Math.min(256, samples.length);
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < windowSize; index += 1) {
    const sample = samples[(offset + index + samples.length) % samples.length]!;
    const window = 0.5 - 0.5 * Math.cos(index / Math.max(1, windowSize - 1) * Math.PI * 2);
    const angle = Math.PI * 2 * bin * index / windowSize;
    real += sample * window * Math.cos(angle);
    imaginary -= sample * window * Math.sin(angle);
  }
  return Math.min(1, Math.hypot(real, imaginary) / Math.max(1, windowSize * 0.16));
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
    const samples = audioSeries(context, "waveformSamples", 65_536, -1, 1);
    const sampleRate = audioScalar(context, "sampleRate", 48_000);
    const duration = audioScalar(context, "duration", samples.length / sampleRate);
    const offset = Math.floor((context.time % duration) / duration * samples.length) % samples.length;
    const previousOffset = offset - Math.floor(sampleRate / Math.max(1, context.fps));
    const bars = Array.from({ length: params.barCount }, (_, index) => {
      const ratio = (index + 0.5) / params.barCount;
      const bin = Math.max(1, Math.round(params.logarithmic
        ? Math.exp(ratio * Math.log(112)) : 1 + ratio * 111));
      const current = spectralMagnitude(samples, offset, bin);
      const prior = spectralMagnitude(samples, previousOffset, bin);
      const smoothed = current * (1 - params.smoothing) + prior * params.smoothing;
      return round(clamp((smoothed * params.gain) ** params.falloff, 0, 1), 5);
    });
    return metadataResult({ algorithm: "frequency_band_aggregation", bars,
      logarithmic: params.logarithmic, colors: [params.barColor, params.backgroundColor] });
  }
};
