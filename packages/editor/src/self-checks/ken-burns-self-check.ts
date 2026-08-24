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

export const KEN_BURNS_SELF_CHECK_RULE_IDS = Object.freeze([
  "KB_EXECUTION", "KB_FRAMING", "KB_PAN", "KB_ZOOM_RHYTHM", "KB_FRAME_SAFETY", "KB_USER_INTENT"
] as const);

function selectKenBurnsKeyframes(candidates: readonly CandidateFrame[]) {
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
  addObservedSelection(selections, 0, "起始取景", candidates.length);
  for (const fraction of [0.25, 0.5, 0.75]) {
    const target = travel.at(-1)! * fraction;
    const index = travel.reduce((best, value, current) =>
      Math.abs(value - target) < Math.abs(travel[best]! - target) ? current : best, 0);
    addObservedSelection(selections, index,
      fraction === 0.5 ? "平移缩放中点" : "平移缩放阶段", candidates.length);
  }
  observedExtremaIndices(scales, Math.max(0.001, observedRange(scales) * 0.04)).slice(0, 2).forEach((index) =>
    addObservedSelection(selections, index, "平移缩放转向位置", candidates.length));
  addObservedSelection(selections, candidates.length - 1, "结束取景", candidates.length);
  return finalizeObservedSelections(candidates, selections, 6);
}

function summarizeKenBurns(candidates: readonly CandidateFrame[]) {
  const first = candidates[0]!;
  const last = candidates.at(-1)!;
  const scales = candidates.map(observedScale);
  const pan = observedDirection(last.centroidX - first.centroidX, last.centroidY - first.centroidY);
  const scaleDirection = Math.abs(scales.at(-1)! - scales[0]!) < 0.002
    ? "景别基本保持" : scales.at(-1)! > scales[0]! ? "逐步推近" : "逐步拉远";
  const turns = observedExtremaIndices(scales, Math.max(0.001, observedRange(scales) * 0.04)).length;
  const rhythm = turns > 0 ? "包含推拉转向" : "单向连续移动";
  const pace = observedPace(candidates.slice(1).map((item) => item.changeFromPrevious), last.time - first.time);
  return Object.freeze({
    description: `镜头${pan}并${scaleDirection}，平移缩放${pace}，${rhythm}。`,
    keyInformation: Object.freeze([
      Object.freeze({ label: "特效类型", value: "肯·伯恩斯平移缩放" }),
      Object.freeze({ label: "平移方向", value: pan }),
      Object.freeze({ label: "缩放方向", value: scaleDirection }),
      Object.freeze({ label: "镜头节奏", value: `${pace}，${rhythm}` }),
      Object.freeze({ label: "起终构图", value: "关键帧展示起始与结束取景差异" })
    ]),
    missingInformation: Object.freeze([])
  });
}

const KEN_BURNS_CONFIG: ObservedMotionToolConfig = Object.freeze({
  toolName: "ken_burns", displayName: "肯·伯恩斯平移缩放", candidateCount: 25,
  ruleIds: KEN_BURNS_SELF_CHECK_RULE_IDS,
  selectKeyframes: selectKenBurnsKeyframes,
  summarize: summarizeKenBurns
});

export function queuedKenBurnsSelfCheck() { return queuedObservedMotionSelfCheck("ken_burns"); }
export function parseKenBurnsSelfCheckResult(value: unknown) {
  return parseObservedMotionSelfCheckResult(KEN_BURNS_SELF_CHECK_RULE_IDS, value);
}
export async function runKenBurnsSelfCheck(request: ObservedMotionSelfCheckRequest) {
  return runObservedMotionSelfCheck(KEN_BURNS_CONFIG, request);
}
