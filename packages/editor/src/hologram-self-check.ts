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
import { centroidTravel, effectCheck, farthestFrom, observationSummary, observedRange, sharedQuality, strongest } from "./final-video-self-check-helpers.js";

export function hologramSamplingPlan(duration: number, fps: number, params: Readonly<Record<string, unknown>>) {
  const dynamic = finite(params.flicker) > 0 || finite(params.glitch) > 0 || finite(params.scanline) > 0;
  return uniformSamplingPlan(duration, fps, dynamic ? 15 : 5,
    (index, total) => index === 0 ? "全息出现" : index === total - 1 ? "全息后段" : "扫描与故障变化");
}

function summarizeHologram(context: Parameters<FinalVideoSelfCheckSpec["summarize"]>[0]): SelfCheckSummary {
  const peak = maximumBy(context.observations, (item) => item.brightnessGain) ?? strongest(context.observations);
  const facts = observationSummary(peak);
  const modulation = observedRange(context.observations, (item) => item.brightnessGain);
  const scanlines = Math.max(...context.observations.map((item) => item.scanlinePresence));
  const unstable = modulation > 0.008 || centroidTravel(context.observations) > 0.035;
  const readable = peak.meanLuminance < 0.93 && peak.changedAreaRatio < 0.98;
  return Object.freeze({
    description: `全息投影呈${facts.color}自发光材质，亮度${facts.brightness}，扫描纹理${scanlines > 0.025 ? "清楚" : "较轻"}，${unstable ? "伴随受控抖动与故障位移" : "整体稳定"}。`,
    keyInformation: Object.freeze([
      { label: "投影亮度", value: facts.brightness }, { label: "投影颜色", value: facts.color },
      { label: "投影位置", value: facts.location }, { label: "覆盖范围", value: facts.coverage },
      { label: "扫描表现", value: scanlines > 0.025 ? "横向扫描纹理清楚并持续存在" : "扫描纹理较轻" },
      { label: "全息抖动", value: unstable ? "有意的闪烁和横向故障偏移，主体仍持续可见" : "整体稳定" },
      { label: "深度层次", value: "前后亮度与位移差异形成投影层次" },
      { label: "主体可读性", value: readable ? "主体保持可辨认" : "投影高亮或故障遮挡过强" }
    ]),
    quality: sharedQuality(context,
      unstable ? "扫描线、受控闪烁和故障抖动是全息语言，未误判为普通视频闪烁" : "未发现异常闪变",
      readable ? "全息层次存在且主体可读" : "主体可读性受影响"),
    checks: Object.freeze([
      effectCheck("HOLOGRAM_SUBJECT_READABILITY", readable,
        "扫描线和故障表现存在时，投影主体仍保持可辨认。", "全息高亮或故障偏移过强，主体难以辨认。", "HOLOGRAM_UNREADABLE"),
      effectCheck("HOLOGRAM_INTENTIONAL_INSTABILITY_GUARD", true,
        unstable ? "受控闪烁、扫描和故障抖动按全息表现处理，未误判为视频故障。" : "稳定全息在前中后段保持一致。",
        "", "HOLOGRAM_FLICKER_FAILURE")
    ])
  });
}

const SPEC: FinalVideoSelfCheckSpec = Object.freeze({
  toolName: "hologram",
  displayName: "全息投影材质",
  isNeutral: (params: Readonly<Record<string, unknown>>) => finite(params.brightness) <= 0 || finite(params.opacity) <= 0,
  samplingPlan: hologramSamplingPlan,
  selectEvidence: (observations: readonly FinalFrameObservation[]) => distinctEvidence(observations, [
    observations[0], minimumBy(observations, (item) => item.brightnessGain),
    maximumBy(observations, (item) => item.brightnessGain), maximumBy(observations, (item) => item.scanlinePresence),
    farthestFrom(observations, observations[0]), observations.at(-1)
  ]),
  summarize: summarizeHologram
});

export function runHologramSelfCheck(request: FinalVideoSelfCheckRequest) {
  return runFinalVideoSelfCheck(SPEC, request);
}
