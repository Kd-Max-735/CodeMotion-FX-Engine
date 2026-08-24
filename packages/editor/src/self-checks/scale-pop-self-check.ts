import {
  addObservedSelection,
  finalizeObservedSelections,
  observedPace,
  observedScale,
  parseObservedMotionSelfCheckResult,
  queuedObservedMotionSelfCheck,
  runObservedMotionSelfCheck,
  type CandidateFrame,
  type ObservedMotionSelfCheckRequest,
  type ObservedMotionToolConfig
} from "../observed-motion-self-check.js";

export const SCALE_POP_SELF_CHECK_RULE_IDS = Object.freeze([
  "SP_EXECUTION", "SP_SCALE_ENTRANCE", "SP_OVERSHOOT", "SP_REBOUND_SETTLE", "SP_FRAME_SAFETY", "SP_USER_INTENT"
] as const);

function selectScalePopKeyframes(candidates: readonly CandidateFrame[]) {
  const selections = new Map<number, string>();
  const scales = candidates.map(observedScale);
  const peak = scales.indexOf(Math.max(...scales));
  addObservedSelection(selections, 0, "起始缩放状态", candidates.length);
  addObservedSelection(selections, Math.floor(candidates.length * 0.35), "缩放出现过程", candidates.length);
  addObservedSelection(selections, peak, "缩放超调峰值", candidates.length);
  const afterPeak = scales.slice(peak + 1);
  if (afterPeak.length > 0) addObservedSelection(selections,
    peak + 1 + afterPeak.indexOf(Math.min(...afterPeak)), "回弹收缩", candidates.length);
  addObservedSelection(selections, Math.floor(candidates.length * 0.8), "最终稳定段", candidates.length);
  addObservedSelection(selections, candidates.length - 1, "结束尺寸", candidates.length);
  return finalizeObservedSelections(candidates, selections, 6);
}

function summarizeScalePop(candidates: readonly CandidateFrame[]) {
  const first = candidates[0]!;
  const last = candidates.at(-1)!;
  const scales = candidates.map(observedScale);
  const final = scales.at(-1)!;
  const overshoot = Math.max(...scales) > final * 1.025;
  const direction = final > scales[0]! * 1.025 ? "由小放大出现" : "缩放进入";
  const pace = observedPace(candidates.slice(1).map((item) => item.changeFromPrevious), last.time - first.time);
  return Object.freeze({
    description: `画面以${pace}节奏缩放出现，${overshoot ? "经过超调和回弹后" : "连续变化后"}稳定落位。`,
    keyInformation: Object.freeze([
      Object.freeze({ label: "特效类型", value: "弹性缩放出现" }),
      Object.freeze({ label: "缩放方向", value: direction }),
      Object.freeze({ label: "超调", value: overshoot ? "放大后超过最终尺寸" : "未观察到明显超调" }),
      Object.freeze({ label: "回弹与稳定", value: overshoot ? "超调后回弹并落位" : "连续缩放并落位" }),
      Object.freeze({ label: "出现节奏", value: pace })
    ]),
    missingInformation: Object.freeze([])
  });
}

const SCALE_POP_CONFIG: ObservedMotionToolConfig = Object.freeze({
  toolName: "scale_pop", displayName: "弹性缩放出现", candidateCount: 33,
  ruleIds: SCALE_POP_SELF_CHECK_RULE_IDS,
  selectKeyframes: selectScalePopKeyframes,
  summarize: summarizeScalePop
});

export function queuedScalePopSelfCheck() { return queuedObservedMotionSelfCheck("scale_pop"); }
export function parseScalePopSelfCheckResult(value: unknown) {
  return parseObservedMotionSelfCheckResult(SCALE_POP_SELF_CHECK_RULE_IDS, value);
}
export async function runScalePopSelfCheck(request: ObservedMotionSelfCheckRequest) {
  return runObservedMotionSelfCheck(SCALE_POP_CONFIG, request);
}
