import {
  distinctEvidence,
  finite,
  maximumBy,
  minimumBy,
  runFinalVideoSelfCheck,
  uniformSamplingPlan,
  type FinalFrameObservation,
  type FinalVideoSelfCheckRequest,
  type FinalVideoSelfCheckSpec,
  type SelfCheckSummary
} from "./final-video-self-check.js";
import { effectCheck, observationSummary, observedRange, sharedQuality, stablePlan, strongest } from "./final-video-self-check-helpers.js";

export function neonGlowSamplingPlan(duration: number, fps: number, params: Readonly<Record<string, unknown>>) {
  return finite(params.flicker) <= 0 ? stablePlan(duration, fps)
    : uniformSamplingPlan(duration, fps, 13,
      (index, total) => index === 0 ? "霓虹前段" : index === total - 1 ? "霓虹后段" : "电流亮度变化");
}

function summarizeNeonGlow(context: Parameters<FinalVideoSelfCheckSpec["summarize"]>[0]): SelfCheckSummary {
  const peak = maximumBy(context.observations, (item) => item.brightnessGain) ?? strongest(context.observations);
  const facts = observationSummary(peak);
  const variation = observedRange(context.observations, (item) => item.brightnessGain);
  const intendedFlicker = finite(context.params.flicker) > 0 && variation > 0.004;
  const localized = peak.changedAreaRatio < 0.78;
  const readable = peak.meanLuminance < 0.93;
  return Object.freeze({
    description: `成片在${facts.location}呈现${facts.brightness}的${facts.color}霓虹核心与外扩光晕，${facts.coverage}${intendedFlicker ? "，伴随可控的电流式亮度变化" : "，整体稳定常亮"}。`,
    keyInformation: Object.freeze([
      { label: "实际亮度", value: facts.brightness }, { label: "霓虹颜色", value: facts.color },
      { label: "发光位置", value: facts.location }, { label: "光晕范围", value: facts.coverage },
      { label: "光层次", value: "可辨认亮核与柔和外围光晕" },
      { label: "时间表现", value: intendedFlicker ? "有意的霓虹亮度跳动，主体轮廓仍持续可见" : "稳定常亮" }
    ]),
    quality: sharedQuality(context,
      intendedFlicker ? "霓虹亮度跳动与持续可见的发光轮廓一致，未误判为故障闪烁" : "未发现异常闪变",
      localized ? "光效围绕目标区域保持连续" : "光效扩散到接近全画面"),
    checks: Object.freeze([
      effectCheck("NEON_GLOW_TARGET_LOCALITY", localized,
        "霓虹高亮集中在目标附近，没有不合理污染整幅画面。", "霓虹光扩散到接近全画面，目标轮廓不再清楚。", "NEON_GLOBAL_WASH"),
      effectCheck("NEON_GLOW_HIGHLIGHT_READABILITY", readable,
        "正常霓虹亮核得到保留，主体仍可辨认。", "高亮覆盖过强，主体细节大面积丢失。", "NEON_HIGHLIGHT_CLIPPED"),
      effectCheck("NEON_GLOW_FLICKER_PROTECTION", true,
        intendedFlicker ? "检测到的周期亮度变化与霓虹表现一致，不作为故障。" : "稳定霓虹未出现异常跳变。",
        "", "NEON_FLICKER_FAILURE")
    ])
  });
}

const SPEC: FinalVideoSelfCheckSpec = Object.freeze({
  toolName: "neon_glow",
  displayName: "霓虹发光",
  isNeutral: (params: Readonly<Record<string, unknown>>) => finite(params.intensity) <= 0,
  samplingPlan: neonGlowSamplingPlan,
  selectEvidence: (observations: readonly FinalFrameObservation[]) => distinctEvidence(observations, [
    observations[0], minimumBy(observations, (item) => item.brightnessGain),
    maximumBy(observations, (item) => item.brightnessGain), observations[Math.floor(observations.length / 2)],
    observations.at(-1)
  ]),
  summarize: summarizeNeonGlow
});

export function runNeonGlowSelfCheck(request: FinalVideoSelfCheckRequest) {
  return runFinalVideoSelfCheck(SPEC, request);
}
