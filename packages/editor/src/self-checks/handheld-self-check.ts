import {
  addObservedSelection,
  finalizeObservedSelections,
  observedAmplitude,
  observedDirection,
  observedMedian,
  observedPace,
  parseObservedMotionSelfCheckResult,
  queuedObservedMotionSelfCheck,
  runObservedMotionSelfCheck,
  type CandidateFrame,
  type ObservedMotionSelfCheckRequest,
  type ObservedMotionToolConfig
} from "../observed-motion-self-check.js";

export const HANDHELD_SELF_CHECK_RULE_IDS = Object.freeze([
  "HH_EXECUTION", "HH_SHAKE_CHARACTER", "HH_AMPLITUDE", "HH_RHYTHM", "HH_FRAME_SAFETY", "HH_USER_INTENT"
] as const);

function selectHandheldKeyframes(candidates: readonly CandidateFrame[]) {
  const selections = new Map<number, string>();
  const xs = candidates.map((item) => item.centroidX);
  const ys = candidates.map((item) => item.centroidY);
  const centerX = observedMedian(xs);
  const centerY = observedMedian(ys);
  const displacement = candidates.map((item) => Math.hypot(item.centroidX - centerX, item.centroidY - centerY));
  addObservedSelection(selections, 0, "开始画面", candidates.length);
  [...candidates.keys()].sort((a, b) => displacement[b]! - displacement[a]!).slice(0, 4)
    .forEach((index, rank) => addObservedSelection(selections, index,
      rank === 0 ? "最大晃动位置" : "方向变化位置", candidates.length));
  addObservedSelection(selections, Math.floor(candidates.length / 2), "中段手持节奏", candidates.length);
  addObservedSelection(selections, candidates.length - 1, "结束画面", candidates.length);
  return finalizeObservedSelections(candidates, selections, 7);
}

function summarizeHandheld(candidates: readonly CandidateFrame[]) {
  const first = candidates[0]!;
  const last = candidates.at(-1)!;
  const xs = candidates.map((item) => item.centroidX);
  const ys = candidates.map((item) => item.centroidY);
  const amplitude = observedAmplitude(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)));
  const pace = observedPace(candidates.slice(1).map((item) => item.changeFromPrevious), last.time - first.time);
  const drift = observedDirection(last.centroidX - first.centroidX, last.centroidY - first.centroidY);
  return Object.freeze({
    description: `画面以${amplitude}幅度进行${pace}的多方向手持晃动，${drift}。`,
    keyInformation: Object.freeze([
      Object.freeze({ label: "特效类型", value: "手持镜头" }),
      Object.freeze({ label: "晃动幅度", value: amplitude }),
      Object.freeze({ label: "晃动节奏", value: `${pace}、多方向连续变化` }),
      Object.freeze({ label: "起终状态", value: drift })
    ]),
    missingInformation: Object.freeze([])
  });
}

const HANDHELD_CONFIG: ObservedMotionToolConfig = Object.freeze({
  toolName: "handheld",
  displayName: "手持镜头",
  candidateCount: 29,
  ruleIds: HANDHELD_SELF_CHECK_RULE_IDS,
  selectKeyframes: selectHandheldKeyframes,
  summarize: summarizeHandheld
});

export function queuedHandheldSelfCheck() {
  return queuedObservedMotionSelfCheck("handheld");
}

export function parseHandheldSelfCheckResult(value: unknown) {
  return parseObservedMotionSelfCheckResult(HANDHELD_SELF_CHECK_RULE_IDS, value);
}

export async function runHandheldSelfCheck(request: ObservedMotionSelfCheckRequest) {
  return runObservedMotionSelfCheck(HANDHELD_CONFIG, request);
}
