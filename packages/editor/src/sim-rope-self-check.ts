import { baseInformation, directionLabel, runEffectSelfCheck, semanticLevel, temporalActivity,
  type EffectSelfCheckRequest, type PixelFrame, type SelfCheckAnalysis, type SelfCheckAnalysisContext, type SelfCheckSpec
} from "./ten-tool-self-check-io.js";

export const SIM_ROPE_RULE_IDS = Object.freeze([
  "SIM_ROPE_SHAPE", "SIM_ROPE_ANCHORS", "SIM_ROPE_SWING", "SIM_ROPE_CONTINUITY", "SIM_ROPE_FRAME_QUALITY"
] as const);

function changedBounds(frame: PixelFrame): Readonly<{ width: number; height: number; startX: number; startY: number }> {
  let left = frame.width; let right = -1; let top = frame.height; let bottom = -1;
  for (let y = 0; y < frame.height; y += 2) for (let x = 0; x < frame.width; x += 2) {
    const offset = (y * frame.width + x) * 4;
    const delta = Math.abs(frame.pixels[offset]! - frame.baseline[offset]!) + Math.abs(frame.pixels[offset + 1]! - frame.baseline[offset + 1]!)
      + Math.abs(frame.pixels[offset + 2]! - frame.baseline[offset + 2]!);
    if (delta > 54) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  }
  return Object.freeze({ width: Math.max(0, right - left), height: Math.max(0, bottom - top),
    startX: right < 0 ? 0.5 : left / frame.width, startY: bottom < 0 ? 0.5 : top / frame.height });
}

export function analyzeSimRopeSelfCheck(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const bounds = context.frames.map(changedBounds); const representative = changedBounds(context.representative);
  const elongated = Math.max(representative.width, representative.height) > Math.max(4, Math.min(representative.width, representative.height) * 1.7);
  const travelX = Math.max(...bounds.map((item) => item.startX)) - Math.min(...bounds.map((item) => item.startX));
  const travelY = Math.max(...bounds.map((item) => item.startY)) - Math.min(...bounds.map((item) => item.startY));
  const swing = Math.hypot(travelX, travelY) < 0.03 ? "轻微摆动" : Math.hypot(travelX, travelY) < 0.14 ? "自然摆动" : "大幅摆动";
  const direction = directionLabel(travelX, travelY); const continuity = context.representative.changedRatio < 0.45 ? "绳体保持可辨识" : "大面积变化可能遮蔽绳体";
  return Object.freeze({
    description: elongated ? `成片呈细长连续的绳体，${swing}，主要沿${direction}变化。`
      : "未观察到细长且连续的独立运动区域，不能把一般物体移动误判为绳索模拟。",
    keyInformation: Object.freeze([...baseInformation("绳索模拟", semanticLevel(context.representative.effectDelta, 0.015, 0.06)),
      { label: "绳索位置", value: elongated ? "细长区域清晰可辨" : "无法可靠确认" },
      { label: "摆动幅度", value: elongated ? swing : "无法可靠确认" }, { label: "摆动方向", value: direction },
      { label: "连续性", value: continuity }, { label: "端点稳定", value: Math.hypot(travelX, travelY) < 0.06 ? "起始端附近较稳定" : "端点区域明显移动" }]),
    effect: Object.freeze({ 绳索形态: elongated ? "细长连续" : "无法可靠确认", 摆动幅度: swing, 摆动方向: direction,
      连续性: continuity, 误判保护: "一般物体平移不作为绳索证据" }),
    missingInformation: Object.freeze(elongated ? [] : ["绳索位置", "摆动幅度"])
  });
}

const SPEC: SelfCheckSpec<"sim_rope"> = Object.freeze({ toolName: "sim_rope", displayName: "绳索模拟",
  ruleIds: SIM_ROPE_RULE_IDS, peakRole: "摆动峰值", changeRole: "反向摆动或端点变化", temporalEvidence: true,
  analyze: analyzeSimRopeSelfCheck });

export function runSimRopeSelfCheck(request: EffectSelfCheckRequest<"sim_rope">) { return runEffectSelfCheck(SPEC, request); }
