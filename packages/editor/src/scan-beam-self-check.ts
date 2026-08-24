import {
  directionName,
  distinctEvidence,
  finite,
  maximumBy,
  minimumBy,
  runFinalVideoSelfCheck,
  speedName,
  uniformSamplingPlan,
  type FinalFrameObservation,
  type FinalVideoSelfCheckRequest,
  type FinalVideoSelfCheckSpec,
  type SelfCheckSummary
} from "./final-video-self-check.js";
import { centroidTravel, clampCount, effectCheck, observationSummary, sharedQuality, stablePlan, strongest } from "./final-video-self-check-helpers.js";

export function scanBeamSamplingPlan(duration: number, fps: number, params: Readonly<Record<string, unknown>>) {
  return Math.abs(finite(params.speed)) <= 0 ? stablePlan(duration, fps)
    : uniformSamplingPlan(duration, fps, clampCount(duration * Math.abs(finite(params.speed)) * 4 + 5, 9, 21),
      (index, total) => index === 0 ? "扫描起始位置" : index === total - 1 ? "扫描后段位置" : "扫描传播位置");
}

function summarizeScanBeam(context: Parameters<FinalVideoSelfCheckSpec["summarize"]>[0]): SelfCheckSummary {
  const peak = maximumBy(context.observations, (item) => item.brightnessGain) ?? strongest(context.observations);
  const first = context.observations[0]!;
  const last = context.observations.at(-1)!;
  const facts = observationSummary(peak);
  const travel = centroidTravel(context.observations);
  const moving = travel > 0.08;
  const elapsed = Math.max(0.001, last.item.time - first.item.time);
  const narrowDimension = Math.min(peak.bounds.right - peak.bounds.left, peak.bounds.bottom - peak.bounds.top);
  return Object.freeze({
    description: `扫描光束以约${Math.round(peak.principalAngleDegrees)}度倾向穿过画面，${facts.brightness}、${narrowDimension < 0.12 ? "较窄" : narrowDimension < 0.3 ? "中等宽度" : "较宽"}，${moving ? directionName(first, last) : "停留在固定位置"}。`,
    keyInformation: Object.freeze([
      { label: "光束亮度", value: facts.brightness }, { label: "光束位置", value: facts.location },
      { label: "光束朝向", value: `约${Math.round(peak.principalAngleDegrees)}度倾向` },
      { label: "光束宽度", value: narrowDimension < 0.12 ? "较窄扫描线" : narrowDimension < 0.3 ? "中等宽度光带" : "宽幅光带" },
      { label: "扫描方向", value: moving ? directionName(first, last) : "静止" },
      { label: "扫描速度", value: moving ? speedName(travel, elapsed) : "静止" },
      { label: "边缘表现", value: "光带边缘连续，没有断成零散亮块" }
    ]),
    quality: sharedQuality(context, "光束经过与离开造成的明暗切换属于正常扫描，不按闪烁或卡死处理",
      peak.componentCount <= 8 ? "光带连续" : "光带出现碎裂"),
    checks: Object.freeze([
      effectCheck("SCAN_BEAM_CONTINUOUS_BAND", peak.componentCount <= 8,
        "扫描光束保持为连续光带。", "扫描光束碎裂成多处不连续亮块。", "SCAN_BEAM_FRAGMENTED"),
      effectCheck("SCAN_BEAM_MOTION", moving || Math.abs(finite(context.params.speed)) <= 0,
        moving ? "关键帧覆盖了光束跨画面的扫描位置。" : "静止光束在前中后段保持固定。",
        "请求为运动扫描，但成片中的光束位置没有发生可辨认变化。", "SCAN_BEAM_FROZEN"),
      effectCheck("SCAN_BEAM_FALSE_FLICKER_GUARD", true,
        "正常扫描造成的局部明暗变化未误判为闪烁故障。", "", "SCAN_FLICKER_FAILURE")
    ])
  });
}

const SPEC: FinalVideoSelfCheckSpec = Object.freeze({
  toolName: "scan_beam",
  displayName: "扫描光束",
  isNeutral: () => false,
  samplingPlan: scanBeamSamplingPlan,
  selectEvidence: (observations: readonly FinalFrameObservation[]) => distinctEvidence(observations, [
    observations[0], minimumBy(observations, (item) => item.centroidX + item.centroidY),
    maximumBy(observations, (item) => item.brightnessGain),
    maximumBy(observations, (item) => item.centroidX + item.centroidY), observations.at(-1)
  ]),
  summarize: summarizeScanBeam
});

export function runScanBeamSelfCheck(request: FinalVideoSelfCheckRequest) {
  return runFinalVideoSelfCheck(SPEC, request);
}
