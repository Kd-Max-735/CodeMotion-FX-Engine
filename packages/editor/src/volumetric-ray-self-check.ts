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
import { centroidTravel, effectCheck, farthestFrom, observationSummary, observedRange, sharedQuality, stablePlan, strongest } from "./final-video-self-check-helpers.js";

export function volumetricRaySamplingPlan(duration: number, fps: number, params: Readonly<Record<string, unknown>>) {
  return Math.abs(finite(params.flowSpeed)) <= 0 ? stablePlan(duration, fps)
    : uniformSamplingPlan(duration, fps, 7,
      (index, total) => index === 0 ? "光束前段" : index === total - 1 ? "光束后段" : "光尘流动层次");
}

function summarizeVolumetricRay(context: Parameters<FinalVideoSelfCheckSpec["summarize"]>[0]): SelfCheckSummary {
  const peak = maximumBy(context.observations, (item) => item.brightnessGain) ?? strongest(context.observations);
  const facts = observationSummary(peak);
  const flow = observedRange(context.observations, (item) => item.brightnessGain) > 0.004
    || centroidTravel(context.observations) > 0.025;
  const layered = peak.changedAreaRatio > 0.025 && peak.changedAreaRatio < 0.9;
  return Object.freeze({
    description: `体积光束从${facts.location}方向展开，呈${facts.brightness}的${facts.color}分层射线，${facts.coverage}${flow ? "，内部光尘持续流动" : "，内部层次保持稳定"}。`,
    keyInformation: Object.freeze([
      { label: "光束亮度", value: facts.brightness }, { label: "光束颜色", value: facts.color },
      { label: "主要位置", value: facts.location }, { label: "光束朝向", value: `约${Math.round(peak.principalAngleDegrees)}度展开` },
      { label: "覆盖范围", value: facts.coverage },
      { label: "光束层次", value: layered ? "明亮主束、柔和外沿和遮挡间隙均可辨认" : "层次偏平或覆盖过满" },
      { label: "内部流动", value: flow ? "可见连续流动，方向稳定" : "基本静止" },
      { label: "底图可读性", value: peak.changedAreaRatio < 0.86 ? "底图仍可辨认" : "底图受到较强覆盖" }
    ]),
    quality: sharedQuality(context, flow ? "光束内部流动属于体积层次变化，未误判为闪烁" : "未发现异常闪变",
      layered ? "射线层次连续" : "射线层次不足"),
    checks: Object.freeze([
      effectCheck("VOLUMETRIC_RAY_LAYERING", layered,
        "主束、衰减外沿与遮挡间隙形成可辨认层次。", "光束层次偏平，或泛光覆盖过满而失去射线结构。", "RAY_LAYERING_LOST"),
      effectCheck("VOLUMETRIC_RAY_FLOW_PROTECTION", true,
        flow ? "内部光尘流动连续，未作为闪烁故障。" : "静态光束在前中后段保持稳定。",
        "", "RAY_FLOW_FAILURE")
    ])
  });
}

const SPEC: FinalVideoSelfCheckSpec = Object.freeze({
  toolName: "volumetric_ray",
  displayName: "体积光束",
  isNeutral: (params: Readonly<Record<string, unknown>>) => finite(params.exposure) <= 0 || finite(params.weight) <= 0,
  samplingPlan: volumetricRaySamplingPlan,
  selectEvidence: (observations: readonly FinalFrameObservation[]) => distinctEvidence(observations, [
    observations[0], minimumBy(observations, (item) => item.brightnessGain),
    maximumBy(observations, (item) => item.brightnessGain), farthestFrom(observations, observations[0]),
    observations.at(-1)
  ]),
  summarize: summarizeVolumetricRay
});

export function runVolumetricRaySelfCheck(request: FinalVideoSelfCheckRequest) {
  return runFinalVideoSelfCheck(SPEC, request);
}
