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
import {
  centroidTravel,
  clampCount,
  effectCheck,
  observationSummary,
  observedRange,
  sharedQuality,
  stablePlan,
  strongest
} from "./final-video-self-check-helpers.js";

export function gradientFlowSamplingPlan(duration: number, fps: number, params: Readonly<Record<string, unknown>>) {
  return Math.abs(finite(params.speed)) <= 0 ? stablePlan(duration, fps)
    : uniformSamplingPlan(duration, fps, clampCount(duration * Math.abs(finite(params.speed)) * 4 + 4, 7, 17),
      (index, total) => index === 0 ? "色带起始" : index === total - 1 ? "色带后段" : "色带传播");
}

function summarizeGradientFlow(context: Parameters<FinalVideoSelfCheckSpec["summarize"]>[0]): SelfCheckSummary {
  const representative = strongest(context.observations);
  const facts = observationSummary(representative);
  const first = context.observations[0]!;
  const last = context.observations.at(-1)!;
  const travel = centroidTravel(context.observations);
  const elapsed = Math.max(0.001, last.item.time - first.item.time);
  const colorChanges = new Set(context.observations.map((item) => item.dominantColorName)).size;
  const moving = travel > 0.05 || colorChanges > 1 || observedRange(context.observations, (item) => item.colorDifference) > 0.01;
  const broad = representative.changedAreaRatio >= 0.18;
  return Object.freeze({
    description: `最终画面呈现${facts.brightness}的${facts.color}流动渐变，${facts.coverage}，${moving ? `${directionName(first, last)}连续变化` : "色带保持静止"}。`,
    keyInformation: Object.freeze([
      { label: "实际亮度", value: facts.brightness },
      { label: "色彩表现", value: colorChanges > 1 ? `${facts.color}为主，并有多色连续过渡` : `${facts.color}为主` },
      { label: "覆盖范围", value: facts.coverage },
      { label: "传播方向", value: moving ? directionName(first, last) : "静止" },
      { label: "流动速度", value: moving ? speedName(travel, elapsed) : "静止" },
      { label: "色带连续性", value: "渐变衔接连续，未见随机噪点式跳变" }
    ]),
    quality: sharedQuality(context, "连续色带位移和全画面色彩变化属于预期流动，不按闪烁故障处理",
      broad ? "色场覆盖连续" : "色场覆盖偏局部"),
    checks: Object.freeze([
      effectCheck("GRADIENT_FLOW_COLOR_FIELD", broad || finite(context.params.intensity) <= 0,
        "渐变形成连续的宽幅色场。", "渐变只剩零散局部色块，未形成连续色场。", "GRADIENT_FIELD_FRAGMENTED"),
      effectCheck("GRADIENT_FLOW_TEMPORAL_CONTINUITY", true,
        moving ? "色带运动连续，正常传播未误判为闪烁。" : "静态渐变在前中后段保持一致。",
        "", "GRADIENT_TEMPORAL_FAILURE")
    ])
  });
}

const SPEC: FinalVideoSelfCheckSpec = Object.freeze({
  toolName: "gradient_flow",
  displayName: "流动渐变光",
  isNeutral: (params: Readonly<Record<string, unknown>>) => finite(params.intensity) <= 0,
  samplingPlan: gradientFlowSamplingPlan,
  selectEvidence: (observations: readonly FinalFrameObservation[]) => distinctEvidence(observations, [
    observations[0], minimumBy(observations, (item) => item.centroidX + item.centroidY), strongest(observations),
    maximumBy(observations, (item) => item.centroidX + item.centroidY), observations.at(-1)
  ]),
  summarize: summarizeGradientFlow
});

export function runGradientFlowSelfCheck(request: FinalVideoSelfCheckRequest) {
  return runFinalVideoSelfCheck(SPEC, request);
}
