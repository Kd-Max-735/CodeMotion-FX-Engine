import {
  changeRegion,
  frameDifference,
  makeSamplingCandidates,
  percent,
  runDedicatedEffectSelfCheck,
  selectEvidenceByActualChange,
  temporalChange,
  type DedicatedSelfCheckProfile,
  type DedicatedSelfCheckRequest
} from "./dedicated-effect-self-check-common.js";

export const HANDWRITING_RULE_IDS = Object.freeze([
  "HW_MEDIA_INTEGRITY",
  "HW_STROKE_VISIBILITY",
  "HW_WRITING_PROGRESS",
  "HW_STROKE_CONTINUITY",
  "HW_TEXT_COMPLETENESS",
  "HW_USER_INTENT"
] as const);

const PROFILE = Object.freeze<DedicatedSelfCheckProfile>({
  toolName: "handwriting",
  displayName: "手写笔迹",
  ruleIds: HANDWRITING_RULE_IDS,
  roleLabels: Object.freeze({
    writing_start: "书写起始帧",
    stroke_progress: "笔迹推进帧",
    writing_middle: "书写中段",
    stroke_detail: "笔迹细节帧",
    writing_end: "书写结束帧",
    completion_hold: "书写保持帧"
  }),
  candidates: ({ durationSeconds, fps }) => makeSamplingCandidates(durationSeconds, fps, [
    { role: "writing_start", fraction: 0.03 },
    { role: "stroke_progress", fraction: 0.18 },
    { role: "writing_middle", fraction: 0.38 },
    { role: "stroke_detail", fraction: 0.58 },
    { role: "writing_end", fraction: 0.78 },
    { role: "completion_hold", fraction: 0.96 }
  ]),
  analyze: (context) => {
    const selectedSamples = selectEvidenceByActualChange(context.samples, context.width, context.height,
      { minimum: 3, maximum: 6, changeFloor: 0.85 });
    const first = context.samples[0]!;
    const last = context.samples.at(-1)!;
    const background = context.references.source_image;
    const basis = background?.length === last.pixels.length ? background : first.pixels;
    const stroke = frameDifference(basis, last.pixels, context.width, context.height, 16);
    const temporal = temporalChange(context.samples, context.width, context.height);
    const beforeHold = context.samples.at(-2) ?? first;
    const holdDifference = frameDifference(beforeHold.pixels, last.pixels, context.width, context.height).meanRgbDifference;
    const progress = temporal.state === "stable" ? "笔迹在抽检范围内保持同一进度" : "笔迹沿时间逐步延伸";
    const continuity = last.stats.edgePixelRatio < 0.012 ? "笔迹较淡或覆盖有限"
      : last.stats.edgePixelRatio < 0.12 ? "笔迹连贯清晰" : "笔迹细节密集";
    const completion = stroke.changedPixelRatio < 0.0003 ? "未观察到明确笔迹"
      : holdDifference < 1.1 ? "结束笔迹稳定保留" : "结束阶段仍在书写";
    return Object.freeze({
      description: `最终视频呈现手写笔迹，${progress}，${continuity}，${completion}。`,
      keyInformation: Object.freeze([
        Object.freeze({ label: "特效类型", value: "手写笔迹" }),
        Object.freeze({ label: "笔迹范围", value: `${changeRegion(stroke.bounds)}，约占画面 ${percent(stroke.changedPixelRatio)}` }),
        Object.freeze({ label: "笔迹进度", value: progress }),
        Object.freeze({ label: "笔迹连续性", value: continuity }),
        Object.freeze({ label: "文字完成状态", value: completion }),
        Object.freeze({ label: "结束保持", value: holdDifference < 1.1 ? "稳定" : "仍有变化" })
      ]),
      missingInformation: Object.freeze(stroke.changedPixelRatio < 0.0003 ? ["可见笔迹"] : []),
      selectedSamples,
      expectsVisibleMotion: false,
      visibleMotionFloor: 0.85
    });
  }
});

export const handwritingSamplingPlan = PROFILE.candidates;

export async function runHandwritingSelfCheck(request: DedicatedSelfCheckRequest) {
  return runDedicatedEffectSelfCheck(PROFILE, request);
}
