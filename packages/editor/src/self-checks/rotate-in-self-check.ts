import {
  addObservedSelection,
  finalizeObservedSelections,
  observedPace,
  parseObservedMotionSelfCheckResult,
  queuedObservedMotionSelfCheck,
  runObservedMotionSelfCheck,
  type CandidateFrame,
  type ObservedMotionSelfCheckRequest,
  type ObservedMotionToolConfig
} from "../observed-motion-self-check.js";

export const ROTATE_IN_SELF_CHECK_RULE_IDS = Object.freeze([
  "RI_EXECUTION", "RI_ROTATION", "RI_PIVOT", "RI_PACING_SETTLE", "RI_FRAME_SAFETY", "RI_USER_INTENT"
] as const);

function selectRotateInKeyframes(candidates: readonly CandidateFrame[]) {
  const selections = new Map<number, string>();
  const travel = [0];
  for (let index = 1; index < candidates.length; index += 1) {
    let orientationChange = candidates[index]!.orientation - candidates[index - 1]!.orientation;
    while (orientationChange > Math.PI / 2) orientationChange -= Math.PI;
    while (orientationChange < -Math.PI / 2) orientationChange += Math.PI;
    travel.push(travel[index - 1]! + Math.abs(orientationChange) + candidates[index]!.changeFromPrevious * 0.2);
  }
  const totalTravel = travel.at(-1)!;
  addObservedSelection(selections, 0, "起始旋转姿态", candidates.length);
  for (const fraction of [0.2, 0.4, 0.6, 0.8]) {
    const target = totalTravel * fraction;
    const index = travel.reduce((best, value, current) =>
      Math.abs(value - target) < Math.abs(travel[best]! - target) ? current : best, 0);
    addObservedSelection(selections, index,
      fraction === 0.8 ? "旋转收束" : "旋转过程", candidates.length);
  }
  const maxChange = candidates.reduce((best, item, index) => item.changeFromPrevious
    > candidates[best]!.changeFromPrevious ? index : best, 0);
  addObservedSelection(selections, maxChange, "旋转变化明显位置", candidates.length);
  addObservedSelection(selections, candidates.length - 1, "最终落位", candidates.length);
  return finalizeObservedSelections(candidates, selections, 7);
}

function summarizeRotateIn(candidates: readonly CandidateFrame[]) {
  const first = candidates[0]!;
  const last = candidates.at(-1)!;
  const orientations = candidates.map((item) => item.orientation);
  let signedChange = 0;
  for (let index = 1; index < orientations.length; index += 1) {
    let change = orientations[index]! - orientations[index - 1]!;
    while (change > Math.PI / 2) change -= Math.PI;
    while (change < -Math.PI / 2) change += Math.PI;
    signedChange += change;
  }
  const direction = Math.abs(signedChange) < 0.05 ? "旋向需结合合成图确认"
    : signedChange > 0 ? "顺时针旋转进入" : "逆时针旋转进入";
  const pace = observedPace(candidates.slice(1).map((item) => item.changeFromPrevious), last.time - first.time);
  const missing = Math.abs(signedChange) < 0.05
    ? ["仅凭自动视觉测量无法可靠命名旋向，需直接查看关键帧合成图"] : [];
  return Object.freeze({
    description: `画面以${pace}节奏${direction}，最终进入稳定画面。`,
    keyInformation: Object.freeze([
      Object.freeze({ label: "特效类型", value: "旋转进入" }),
      Object.freeze({ label: "旋转方向", value: direction }),
      Object.freeze({ label: "旋转节奏", value: pace }),
      Object.freeze({ label: "起终状态", value: "由旋转姿态进入并在结束画面落位" })
    ]),
    missingInformation: Object.freeze(missing)
  });
}

const ROTATE_IN_CONFIG: ObservedMotionToolConfig = Object.freeze({
  toolName: "rotate_in", displayName: "旋转进入", candidateCount: 41,
  ruleIds: ROTATE_IN_SELF_CHECK_RULE_IDS,
  selectKeyframes: selectRotateInKeyframes,
  summarize: summarizeRotateIn
});

export function queuedRotateInSelfCheck() { return queuedObservedMotionSelfCheck("rotate_in"); }
export function parseRotateInSelfCheckResult(value: unknown) {
  return parseObservedMotionSelfCheckResult(ROTATE_IN_SELF_CHECK_RULE_IDS, value);
}
export async function runRotateInSelfCheck(request: ObservedMotionSelfCheckRequest) {
  return runObservedMotionSelfCheck(ROTATE_IN_CONFIG, request);
}
