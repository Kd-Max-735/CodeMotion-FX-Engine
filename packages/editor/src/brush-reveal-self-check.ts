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

export const BRUSH_REVEAL_RULE_IDS = Object.freeze([
  "BR_MEDIA_INTEGRITY",
  "BR_REVEAL_COVERAGE",
  "BR_BRUSH_EDGE_CHARACTER",
  "BR_SOURCE_TARGET_TRANSITION",
  "BR_COMPLETION_STATE",
  "BR_USER_INTENT"
] as const);

const PROFILE = Object.freeze<DedicatedSelfCheckProfile>({
  toolName: "brush_reveal",
  displayName: "笔刷显现",
  ruleIds: BRUSH_REVEAL_RULE_IDS,
  roleLabels: Object.freeze({
    brush_start: "笔刷起始帧",
    brush_pass: "笔刷经过帧",
    reveal_middle: "显现中段",
    bristle_detail: "笔刷边缘帧",
    reveal_end: "显现结束帧",
    completion_hold: "完成保持帧"
  }),
  candidates: ({ durationSeconds, fps }) => makeSamplingCandidates(durationSeconds, fps, [
    { role: "brush_start", fraction: 0.03 },
    { role: "brush_pass", fraction: 0.2 },
    { role: "reveal_middle", fraction: 0.42 },
    { role: "bristle_detail", fraction: 0.64 },
    { role: "reveal_end", fraction: 0.82 },
    { role: "completion_hold", fraction: 0.96 }
  ]),
  analyze: (context) => {
    const selectedSamples = selectEvidenceByActualChange(context.samples, context.width, context.height,
      { minimum: 3, maximum: 6, changeFloor: 1.35 });
    const first = context.samples[0]!;
    const last = context.samples.at(-1)!;
    const source = context.references.source_frame;
    const target = context.references.target_frame;
    const sourceMatch = source?.length === last.pixels.length
      ? referenceSimilarity(last.pixels, source, context.width, context.height) : undefined;
    const targetMatch = target?.length === last.pixels.length
      ? referenceSimilarity(last.pixels, target, context.width, context.height) : undefined;
    const revealChange = frameDifference(first.pixels, last.pixels, context.width, context.height, 20);
    const temporal = temporalChange(context.samples, context.width, context.height);
    const targetState = targetMatch === undefined ? "目标画面已形成可见显现区域"
      : targetMatch >= 0.82 ? "目标画面大范围显现" : targetMatch >= 0.58 ? "目标画面部分显现" : "目标画面显现有限";
    const layerState = sourceMatch === undefined || targetMatch === undefined ? "源画面与显现画面形成过渡"
      : targetMatch > sourceMatch ? "结束画面更接近目标画面" : "结束画面仍较多保留源画面";
    const brushEdge = last.stats.edgePixelRatio < 0.025 ? "笔刷边缘柔和"
      : last.stats.edgePixelRatio < 0.13 ? "笔刷边缘清晰" : "笔刷纹理边缘丰富";
    return Object.freeze({
      description: `最终视频完成笔刷显现，${targetState}，${brushEdge}，${layerState}。`,
      keyInformation: Object.freeze([
        Object.freeze({ label: "特效类型", value: "笔刷显现" }),
        Object.freeze({ label: "目标画面显现", value: targetState }),
        Object.freeze({ label: "源目标过渡", value: layerState }),
        Object.freeze({ label: "笔刷边缘", value: brushEdge }),
        Object.freeze({ label: "显现覆盖", value: `${changeRegion(revealChange.bounds)}，约占画面 ${percent(revealChange.changedPixelRatio)}` }),
        Object.freeze({ label: "时间表现", value: temporal.state === "stable" ? "显现状态保持稳定" : "笔刷覆盖随时间推进" })
      ]),
      missingInformation: Object.freeze([
        ...(source === undefined ? ["源画面对照"] : []),
        ...(target === undefined ? ["目标画面对照"] : [])
      ]),
      selectedSamples,
      expectsVisibleMotion: false,
      visibleMotionFloor: 1.35
    });
  }
});

export const brushRevealSamplingPlan = PROFILE.candidates;

export async function runBrushRevealSelfCheck(request: DedicatedSelfCheckRequest) {
  return runDedicatedEffectSelfCheck(PROFILE, request);
}
