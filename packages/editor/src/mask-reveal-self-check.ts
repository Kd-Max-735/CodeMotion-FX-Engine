import {
  changeRegion,
  finite,
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

export const MASK_REVEAL_RULE_IDS = Object.freeze([
  "MR_MEDIA_INTEGRITY",
  "MR_MASK_COVERAGE",
  "MR_REVEAL_PROGRESSION",
  "MR_UNCOVERED_REGION_PRESERVATION",
  "MR_EDGE_FEATHERING",
  "MR_USER_INTENT"
] as const);

const PROFILE = Object.freeze<DedicatedSelfCheckProfile>({
  toolName: "mask_reveal",
  displayName: "遮罩显现",
  ruleIds: MASK_REVEAL_RULE_IDS,
  roleLabels: Object.freeze({
    mask_start: "遮罩起始帧",
    coverage_growth: "遮罩扩展帧",
    mask_middle: "遮罩中段",
    boundary_check: "遮罩边界帧",
    mask_complete: "遮罩完成帧",
    completion_hold: "完成保持帧"
  }),
  candidates: ({ durationSeconds, fps, params }) => {
    const activeDuration = Math.min(durationSeconds * 0.92, Math.max(0.1, finite(params.duration, durationSeconds * 0.5)));
    return makeSamplingCandidates(durationSeconds, fps, [
      { role: "mask_start", time: 0 },
      { role: "coverage_growth", time: activeDuration * 0.2 },
      { role: "mask_middle", time: activeDuration * 0.45 },
      { role: "boundary_check", time: activeDuration * 0.7 },
      { role: "mask_complete", time: activeDuration },
      { role: "completion_hold", fraction: 0.96 }
    ]);
  },
  analyze: (context) => {
    const selectedSamples = selectEvidenceByActualChange(context.samples, context.width, context.height,
      { minimum: 3, maximum: 6, changeFloor: 1.55 });
    const first = context.samples[0]!;
    const last = context.samples.at(-1)!;
    const source = context.references.source_frame;
    const target = context.references.target_frame;
    const targetMatch = target?.length === last.pixels.length
      ? referenceSimilarity(last.pixels, target, context.width, context.height) : undefined;
    const sourceMatch = source?.length === last.pixels.length
      ? referenceSimilarity(last.pixels, source, context.width, context.height) : undefined;
    const coverage = frameDifference(first.pixels, last.pixels, context.width, context.height, 20);
    const temporal = temporalChange(context.samples, context.width, context.height);
    const targetState = targetMatch === undefined ? "遮罩区域内已显现目标画面"
      : targetMatch >= 0.84 ? "目标画面接近完整显现" : targetMatch >= 0.58 ? "目标画面部分显现" : "目标画面显现范围较小";
    const uncovered = sourceMatch === undefined || targetMatch === undefined ? "未覆盖区域保留原画面"
      : sourceMatch > 0.45 ? "未覆盖区域仍保留可见源画面" : "源画面保留较少";
    const edge = last.stats.edgePixelRatio < 0.025 ? "遮罩边缘柔和"
      : last.stats.edgePixelRatio < 0.12 ? "遮罩边界清晰" : "遮罩边界细节丰富";
    return Object.freeze({
      description: `最终视频呈现遮罩显现，${targetState}，${uncovered}，${edge}。`,
      keyInformation: Object.freeze([
        Object.freeze({ label: "特效类型", value: "遮罩显现" }),
        Object.freeze({ label: "遮罩覆盖", value: `${changeRegion(coverage.bounds)}，约占画面 ${percent(coverage.changedPixelRatio)}` }),
        Object.freeze({ label: "目标画面", value: targetState }),
        Object.freeze({ label: "未覆盖区域", value: uncovered }),
        Object.freeze({ label: "遮罩边缘", value: edge }),
        Object.freeze({ label: "显现过程", value: temporal.state === "stable" ? "遮罩状态保持稳定" : "遮罩覆盖连续推进" })
      ]),
      missingInformation: Object.freeze([
        ...(source === undefined ? ["源画面对照"] : []),
        ...(target === undefined ? ["目标画面对照"] : [])
      ]),
      selectedSamples,
      expectsVisibleMotion: finite(context.params.duration) > 0,
      visibleMotionFloor: 1.55
    });
  }
});

export const maskRevealSamplingPlan = PROFILE.candidates;

export async function runMaskRevealSelfCheck(request: DedicatedSelfCheckRequest) {
  return runDedicatedEffectSelfCheck(PROFILE, request);
}
