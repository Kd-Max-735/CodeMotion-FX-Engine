import {
  changeRegion,
  finite,
  frameDifference,
  makeSamplingCandidates,
  percent,
  runDedicatedEffectSelfCheck,
  selectEvidenceByActualChange,
  temporalChange,
  type DedicatedSelfCheckProfile,
  type DedicatedSelfCheckRequest,
  type DedicatedVisualSample
} from "./dedicated-effect-self-check-common.js";

export const PAINT_ON_RULE_IDS = Object.freeze([
  "PO_MEDIA_INTEGRITY",
  "PO_STROKE_PROGRESSION",
  "PO_REVEALED_COVERAGE",
  "PO_STROKE_CONTINUITY",
  "PO_COMPLETION_HOLD",
  "PO_USER_INTENT"
] as const);

function matchingPixelRatio(sample: DedicatedVisualSample, reference: Uint8Array, width: number, height: number): number {
  let matching = 0;
  const pixels = Math.min(width * height, Math.floor(reference.length / 4));
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const difference = (Math.abs(sample.pixels[offset]! - reference[offset]!)
      + Math.abs(sample.pixels[offset + 1]! - reference[offset + 1]!)
      + Math.abs(sample.pixels[offset + 2]! - reference[offset + 2]!)) / 3;
    if (difference < 18) matching += 1;
  }
  return matching / Math.max(1, pixels);
}

const PROFILE = Object.freeze<DedicatedSelfCheckProfile>({
  toolName: "paint_on",
  displayName: "逐笔绘制显现",
  ruleIds: PAINT_ON_RULE_IDS,
  roleLabels: Object.freeze({
    paint_start: "绘制起始帧",
    stroke_progress: "笔触推进帧",
    paint_middle: "绘制中段",
    coverage_check: "覆盖检查帧",
    paint_complete: "绘制完成帧",
    completion_hold: "完成保持帧"
  }),
  candidates: ({ durationSeconds, fps, params }) => {
    const activeDuration = Math.min(durationSeconds * 0.92, Math.max(0.1, finite(params.duration, durationSeconds * 0.7)));
    return makeSamplingCandidates(durationSeconds, fps, [
      { role: "paint_start", time: 0 },
      { role: "stroke_progress", time: activeDuration * 0.15 },
      { role: "stroke_progress", time: activeDuration * 0.32 },
      { role: "paint_middle", time: activeDuration * 0.5 },
      { role: "coverage_check", time: activeDuration * 0.7 },
      { role: "coverage_check", time: activeDuration * 0.88 },
      { role: "paint_complete", time: activeDuration },
      { role: "completion_hold", fraction: 0.96 }
    ]);
  },
  analyze: (context) => {
    const selectedSamples = selectEvidenceByActualChange(context.samples, context.width, context.height,
      { minimum: 3, maximum: 7, changeFloor: 1.25 });
    const first = context.samples[0]!;
    const last = context.samples.at(-1)!;
    const source = context.references.source_image;
    const firstMatch = source?.length === last.pixels.length
      ? matchingPixelRatio(first, source, context.width, context.height) : undefined;
    const finalMatch = source?.length === last.pixels.length
      ? matchingPixelRatio(last, source, context.width, context.height) : undefined;
    const painted = frameDifference(first.pixels, last.pixels, context.width, context.height, 18);
    const temporal = temporalChange(context.samples, context.width, context.height);
    const beforeHold = context.samples.at(-2) ?? first;
    const holdDifference = frameDifference(beforeHold.pixels, last.pixels, context.width, context.height).meanRgbDifference;
    const progress = temporal.state === "stable" ? "抽检范围内绘制状态不变" : "笔触按时间逐步推进";
    const reveal = finalMatch === undefined ? `可见绘制区域约占画面 ${percent(painted.changedPixelRatio)}`
      : `与原画面一致的已绘制区域由 ${percent(firstMatch ?? 0)} 增至 ${percent(finalMatch)}`;
    const continuity = last.stats.edgePixelRatio < 0.018 ? "笔触覆盖较柔和"
      : last.stats.edgePixelRatio < 0.13 ? "笔触边界连续清晰" : "笔触边界细节丰富";
    return Object.freeze({
      description: `最终视频完成逐笔绘制显现，${progress}，${reveal}，${continuity}。`,
      keyInformation: Object.freeze([
        Object.freeze({ label: "特效类型", value: "逐笔绘制显现" }),
        Object.freeze({ label: "笔触推进", value: progress }),
        Object.freeze({ label: "已绘制范围", value: reveal }),
        Object.freeze({ label: "绘制区域", value: `${changeRegion(painted.bounds)}，约占画面 ${percent(painted.changedPixelRatio)}` }),
        Object.freeze({ label: "笔触连续性", value: continuity }),
        Object.freeze({ label: "完成保持", value: holdDifference < 1.25 ? "完成后稳定保持" : "收尾仍有绘制变化" })
      ]),
      missingInformation: Object.freeze(source === undefined ? ["原画面对照"] : []),
      selectedSamples,
      expectsVisibleMotion: finite(context.params.duration) > 0,
      visibleMotionFloor: 1.25
    });
  }
});

export const paintOnSamplingPlan = PROFILE.candidates;

export async function runPaintOnSelfCheck(request: DedicatedSelfCheckRequest) {
  return runDedicatedEffectSelfCheck(PROFILE, request);
}
