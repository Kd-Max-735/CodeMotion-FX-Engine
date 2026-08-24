import {
  addObservedSelection,
  finalizeObservedSelections,
  observedAmplitude,
  observedDirection,
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

export const SLIDE_SELF_CHECK_RULE_IDS = Object.freeze([
  "SL_EXECUTION", "SL_DIRECTION", "SL_ENTRY", "SL_OVERSHOOT_SETTLE", "SL_FRAME_SAFETY", "SL_USER_INTENT"
] as const);

function slideSignal(candidates: readonly CandidateFrame[]) {
  const xs = candidates.map((item) => item.centroidX);
  const ys = candidates.map((item) => item.centroidY);
  return observedRange(xs) >= observedRange(ys) ? xs : ys;
}

function selectSlideKeyframes(candidates: readonly CandidateFrame[]) {
  const selections = new Map<number, string>();
  const signal = slideSignal(candidates);
  const start = signal[0]!;
  const end = signal.at(-1)!;
  const target = start + (end - start) * 0.5;
  const middle = signal.reduce((best, value, index) =>
    Math.abs(value - target) < Math.abs(signal[best]! - target) ? index : best, 0);
  addObservedSelection(selections, 0, "划入起始位置", candidates.length);
  addObservedSelection(selections, middle, "划入中段", candidates.length);
  strongestObservedExtrema(signal, 3).forEach((index) =>
    addObservedSelection(selections, index, "超调回弹", candidates.length));
  addObservedSelection(selections, Math.floor(candidates.length * 0.85), "稳定落位", candidates.length);
  addObservedSelection(selections, candidates.length - 1, "结束画面", candidates.length);
  return finalizeObservedSelections(candidates, selections, 6);
}

function summarizeSlide(candidates: readonly CandidateFrame[]) {
  const first = candidates[0]!;
  const last = candidates.at(-1)!;
  const xs = candidates.map((item) => item.centroidX);
  const ys = candidates.map((item) => item.centroidY);
  const signal = slideSignal(candidates);
  const final = signal.at(-1)!;
  const signalRange = observedRange(signal);
  const overshoot = signal.some((value, index) => index < signal.length - 2
    && Math.abs(value - final) < signalRange * 0.1
    && Math.abs(signal[index + 1]! - final) > Math.abs(value - final) + signalRange * 0.02);
  const direction = observedDirection(last.centroidX - first.centroidX, last.centroidY - first.centroidY, true);
  const amplitude = observedAmplitude(Math.max(observedRange(xs), observedRange(ys)));
  const pace = observedPace(candidates.slice(1).map((item) => item.changeFromPrevious), last.time - first.time);
  return Object.freeze({
    description: `画面${direction}，位移${amplitude}，以${pace}节奏${overshoot ? "超调回弹后" : "直接"}落位。`,
    keyInformation: Object.freeze([
      Object.freeze({ label: "特效类型", value: "方向划入" }),
      Object.freeze({ label: "划入方向", value: direction }),
      Object.freeze({ label: "位移幅度", value: amplitude }),
      Object.freeze({ label: "超调与回弹", value: overshoot ? "越过落点后回弹" : "直接进入落点" }),
      Object.freeze({ label: "划入节奏", value: pace })
    ]),
    missingInformation: Object.freeze([])
  });
}

const SLIDE_CONFIG: ObservedMotionToolConfig = Object.freeze({
  toolName: "slide", displayName: "方向划入", candidateCount: 33,
  ruleIds: SLIDE_SELF_CHECK_RULE_IDS,
  selectKeyframes: selectSlideKeyframes,
  summarize: summarizeSlide
});

export function queuedSlideSelfCheck() { return queuedObservedMotionSelfCheck("slide"); }
export function parseSlideSelfCheckResult(value: unknown) {
  return parseObservedMotionSelfCheckResult(SLIDE_SELF_CHECK_RULE_IDS, value);
}
export async function runSlideSelfCheck(request: ObservedMotionSelfCheckRequest) {
  return runObservedMotionSelfCheck(SLIDE_CONFIG, request);
}
