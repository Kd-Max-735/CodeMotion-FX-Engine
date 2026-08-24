import {
  changeRegion,
  frameDifference,
  makeSamplingCandidates,
  percent,
  referenceSimilarity,
  runDedicatedEffectSelfCheck,
  selectEvidenceByActualChange,
  temporalChange,
  type DedicatedSelfCheckProfile,
  type DedicatedSelfCheckRequest
} from "./dedicated-effect-self-check-common.js";

export const BACKGROUND_REMOVE_COMPOSE_RULE_IDS = Object.freeze([
  "BRC_MEDIA_INTEGRITY",
  "BRC_FOREGROUND_PRESERVATION",
  "BRC_BACKGROUND_REPLACEMENT",
  "BRC_EDGE_INTEGRATION",
  "BRC_TEMPORAL_STABILITY",
  "BRC_USER_INTENT"
] as const);

const PROFILE = Object.freeze<DedicatedSelfCheckProfile>({
  toolName: "background_remove_compose",
  displayName: "去背景合成",
  ruleIds: BACKGROUND_REMOVE_COMPOSE_RULE_IDS,
  roleLabels: Object.freeze({
    opening_composite: "开场合成",
    subject_edge_check: "主体边缘检查",
    motion_context: "运动过程",
    background_check: "替换背景检查",
    late_edge_check: "后段边缘检查",
    closing_composite: "收尾合成"
  }),
  candidates: ({ durationSeconds, fps }) => makeSamplingCandidates(durationSeconds, fps, [
    { role: "opening_composite", fraction: 0.04 },
    { role: "subject_edge_check", fraction: 0.18 },
    { role: "motion_context", fraction: 0.38 },
    { role: "background_check", fraction: 0.58 },
    { role: "late_edge_check", fraction: 0.78 },
    { role: "closing_composite", fraction: 0.96 }
  ]),
  analyze: (context) => {
    const selectedSamples = selectEvidenceByActualChange(context.samples, context.width, context.height,
      { minimum: 3, maximum: 6, changeFloor: 2.4 });
    const first = context.samples[0]!;
    const last = context.samples.at(-1)!;
    const temporal = temporalChange(context.samples, context.width, context.height);
    const visibleChange = frameDifference(first.pixels, last.pixels, context.width, context.height);
    const background = context.references.background_image;
    const foreground = context.references.foreground_video;
    const backgroundMatch = background?.length === last.pixels.length
      ? referenceSimilarity(last.pixels, background, context.width, context.height) : undefined;
    const foregroundMatch = foreground?.length === last.pixels.length
      ? referenceSimilarity(last.pixels, foreground, context.width, context.height) : undefined;
    const edgeLevel = last.stats.edgePixelRatio < 0.035 ? "轮廓过渡柔和"
      : last.stats.edgePixelRatio < 0.11 ? "轮廓清晰" : "轮廓细节丰富";
    const subjectState = foregroundMatch === undefined ? "主体在合成画面中可见"
      : foregroundMatch >= 0.72 ? "主体外观保留明显" : foregroundMatch >= 0.48 ? "主体外观有可见融合" : "主体外观变化较大";
    const backgroundState = backgroundMatch === undefined ? "替换背景覆盖画面"
      : backgroundMatch >= 0.75 ? "替换背景占主导" : backgroundMatch >= 0.5 ? "替换背景与主体充分融合" : "替换背景可见但占比有限";
    return Object.freeze({
      description: `最终视频完成去背景合成，${subjectState}，${backgroundState}，${edgeLevel}。`,
      keyInformation: Object.freeze([
        Object.freeze({ label: "特效类型", value: "去背景合成" }),
        Object.freeze({ label: "前景主体", value: subjectState }),
        Object.freeze({ label: "替换背景", value: backgroundState }),
        Object.freeze({ label: "主体边缘", value: edgeLevel }),
        Object.freeze({ label: "合成变化范围", value: `${changeRegion(visibleChange.bounds)}，约占画面 ${percent(visibleChange.changedPixelRatio)}` }),
        Object.freeze({ label: "时间稳定性", value: temporal.state === "stable" ? "前后段合成保持稳定" : "随前景画面连续变化" })
      ]),
      missingInformation: Object.freeze([
        ...(foreground === undefined ? ["前景来源对照"] : []),
        ...(background === undefined ? ["替换背景对照"] : [])
      ]),
      selectedSamples,
      expectsVisibleMotion: false,
      visibleMotionFloor: 1.1
    });
  }
});

export const backgroundRemoveComposeSamplingPlan = PROFILE.candidates;

export async function runBackgroundRemoveComposeSelfCheck(request: DedicatedSelfCheckRequest) {
  return runDedicatedEffectSelfCheck(PROFILE, request);
}
