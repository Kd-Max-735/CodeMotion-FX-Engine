import {
  addObservedSelection,
  finalizeObservedSelections,
  observedDirection,
  observedExtremaIndices,
  observedPace,
  observedRange,
  observedScale,
  parseObservedMotionSelfCheckResult,
  queuedObservedMotionSelfCheck,
  runObservedMotionSelfCheck,
  type CandidateFrame,
  type ObservedMotionSelfCheckRequest,
  type ObservedMotionToolConfig
} from "../observed-motion-self-check.js";

export const DOLLY_SELF_CHECK_RULE_IDS = Object.freeze([
  "DO_EXECUTION", "DO_TRAVEL_DIRECTION", "DO_DEPTH_CHANGE", "DO_RHYTHM_TURN", "DO_FRAME_SAFETY", "DO_USER_INTENT"
] as const);

function selectDollyKeyframes(candidates: readonly CandidateFrame[]) {
  const selections = new Map<number, string>();
  const scales = candidates.map(observedScale);
  const travel = [0];
  for (let index = 1; index < candidates.length; index += 1) {
    travel.push(travel[index - 1]! + Math.hypot(
      candidates[index]!.centroidX - candidates[index - 1]!.centroidX,
      candidates[index]!.centroidY - candidates[index - 1]!.centroidY,
      (scales[index]! - scales[index - 1]!) * 1.5
    ));
  }
  addObservedSelection(selections, 0, "轨道移动起点", candidates.length);
  for (const fraction of [0.25, 0.5, 0.75]) {
    const target = travel.at(-1)! * fraction;
    const index = travel.reduce((best, value, current) =>
      Math.abs(value - target) < Math.abs(travel[best]! - target) ? current : best, 0);
    addObservedSelection(selections, index,
      fraction === 0.5 ? "轨道移动中点" : "轨道移动阶段", candidates.length);
  }
  observedExtremaIndices(scales, Math.max(0.001, observedRange(scales) * 0.04)).slice(0, 2).forEach((index) =>
    addObservedSelection(selections, index, "推拉转向位置", candidates.length));
  addObservedSelection(selections, candidates.length - 1, "轨道移动终点", candidates.length);
  return finalizeObservedSelections(candidates, selections, 6);
}

function summarizeDolly(candidates: readonly CandidateFrame[]) {
  const first = candidates[0]!;
  const last = candidates.at(-1)!;
  const scales = candidates.map(observedScale);
  const scaleDirection = Math.abs(scales.at(-1)! - scales[0]!) < 0.002
    ? "景别基本保持" : scales.at(-1)! > scales[0]! ? "轨道推进" : "轨道拉远";
  const vertical = Math.abs(last.centroidY - first.centroidY) < 0.004
    ? "高度基本保持" : last.centroidY < first.centroidY ? "伴随升高" : "伴随降低";
  const turns = observedExtremaIndices(scales, Math.max(0.001, observedRange(scales) * 0.04)).length;
  const rhythm = turns > 0 ? "包含推拉转向" : "单向连续移动";
  const framing = observedDirection(last.centroidX - first.centroidX, last.centroidY - first.centroidY);
  const pace = observedPace(candidates.slice(1).map((item) => item.changeFromPrevious), last.time - first.time);
  return Object.freeze({
    description: `镜头${scaleDirection}、${vertical}，构图${framing}，运镜${pace}且${rhythm}。`,
    keyInformation: Object.freeze([
      Object.freeze({ label: "特效类型", value: "轨道推拉镜头" }),
      Object.freeze({ label: "推拉方向", value: scaleDirection }),
      Object.freeze({ label: "高度变化", value: vertical }),
      Object.freeze({ label: "构图移动", value: framing }),
      Object.freeze({ label: "镜头节奏", value: `${pace}，${rhythm}` })
    ]),
    missingInformation: Object.freeze([])
  });
}

const DOLLY_CONFIG: ObservedMotionToolConfig = Object.freeze({
  toolName: "dolly", displayName: "轨道推拉镜头", candidateCount: 25,
  ruleIds: DOLLY_SELF_CHECK_RULE_IDS,
  selectKeyframes: selectDollyKeyframes,
  summarize: summarizeDolly
});

export function queuedDollySelfCheck() { return queuedObservedMotionSelfCheck("dolly"); }
export function parseDollySelfCheckResult(value: unknown) {
  return parseObservedMotionSelfCheckResult(DOLLY_SELF_CHECK_RULE_IDS, value);
}
export async function runDollySelfCheck(request: ObservedMotionSelfCheckRequest) {
  return runObservedMotionSelfCheck(DOLLY_CONFIG, request);
}
