import type { AnalyzedFrame, EffectFacts, SelectedFrame } from "../visual-effect-self-check.js";

export function semantic(value: number, low: number, high: number,
  labels: readonly [string, string, string]): string {
  return value <= low ? labels[0] : value <= high ? labels[1] : labels[2];
}

export function temporalSummary(frames: readonly AnalyzedFrame[], jumpThreshold: number, stableThreshold: number): {
  continuity: EffectFacts["continuity"];
  average: number;
  peak: number;
} {
  const changes = frames.slice(1).map((frame) => frame.changeFromPrevious);
  const average = changes.reduce((sum, value) => sum + value, 0) / Math.max(1, changes.length);
  const peak = changes.length === 0 ? 0 : Math.max(...changes);
  return {
    continuity: peak > Math.max(jumpThreshold, average * 4.5) ? "存在突跳"
      : average <= stableThreshold ? "稳定" : "连续",
    average,
    peak
  };
}

export function commonInfo(name: string): Readonly<{ label: string; value: string }> {
  return Object.freeze({ label: "特效类型", value: name });
}

export function selectedFrame(frame: AnalyzedFrame, role: string, ordinal: number): SelectedFrame {
  return Object.freeze({ ...frame, role, imageId: `keyframe_${String(ordinal).padStart(2, "0")}` });
}

export function diverseSelection(frames: readonly AnalyzedFrame[], roles: readonly string[],
  minimumChange: number, maximum: number): readonly SelectedFrame[] {
  if (frames.length === 0) return Object.freeze([]);
  const indexes = new Set<number>([0, frames.length - 1]);
  const ranked = frames.slice(1, -1).map((frame, index) => ({ index: index + 1, score: frame.changeFromPrevious }))
    .sort((a, b) => b.score - a.score);
  for (const item of ranked) {
    if (indexes.size >= maximum || item.score < minimumChange) break;
    indexes.add(item.index);
  }
  if (indexes.size < Math.min(3, frames.length)) indexes.add(Math.floor((frames.length - 1) / 2));
  return Object.freeze([...indexes].sort((a, b) => a - b).map((index, ordinal) =>
    selectedFrame(frames[index]!, roles[Math.min(ordinal, roles.length - 1)]!, ordinal + 1)));
}

export function frameDifference(before: AnalyzedFrame, after: AnalyzedFrame): number {
  if (before.width !== after.width || before.height !== after.height || before.pixels.length !== after.pixels.length) return 1;
  let difference = 0;
  for (let offset = 0; offset < after.pixels.length; offset += 4) {
    difference += Math.abs(after.pixels[offset]! - before.pixels[offset]!)
      + Math.abs(after.pixels[offset + 1]! - before.pixels[offset + 1]!)
      + Math.abs(after.pixels[offset + 2]! - before.pixels[offset + 2]!);
  }
  return difference / Math.max(1, after.width * after.height * 3 * 255);
}
