import {
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

export const BLEND_RULE_IDS = Object.freeze([
  "BL_MEDIA_INTEGRITY",
  "BL_LAYER_CONTRIBUTION",
  "BL_VISUAL_RESULT",
  "BL_FRAME_STABILITY",
  "BL_USER_INTENT"
] as const);

const PROFILE = Object.freeze<DedicatedSelfCheckProfile>({
  toolName: "blend",
  displayName: "图层混合",
  ruleIds: BLEND_RULE_IDS,
  roleLabels: Object.freeze({
    early_mix: "前段混合结果",
    middle_mix: "中段混合结果",
    late_mix: "后段混合结果",
    stability_probe: "稳定性检查",
    final_mix: "最终混合结果"
  }),
  candidates: ({ durationSeconds, fps }) => makeSamplingCandidates(durationSeconds, fps, [
    { role: "early_mix", fraction: 0.08 },
    { role: "stability_probe", fraction: 0.28 },
    { role: "middle_mix", fraction: 0.5 },
    { role: "stability_probe", fraction: 0.72 },
    { role: "final_mix", fraction: 0.92 }
  ]),
  analyze: (context) => {
    const selectedSamples = selectEvidenceByActualChange(context.samples, context.width, context.height,
      { minimum: 3, maximum: 5, changeFloor: 1.25 });
    const final = context.samples.at(-1)!;
    const source = context.references.source_layer;
    const overlay = context.references.overlay_layer;
    const sourceMatch = source?.length === final.pixels.length
      ? referenceSimilarity(final.pixels, source, context.width, context.height) : undefined;
    const overlayMatch = overlay?.length === final.pixels.length
      ? referenceSimilarity(final.pixels, overlay, context.width, context.height) : undefined;
    const mixState = sourceMatch === undefined || overlayMatch === undefined ? "画面呈现统一混合结果"
      : Math.abs(sourceMatch - overlayMatch) < 0.08 ? "两层贡献较均衡"
        : sourceMatch > overlayMatch ? "底层画面保留更明显" : "叠加层画面更突出";
    const brightness = final.stats.meanLuminance < 70 ? "整体偏暗"
      : final.stats.meanLuminance > 180 ? "整体偏亮" : "整体明暗均衡";
    const color = final.stats.meanSaturation < 0.12 ? "色彩克制"
      : final.stats.meanSaturation > 0.5 ? "色彩鲜明" : "色彩自然";
    const temporal = temporalChange(context.samples, context.width, context.height);
    const totalChange = frameDifference(context.samples[0]!.pixels, final.pixels, context.width, context.height);
    return Object.freeze({
      description: `最终视频形成稳定的图层混合，${mixState}，${brightness}，${color}。`,
      keyInformation: Object.freeze([
        Object.freeze({ label: "特效类型", value: "图层混合" }),
        Object.freeze({ label: "图层贡献", value: mixState }),
        Object.freeze({ label: "明暗结果", value: brightness }),
        Object.freeze({ label: "色彩结果", value: color }),
        Object.freeze({ label: "混合覆盖", value: totalChange.changedPixelRatio < 0.001 ? "全片保持同一混合画面" : `画面变化约 ${percent(totalChange.changedPixelRatio)}` }),
        Object.freeze({ label: "时间表现", value: temporal.state === "stable" ? "混合结果稳定" : "混合画面随素材连续变化" })
      ]),
      missingInformation: Object.freeze([
        ...(source === undefined ? ["底层画面对照"] : []),
        ...(overlay === undefined ? ["叠加层画面对照"] : [])
      ]),
      selectedSamples,
      expectsVisibleMotion: false,
      visibleMotionFloor: 0.7
    });
  }
});

export const blendSamplingPlan = PROFILE.candidates;

export async function runBlendSelfCheck(request: DedicatedSelfCheckRequest) {
  return runDedicatedEffectSelfCheck(PROFILE, request);
}
