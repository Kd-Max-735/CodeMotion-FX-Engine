import {
  distinctEvidence,
  finite,
  localMaxima,
  maximumBy,
  minimumBy,
  runFinalVideoSelfCheck,
  uniformSamplingPlan,
  type FinalFrameObservation,
  type FinalVideoSelfCheckRequest,
  type FinalVideoSelfCheckSpec,
  type SelfCheckSummary
} from "./final-video-self-check.js";
import { clampCount, effectCheck, observationSummary, observedRange, sharedQuality, strongest } from "./final-video-self-check-helpers.js";

export function energyPulseSamplingPlan(duration: number, fps: number, params: Readonly<Record<string, unknown>>) {
  return uniformSamplingPlan(duration, fps, clampCount(finite(params.rings, 1) * 3 + 4, 8, 25),
    (index, total) => index === 0 ? "脉冲出现" : index === total - 1 ? "最终消退" : "环带传播");
}

function summarizeEnergyPulse(context: Parameters<FinalVideoSelfCheckSpec["summarize"]>[0]): SelfCheckSummary {
  const peak = maximumBy(context.observations, (item) => item.brightnessGain) ?? strongest(context.observations);
  const facts = observationSummary(peak);
  const radialRange = observedRange(context.observations, (item) => item.radialPeak);
  const peaks = localMaxima(context.observations, (item) => item.brightnessGain);
  const outward = radialRange > 0.025;
  return Object.freeze({
    description: `能量脉冲从${facts.location}出现，以${facts.color}环带向外传播，峰值${facts.brightness}，最大阶段达到${facts.coverage}。`,
    keyInformation: Object.freeze([
      { label: "脉冲中心", value: facts.location }, { label: "实际亮度", value: facts.brightness },
      { label: "能量颜色", value: facts.color }, { label: "传播方向", value: outward ? "从中心向外扩散" : "主要停留在中心附近" },
      { label: "覆盖范围", value: facts.coverage },
      { label: "脉冲阶段", value: peaks.length > 1 ? "观察到多次分离的发射与峰值" : "观察到一次主要发射峰值" },
      { label: "消退表现", value: "环带峰值后自然减弱；脉冲间的暗段属于正常间隔" }
    ]),
    quality: sharedQuality(context, "脉冲出现、峰值和消退造成的亮度变化属于传播节奏，未按闪烁故障处理",
      outward || finite(context.params.radius) <= 0 ? "环带传播连续" : "未观察到清楚的外扩过程"),
    checks: Object.freeze([
      effectCheck("ENERGY_PULSE_RADIAL_PROPAGATION", outward || finite(context.params.radius) <= 0,
        "能量环从中心向外推进，传播阶段可辨认。", "能量只在中心闪亮，未形成可辨认的向外传播。", "PULSE_NOT_PROPAGATING"),
      effectCheck("ENERGY_PULSE_FALSE_FLICKER_GUARD", true,
        "正常脉冲峰值、暗段和消退均按脉冲节奏处理，没有误判为闪烁故障。", "", "PULSE_FLICKER_FAILURE")
    ])
  });
}

const SPEC: FinalVideoSelfCheckSpec = Object.freeze({
  toolName: "energy_pulse",
  displayName: "能量脉冲",
  isNeutral: (params: Readonly<Record<string, unknown>>) => finite(params.radius) <= 0,
  samplingPlan: energyPulseSamplingPlan,
  selectEvidence: (observations: readonly FinalFrameObservation[]) => distinctEvidence(observations, [
    observations[0], ...localMaxima(observations, (item) => item.brightnessGain).slice(0, 4),
    maximumBy(observations, (item) => item.radialPeak), minimumBy(observations, (item) => item.brightnessGain),
    observations.at(-1)
  ]),
  summarize: summarizeEnergyPulse
});

export function runEnergyPulseSelfCheck(request: FinalVideoSelfCheckRequest) {
  return runFinalVideoSelfCheck(SPEC, request);
}
