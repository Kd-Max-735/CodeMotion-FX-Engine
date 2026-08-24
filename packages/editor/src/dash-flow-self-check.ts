import { baseInformation, directionLabel, percent, runEffectSelfCheck, semanticLevel, temporalActivity,
  type EffectSelfCheckRequest, type PixelFrame, type SelfCheckAnalysis, type SelfCheckAnalysisContext, type SelfCheckSpec
} from "./ten-tool-self-check-io.js";

export const DASH_FLOW_RULE_IDS = Object.freeze([
  "DASH_FLOW_PATH_VISIBILITY", "DASH_FLOW_DIRECTION", "DASH_FLOW_CADENCE",
  "DASH_FLOW_PATH_STABILITY", "DASH_FLOW_FRAME_QUALITY"
] as const);

function changedCentroid(frame: PixelFrame): readonly [number, number] {
  let xTotal = 0; let yTotal = 0; let weight = 0;
  for (let y = 0; y < frame.height; y += 2) for (let x = 0; x < frame.width; x += 2) {
    const offset = (y * frame.width + x) * 4;
    const value = Math.abs(frame.pixels[offset]! - frame.baseline[offset]!)
      + Math.abs(frame.pixels[offset + 1]! - frame.baseline[offset + 1]!)
      + Math.abs(frame.pixels[offset + 2]! - frame.baseline[offset + 2]!);
    xTotal += x * value; yTotal += y * value; weight += value;
  }
  return weight <= 0 ? [0.5, 0.5] : [xTotal / weight / frame.width, yTotal / weight / frame.height];
}

export function analyzeDashFlowSelfCheck(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const centroids = context.frames.map(changedCentroid); const first = centroids[0]!; const last = centroids.at(-1)!;
  const activity = temporalActivity(context.frames); const direction = activity < 0.002 ? "静止"
    : directionLabel(last[0] - first[0], last[1] - first[1]);
  const speed = activity < 0.002 ? "静止" : activity < 0.012 ? "缓慢" : activity < 0.04 ? "中速" : "快速";
  const frame = context.representative; const local = frame.changedRatio < 0.42; const visible = frame.changedRatio >= 0.001;
  const cadence = frame.changedRatio < 0.035 ? "短段细密" : frame.changedRatio < 0.16 ? "虚实节奏清楚" : "长段舒展";
  return Object.freeze({
    description: visible && local ? `成片虚线沿局部路径${direction === "静止" ? "保持静止" : `向${direction}流动`}，速度${speed}，${cadence}。`
      : "未取得足够的局部虚线运动证据，无法排除整画面运动干扰。",
    keyInformation: Object.freeze([...baseInformation("虚线沿路径流动", semanticLevel(frame.effectDelta, 0.008, 0.035)),
      { label: "虚线流向", value: visible && local ? direction : "无法可靠确认" },
      { label: "流动速度", value: speed }, { label: "虚线节奏", value: cadence },
      { label: "路径覆盖", value: `成片可见区域约 ${percent(frame.changedRatio)}` }]),
    effect: Object.freeze({ 虚线流向: visible && local ? direction : "无法可靠确认", 流动速度: speed, 虚线节奏: cadence,
      路径稳定性: local ? "变化集中在局部路径" : "整画面变化可能干扰判断" }),
    missingInformation: Object.freeze(visible && local ? [] : ["虚线流向"])
  });
}

const SPEC: SelfCheckSpec<"dash_flow"> = Object.freeze({ toolName: "dash_flow", displayName: "虚线沿路径流动",
  ruleIds: DASH_FLOW_RULE_IDS, peakRole: "路径最清晰帧", changeRole: "虚线位置变化", temporalEvidence: true,
  analyze: analyzeDashFlowSelfCheck });

export function runDashFlowSelfCheck(request: EffectSelfCheckRequest<"dash_flow">) { return runEffectSelfCheck(SPEC, request); }
