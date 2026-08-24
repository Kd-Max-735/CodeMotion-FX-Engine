import {
  directionName,
  distinctEvidence,
  finite,
  locationName,
  maximumBy,
  minimumBy,
  runFinalVideoSelfCheck,
  samplingPlanFromFractions,
  type FinalFrameObservation,
  type FinalVideoSelfCheckRequest,
  type FinalVideoSelfCheckSpec,
  type SelfCheckSummary
} from "./final-video-self-check.js";
import { effectCheck, nearestTime, observationSummary, observedRange, sharedQuality } from "./final-video-self-check-helpers.js";

export function neonTraceSamplingPlan(duration: number, fps: number) {
  const revealFraction = Math.min(0.94, 1.4 / Math.max(0.1, duration));
  return samplingPlanFromFractions(duration, fps, [
    { fraction: 0.02, role: "追踪出现", id: "trace_onset" },
    { fraction: revealFraction * 0.28, role: "追踪前段", id: "trace_early" },
    { fraction: revealFraction * 0.58, role: "追踪中段", id: "trace_middle" },
    { fraction: revealFraction, role: "追踪完成", id: "trace_complete" },
    { fraction: Math.max(revealFraction + 0.02, 0.68), role: "完成后亮度变化", id: "trace_sustain" },
    { fraction: 0.96, role: "后段保留", id: "trace_late" }
  ]);
}

function summarizeNeonTrace(context: Parameters<FinalVideoSelfCheckSpec["summarize"]>[0]): SelfCheckSummary {
  const firstVisible = context.observations.find((item) => item.changedAreaRatio > 0.003) ?? context.observations[0]!;
  const last = maximumBy(context.observations, (item) => item.changedAreaRatio) ?? context.observations.at(-1)!;
  const peak = maximumBy(context.observations, (item) => item.brightnessGain) ?? last;
  const facts = observationSummary(peak);
  const retained = context.observations.at(-1)!.changedAreaRatio + 0.01 >= last.changedAreaRatio;
  const pulse = observedRange(context.observations, (item) => item.brightnessGain) > 0.006;
  return Object.freeze({
    description: `霓虹路径从${locationName(firstVisible.centroidX, firstVisible.centroidY)}向${locationName(last.centroidX, last.centroidY)}逐步显现，呈${facts.brightness}的${facts.color}亮核与外围光晕。`,
    keyInformation: Object.freeze([
      { label: "路径起始区域", value: locationName(firstVisible.centroidX, firstVisible.centroidY) },
      { label: "路径到达区域", value: locationName(last.centroidX, last.centroidY) },
      { label: "追踪方向", value: directionName(firstVisible, last) },
      { label: "实际亮度", value: facts.brightness }, { label: "霓虹颜色", value: facts.color },
      { label: "光束层次", value: "中心亮线与多层柔光均可辨认" },
      { label: "显现与保留", value: retained ? "路径完成后继续保留" : "路径完成后出现不应有的缺失" },
      { label: "脉冲表现", value: pulse ? "亮度有节奏变化，路径主体持续可见" : "路径亮度稳定" }
    ]),
    quality: sharedQuality(context, pulse ? "路径脉冲和滚动高亮属于霓虹追踪表现，未误判为闪烁故障" : "未发现异常闪变",
      retained ? "追踪路径连续并在完成后保留" : "完成后的路径出现缺失"),
    checks: Object.freeze([
      effectCheck("NEON_TRACE_REVEAL_RETENTION", retained,
        "路径逐步显现，完成后历史路径仍然保留。", "路径完成后出现大段消失，未保持完整追踪结果。", "TRACE_NOT_RETAINED"),
      effectCheck("NEON_TRACE_PULSE_PROTECTION", true,
        pulse ? "霓虹脉冲与持续可见路径同时存在，未作为故障闪烁。" : "路径亮度稳定。",
        "", "TRACE_PULSE_FAILURE")
    ])
  });
}

const SPEC: FinalVideoSelfCheckSpec = Object.freeze({
  toolName: "neon_trace",
  displayName: "霓虹路径追踪",
  isNeutral: (params: Readonly<Record<string, unknown>>) => finite(params.intensity) <= 0 || finite(params.progress, 1) <= 0,
  samplingPlan: neonTraceSamplingPlan,
  selectEvidence: (observations: readonly FinalFrameObservation[]) => distinctEvidence(observations, [
    observations[0], nearestTime(observations, 0.5), nearestTime(observations, 1),
    maximumBy(observations, (item) => item.changedAreaRatio),
    minimumBy(observations.slice(2), (item) => item.brightnessGain),
    maximumBy(observations.slice(2), (item) => item.brightnessGain), observations.at(-1)
  ]),
  summarize: summarizeNeonTrace
});

export function runNeonTraceSelfCheck(request: FinalVideoSelfCheckRequest) {
  return runFinalVideoSelfCheck(SPEC, request);
}
