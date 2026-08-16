import {
  assertExactKeys,
  clamp,
  finiteNumber,
  isRecord,
  unitNumber
} from "./common.js";

export interface AudioAnalysisFrame {
  readonly time: number;
  readonly rms: number;
  readonly peak: number;
  readonly bass: number;
  readonly mid: number;
  readonly vocal: number;
  readonly high: number;
  readonly beatConfidence: number;
  readonly onsetStrength: number;
}

export interface AudioAnalysisBinding {
  readonly version: "audio-analysis-v1";
  readonly duration: number;
  readonly frames: readonly AudioAnalysisFrame[];
}

const FRAME_KEYS = Object.freeze([
  "time", "rms", "peak", "bass", "mid", "vocal", "high", "beatConfidence",
  "onsetStrength"
]);

export const MAX_AUDIO_ANALYSIS_FRAMES = 7_201;

export function parseAudioAnalysis(value: unknown): AudioAnalysisBinding {
  if (!isRecord(value)) throw new TypeError("audio analysis must be an object.");
  assertExactKeys(value, ["version", "duration", "frames"], "audio analysis");
  if (value.version !== "audio-analysis-v1") {
    throw new TypeError("audio analysis version is unsupported.");
  }
  const duration = finiteNumber(value.duration, "audio analysis duration");
  if (duration <= 0) throw new RangeError("audio analysis duration must be positive.");
  if (!Array.isArray(value.frames) || value.frames.length === 0
    || value.frames.length > MAX_AUDIO_ANALYSIS_FRAMES) {
    throw new TypeError(
      `audio analysis requires between 1 and ${MAX_AUDIO_ANALYSIS_FRAMES} frames.`
    );
  }
  let previousTime = -1;
  const frames = value.frames.map((candidate, index): AudioAnalysisFrame => {
    if (!isRecord(candidate)) throw new TypeError(`audio frame ${index} must be an object.`);
    assertExactKeys(candidate, FRAME_KEYS, `audio frame ${index}`);
    const time = finiteNumber(candidate.time, `audio frame ${index} time`);
    if (time < 0 || time > duration || time < previousTime) {
      throw new RangeError(`audio frame ${index} time is outside the ordered analysis range.`);
    }
    previousTime = time;
    return Object.freeze({
      time,
      rms: unitNumber(candidate.rms, `audio frame ${index} rms`),
      peak: unitNumber(candidate.peak, `audio frame ${index} peak`),
      bass: unitNumber(candidate.bass, `audio frame ${index} bass`),
      mid: unitNumber(candidate.mid, `audio frame ${index} mid`),
      vocal: unitNumber(candidate.vocal, `audio frame ${index} vocal`),
      high: unitNumber(candidate.high, `audio frame ${index} high`),
      beatConfidence: unitNumber(candidate.beatConfidence, `audio frame ${index} beatConfidence`),
      onsetStrength: unitNumber(candidate.onsetStrength, `audio frame ${index} onsetStrength`)
    });
  });
  return Object.freeze({ version: "audio-analysis-v1", duration, frames: Object.freeze(frames) });
}

export function frameAt(analysis: AudioAnalysisBinding, time: number): AudioAnalysisFrame {
  const target = clamp(time, 0, analysis.duration);
  let best = analysis.frames[0]!;
  for (const frame of analysis.frames) {
    if (Math.abs(frame.time - target) < Math.abs(best.time - target)) best = frame;
  }
  return best;
}

export function smoothedBand(
  analysis: AudioAnalysisBinding,
  time: number,
  smoothing: number,
  select: (frame: AudioAnalysisFrame) => number
): number {
  const window = Math.max(0.001, smoothing * 0.5);
  let weightTotal = 0;
  let valueTotal = 0;
  for (const frame of analysis.frames) {
    const distance = Math.abs(frame.time - time);
    if (distance > window) continue;
    const weight = 1 - distance / window;
    weightTotal += weight;
    valueTotal += select(frame) * weight;
  }
  return weightTotal === 0 ? select(frameAt(analysis, time)) : valueTotal / weightTotal;
}
