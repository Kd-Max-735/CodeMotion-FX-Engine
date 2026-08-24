import {
  addObservedSelection,
  finalizeObservedSelections,
  observedExtremaIndices,
  observedPace,
  observedRange,
  observedScale,
  parseObservedMotionSelfCheckResult,
  queuedObservedMotionSelfCheck,
  runObservedMotionSelfCheck,
  strongestObservedExtrema,
  type CandidateFrame,
  type ObservedMotionSelfCheckRequest,
  type ObservedMotionToolConfig
} from "../observed-motion-self-check.js";

export const ELASTIC_SELF_CHECK_RULE_IDS = Object.freeze([
  "EL_EXECUTION", "EL_AXIS", "EL_OVERSHOOT", "EL_DAMPING", "EL_FRAME_SAFETY", "EL_USER_INTENT"
] as const);

function elasticSignal(candidates: readonly CandidateFrame[]) {
  const signals = [
    candidates.map((item) => item.centroidX),
    candidates.map((item) => item.centroidY),
    candidates.map(observedScale)
  ];
  return signals.sort((a, b) => observedRange(b) - observedRange(a))[0]!;
}

function selectElasticKeyframes(candidates: readonly CandidateFrame[]) {
  const selections = new Map<number, string>();
  const signal = elasticSignal(candidates);
  addObservedSelection(selections, 0, "开始画面", candidates.length);
  [...strongestObservedExtrema(signal, 6)].sort((a, b) => a - b).forEach((index, order) =>
    addObservedSelection(selections, index, order % 2 === 0 ? "超调位置" : "反向回弹", candidates.length));
  addObservedSelection(selections, Math.floor(candidates.length * 0.8), "阻尼稳定段", candidates.length);
  addObservedSelection(selections, candidates.length - 1, "结束画面", candidates.length);
  return finalizeObservedSelections(candidates, selections, 8);
}

function summarizeElastic(candidates: readonly CandidateFrame[]) {
  const first = candidates[0]!;
  const last = candidates.at(-1)!;
  const xs = candidates.map((item) => item.centroidX);
  const ys = candidates.map((item) => item.centroidY);
  const scales = candidates.map(observedScale);
  const horizontal = observedRange(xs);
  const vertical = observedRange(ys);
  const scale = observedRange(scales) / Math.max(0.001, scales.reduce((sum, value) => sum + value, 0) / scales.length);
  const axis = scale > Math.max(horizontal, vertical) * 1.4 ? "缩放方向"
    : horizontal >= vertical ? "水平方向" : "垂直方向";
  const signal = axis === "缩放方向" ? scales : axis === "水平方向" ? xs : ys;
  const reversals = observedExtremaIndices(signal, Math.max(0.002, observedRange(signal) * 0.04)).length;
  const damping = observedRange(signal.slice(Math.floor(signal.length * 0.7))) < observedRange(signal) * 0.35
    ? "逐步衰减并趋稳" : "持续弹性往返";
  const pace = observedPace(candidates.slice(1).map((item) => item.changeFromPrevious), last.time - first.time);
  return Object.freeze({
    description: `画面沿${axis}进行${pace}的超调与反向回弹，运动${damping}。`,
    keyInformation: Object.freeze([
      Object.freeze({ label: "特效类型", value: "阻尼弹性" }),
      Object.freeze({ label: "弹性方向", value: axis }),
      Object.freeze({ label: "超调与回弹", value: `观察到 ${reversals} 次方向反转` }),
      Object.freeze({ label: "阻尼节奏", value: `${pace}，${damping}` })
    ]),
    missingInformation: Object.freeze([])
  });
}

const ELASTIC_CONFIG: ObservedMotionToolConfig = Object.freeze({
  toolName: "elastic", displayName: "阻尼弹性", candidateCount: 41,
  ruleIds: ELASTIC_SELF_CHECK_RULE_IDS,
  selectKeyframes: selectElasticKeyframes,
  summarize: summarizeElastic
});

export function queuedElasticSelfCheck() { return queuedObservedMotionSelfCheck("elastic"); }
export function parseElasticSelfCheckResult(value: unknown) {
  return parseObservedMotionSelfCheckResult(ELASTIC_SELF_CHECK_RULE_IDS, value);
}
export async function runElasticSelfCheck(request: ObservedMotionSelfCheckRequest) {
  return runObservedMotionSelfCheck(ELASTIC_CONFIG, request);
}
