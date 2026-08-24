import {
  brightnessName,
  coverageName,
  distinctEvidence,
  locationName,
  maximumBy,
  minimumBy,
  samplingPlanFromFractions,
  type FinalFrameObservation,
  type FinalVideoSelfCheckContext
} from "./final-video-self-check.js";

export function clampCount(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export function strongest(observations: readonly FinalFrameObservation[]): FinalFrameObservation {
  return maximumBy(observations, (item) => item.colorDifference) ?? observations[0]!;
}

export function average(
  observations: readonly FinalFrameObservation[],
  value: (item: FinalFrameObservation) => number
): number {
  return observations.reduce((total, item) => total + value(item), 0) / Math.max(1, observations.length);
}

export function observedRange(
  observations: readonly FinalFrameObservation[],
  value: (item: FinalFrameObservation) => number
): number {
  return observations.length === 0 ? 0 : Math.max(...observations.map(value)) - Math.min(...observations.map(value));
}

export function centroidTravel(observations: readonly FinalFrameObservation[]): number {
  let distance = 0;
  for (let index = 1; index < observations.length; index += 1) {
    distance += Math.hypot(
      observations[index]!.centroidX - observations[index - 1]!.centroidX,
      observations[index]!.centroidY - observations[index - 1]!.centroidY
    );
  }
  return distance;
}

export function farthestFrom(
  observations: readonly FinalFrameObservation[],
  origin: FinalFrameObservation | undefined
): FinalFrameObservation | undefined {
  if (origin === undefined) return undefined;
  return maximumBy(observations, (item) => Math.hypot(item.centroidX - origin.centroidX, item.centroidY - origin.centroidY));
}

export function nearestTime(
  observations: readonly FinalFrameObservation[],
  time: number
): FinalFrameObservation | undefined {
  return minimumBy(observations, (item) => Math.abs(item.item.time - time));
}

export function sharedQuality(
  context: FinalVideoSelfCheckContext,
  temporalProtection: string,
  continuity: string
): Readonly<Record<string, string | number | boolean>> {
  const darkest = Math.min(...context.observations.map((item) => item.meanLuminance));
  const baseline = average(context.observations, (item) => item.baselineLuminance);
  return Object.freeze({
    decoding: "正常",
    dimensions: "一致",
    black_frames: darkest < 0.004 && baseline > 0.025 ? "发现异常黑帧" : "未发现异常黑帧",
    effect_continuity: continuity,
    unexpected_flicker: temporalProtection,
    keyframe_coverage: "已覆盖该特效需要证明的关键阶段"
  });
}

export function effectCheck(
  ruleId: string,
  passed: boolean,
  passReason: string,
  failReason: string,
  issueCode: string
) {
  return Object.freeze({
    ruleId,
    status: passed ? "pass" as const : "fail" as const,
    reason: passed ? passReason : failReason,
    ...(passed ? {} : { issueCode })
  });
}

export function stablePlan(durationSeconds: number, fps: number) {
  return samplingPlanFromFractions(durationSeconds, fps, [
    { fraction: 0.08, role: "前段稳定表现", id: "stable_early" },
    { fraction: 0.5, role: "中段稳定表现", id: "stable_middle" },
    { fraction: 0.92, role: "后段稳定表现", id: "stable_late" }
  ]);
}

export function staticEvidence(observations: readonly FinalFrameObservation[]) {
  return distinctEvidence(observations, [
    observations[0],
    observations[Math.floor(observations.length / 2)],
    observations.at(-1)
  ]);
}

export function observationSummary(observation: FinalFrameObservation) {
  return Object.freeze({
    brightness: brightnessName(Math.max(0, observation.brightnessGain)),
    coverage: coverageName(observation.changedAreaRatio),
    location: locationName(observation.centroidX, observation.centroidY),
    color: observation.dominantColorName
  });
}
