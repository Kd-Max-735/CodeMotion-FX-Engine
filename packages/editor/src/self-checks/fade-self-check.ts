import {
  addObservedSelection,
  finalizeObservedSelections,
  observedPace,
  observedVisibility,
  parseObservedMotionSelfCheckResult,
  queuedObservedMotionSelfCheck,
  runObservedMotionSelfCheck,
  type CandidateFrame,
  type ObservedMotionSelfCheckRequest,
  type ObservedMotionToolConfig
} from "../observed-motion-self-check.js";

export const FADE_SELF_CHECK_RULE_IDS = Object.freeze([
  "FA_EXECUTION", "FA_START_END", "FA_DIRECTION", "FA_PACING", "FA_FRAME_SAFETY", "FA_USER_INTENT"
] as const);

function selectFadeKeyframes(candidates: readonly CandidateFrame[]) {
  const selections = new Map<number, string>();
  const visibility = candidates.map(observedVisibility);
  const start = visibility[0]!;
  const end = visibility.at(-1)!;
  addObservedSelection(selections, 0, "起始可见状态", candidates.length);
  for (const fraction of [0.25, 0.5, 0.75]) {
    const target = start + (end - start) * fraction;
    const index = visibility.reduce((best, value, current) =>
      Math.abs(value - target) < Math.abs(visibility[best]! - target) ? current : best, 0);
    addObservedSelection(selections, index, fraction === 0.5 ? "可见度过渡中点" : "可见度过渡阶段", candidates.length);
  }
  addObservedSelection(selections, candidates.length - 1, "结束可见状态", candidates.length);
  return finalizeObservedSelections(candidates, selections, 5);
}

function summarizeFade(candidates: readonly CandidateFrame[]) {
  const first = candidates[0]!;
  const last = candidates.at(-1)!;
  const start = observedVisibility(first);
  const end = observedVisibility(last);
  const direction = Math.abs(end - start) < 0.015 ? "可见程度基本保持"
    : end > start ? "由弱到强淡入" : "由强到弱淡出";
  const pace = observedPace(candidates.slice(1).map((item) => item.changeFromPrevious), last.time - first.time);
  return Object.freeze({
    description: `画面${direction}，起终可见状态明确，过渡${pace}且连续。`,
    keyInformation: Object.freeze([
      Object.freeze({ label: "特效类型", value: "淡入淡出" }),
      Object.freeze({ label: "起始状态", value: start < end ? "较弱可见" : "较清晰可见" }),
      Object.freeze({ label: "结束状态", value: end > start ? "较清晰可见" : "较弱可见" }),
      Object.freeze({ label: "过渡方向", value: direction }),
      Object.freeze({ label: "过渡节奏", value: `${pace}、连续变化` })
    ]),
    missingInformation: Object.freeze([])
  });
}

const FADE_CONFIG: ObservedMotionToolConfig = Object.freeze({
  toolName: "fade", displayName: "淡入淡出", candidateCount: 21,
  ruleIds: FADE_SELF_CHECK_RULE_IDS,
  selectKeyframes: selectFadeKeyframes,
  summarize: summarizeFade
});

export function queuedFadeSelfCheck() { return queuedObservedMotionSelfCheck("fade"); }
export function parseFadeSelfCheckResult(value: unknown) {
  return parseObservedMotionSelfCheckResult(FADE_SELF_CHECK_RULE_IDS, value);
}
export async function runFadeSelfCheck(request: ObservedMotionSelfCheckRequest) {
  return runObservedMotionSelfCheck(FADE_CONFIG, request);
}
