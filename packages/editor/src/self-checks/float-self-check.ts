import {
  addObservedSelection,
  finalizeObservedSelections,
  observedAmplitude,
  observedMedian,
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

export const FLOAT_SELF_CHECK_RULE_IDS = Object.freeze([
  "FL_EXECUTION", "FL_PATH", "FL_AMPLITUDE", "FL_LOOP_RHYTHM", "FL_FRAME_SAFETY", "FL_USER_INTENT"
] as const);

function selectFloatKeyframes(candidates: readonly CandidateFrame[]) {
  const selections = new Map<number, string>();
  const xs = candidates.map((item) => item.centroidX);
  const ys = candidates.map((item) => item.centroidY);
  addObservedSelection(selections, 0, "开始画面", candidates.length);
  const extrema = new Set([...strongestObservedExtrema(xs, 4), ...strongestObservedExtrema(ys, 4)]);
  [...extrema].sort((a, b) => a - b).slice(0, 6).forEach((index) =>
    addObservedSelection(selections, index, "漂浮转向位置", candidates.length));
  addObservedSelection(selections, Math.floor(candidates.length / 2), "循环中段", candidates.length);
  addObservedSelection(selections, candidates.length - 1, "结束画面", candidates.length);
  return finalizeObservedSelections(candidates, selections, 7);
}

function summarizeFloat(candidates: readonly CandidateFrame[]) {
  const first = candidates[0]!;
  const last = candidates.at(-1)!;
  const xs = candidates.map((item) => item.centroidX);
  const ys = candidates.map((item) => item.centroidY);
  const rx = observedRange(xs);
  const ry = observedRange(ys);
  const correlation = xs.reduce((sum, value, index) => sum
    + (value - observedMedian(xs)) * (ys[index]! - observedMedian(ys)), 0);
  const path = rx > ry * 1.8 ? "水平往返" : ry > rx * 1.8 ? "垂直往返"
    : Math.abs(correlation) > rx * ry * candidates.length * 0.08
      ? correlation > 0 ? "左上至右下往返" : "右上至左下往返" : "环绕式漂浮";
  const amplitude = observedAmplitude(Math.max(rx, ry));
  const pace = observedPace(candidates.slice(1).map((item) => item.changeFromPrevious), last.time - first.time);
  return Object.freeze({
    description: `画面以${amplitude}幅度进行${pace}的${path}，运动连续。`,
    keyInformation: Object.freeze([
      Object.freeze({ label: "特效类型", value: "循环漂浮" }),
      Object.freeze({ label: "漂浮路径", value: path }),
      Object.freeze({ label: "漂浮幅度", value: amplitude }),
      Object.freeze({ label: "循环节奏", value: `${pace}、连续往返` })
    ]),
    missingInformation: Object.freeze([])
  });
}

const FLOAT_CONFIG: ObservedMotionToolConfig = Object.freeze({
  toolName: "float", displayName: "循环漂浮", candidateCount: 33,
  ruleIds: FLOAT_SELF_CHECK_RULE_IDS,
  selectKeyframes: selectFloatKeyframes,
  summarize: summarizeFloat
});

export function queuedFloatSelfCheck() { return queuedObservedMotionSelfCheck("float"); }
export function parseFloatSelfCheckResult(value: unknown) {
  return parseObservedMotionSelfCheckResult(FLOAT_SELF_CHECK_RULE_IDS, value);
}
export async function runFloatSelfCheck(request: ObservedMotionSelfCheckRequest) {
  return runObservedMotionSelfCheck(FLOAT_CONFIG, request);
}
