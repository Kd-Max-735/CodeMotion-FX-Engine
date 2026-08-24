import {
  addObservedSelection,
  finalizeObservedSelections,
  observedAmplitude,
  observedExtremaIndices,
  observedPace,
  observedRange,
  parseObservedMotionSelfCheckResult,
  queuedObservedMotionSelfCheck,
  runObservedMotionSelfCheck,
  strongestObservedExtrema,
  type CandidateFrame,
  type ObservedMotionSelfCheckRequest,
  type ObservedMotionToolConfig
} from "../observed-motion-self-check.js";

export const BOUNCE_SELF_CHECK_RULE_IDS = Object.freeze([
  "BO_EXECUTION", "BO_VERTICAL_MOTION", "BO_APEX_CONTACT", "BO_DECAY_SETTLE", "BO_FRAME_SAFETY", "BO_USER_INTENT"
] as const);

function selectBounceKeyframes(candidates: readonly CandidateFrame[]) {
  const selections = new Map<number, string>();
  const ys = candidates.map((item) => item.centroidY);
  addObservedSelection(selections, 0, "开始接触状态", candidates.length);
  [...strongestObservedExtrema(ys, 6)].sort((a, b) => a - b).forEach((index) => {
    const isApex = ys[index]! <= ys[index - 1]! && ys[index]! <= ys[index + 1]!;
    addObservedSelection(selections, index, isApex ? "弹跳峰值" : "落地回弹", candidates.length);
  });
  addObservedSelection(selections, Math.floor(candidates.length * 0.8), "趋于稳定", candidates.length);
  addObservedSelection(selections, candidates.length - 1, "结束落位", candidates.length);
  return finalizeObservedSelections(candidates, selections, 8);
}

function summarizeBounce(candidates: readonly CandidateFrame[]) {
  const first = candidates[0]!;
  const last = candidates.at(-1)!;
  const ys = candidates.map((item) => item.centroidY);
  const amplitudeValue = observedRange(ys);
  const apexes = observedExtremaIndices(ys, Math.max(0.002, amplitudeValue * 0.04))
    .filter((index) => ys[index]! <= ys[index - 1]! && ys[index]! <= ys[index + 1]!).length;
  const settled = observedRange(ys.slice(Math.floor(ys.length * 0.75))) < Math.max(0.003, amplitudeValue * 0.2);
  const amplitude = observedAmplitude(amplitudeValue);
  const pace = observedPace(candidates.slice(1).map((item) => item.changeFromPrevious), last.time - first.time);
  return Object.freeze({
    description: `画面以${amplitude}幅度向上弹起并落下，回弹节奏${pace}，${settled ? "最后稳定落位" : "结束前仍在回弹"}。`,
    keyInformation: Object.freeze([
      Object.freeze({ label: "特效类型", value: "重力弹跳" }),
      Object.freeze({ label: "弹跳方向", value: "向上弹起后落下" }),
      Object.freeze({ label: "弹跳幅度", value: amplitude }),
      Object.freeze({ label: "节奏与回弹", value: `${pace}，观察到约 ${apexes} 个峰值，${settled ? "末段趋于稳定" : "末段仍有回弹"}` })
    ]),
    missingInformation: Object.freeze([])
  });
}

const BOUNCE_CONFIG: ObservedMotionToolConfig = Object.freeze({
  toolName: "bounce", displayName: "重力弹跳", candidateCount: 41,
  ruleIds: BOUNCE_SELF_CHECK_RULE_IDS,
  selectKeyframes: selectBounceKeyframes,
  summarize: summarizeBounce
});

export function queuedBounceSelfCheck() { return queuedObservedMotionSelfCheck("bounce"); }
export function parseBounceSelfCheckResult(value: unknown) {
  return parseObservedMotionSelfCheckResult(BOUNCE_SELF_CHECK_RULE_IDS, value);
}
export async function runBounceSelfCheck(request: ObservedMotionSelfCheckRequest) {
  return runObservedMotionSelfCheck(BOUNCE_CONFIG, request);
}
