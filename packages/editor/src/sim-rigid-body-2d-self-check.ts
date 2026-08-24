import { baseInformation, runEffectSelfCheck, semanticLevel, temporalActivity,
  type EffectSelfCheckRequest, type PixelFrame, type SelfCheckAnalysis, type SelfCheckAnalysisContext, type SelfCheckSpec
} from "./ten-tool-self-check-io.js";

export const SIM_RIGID_BODY_2D_RULE_IDS = Object.freeze([
  "SIM_RIGID_BODY_2D_OBJECTS", "SIM_RIGID_BODY_2D_MOTION", "SIM_RIGID_BODY_2D_COLLISIONS",
  "SIM_RIGID_BODY_2D_BOUNDARIES", "SIM_RIGID_BODY_2D_FRAME_QUALITY"
] as const);

function occupiedCells(frame: PixelFrame): number {
  const cells = new Set<number>();
  for (let y = 0; y < frame.height; y += 3) for (let x = 0; x < frame.width; x += 3) {
    const offset = (y * frame.width + x) * 4;
    const delta = Math.abs(frame.pixels[offset]! - frame.baseline[offset]!)
      + Math.abs(frame.pixels[offset + 1]! - frame.baseline[offset + 1]!)
      + Math.abs(frame.pixels[offset + 2]! - frame.baseline[offset + 2]!);
    if (delta > 60) cells.add(Math.min(5, Math.floor(y / frame.height * 6)) * 8 + Math.min(7, Math.floor(x / frame.width * 8)));
  }
  return cells.size;
}

export function analyzeSimRigidBody2dSelfCheck(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const frame = context.representative; const cells = occupiedCells(frame); const activityValue = temporalActivity(context.frames);
  const distribution = cells <= 6 ? "少量大块" : cells <= 18 ? "中等数量" : "较密集";
  const activity = activityValue < 0.008 ? "运动平缓" : activityValue < 0.035 ? "碰撞活跃" : "碰撞猛烈";
  const energies = context.frames.map((item) => item.temporalDelta);
  const rebounds = energies.slice(1).filter((value, index) => value > energies[index]! * 1.45 && value > 0.006).length;
  const localized = frame.changedRatio > 0.02 && frame.changedRatio < 0.78 && cells >= 2;
  return Object.freeze({
    description: localized ? `成片呈${distribution}的二维刚体，${activity}，${rebounds > 0 ? "可见碰撞或反弹时刻" : "运动较连续"}。`
      : "多个局部物体各自运动的证据不足，不能把整画面移动当成刚体模拟。",
    keyInformation: Object.freeze([...baseInformation("二维刚体模拟", semanticLevel(frame.effectDelta, 0.025, 0.09)),
      { label: "刚体分布", value: localized ? distribution : "无法可靠确认" },
      { label: "模拟运动", value: localized ? activity : "无法可靠确认" },
      { label: "碰撞表现", value: rebounds > 0 ? `观察到 ${rebounds} 个碰撞或反弹峰值` : "未见明确反弹峰值" },
      { label: "边界表现", value: frame.changedRatio > 0.7 ? "大面积贴边变化需检查裁切" : "局部运动保持可辨识" }]),
    effect: Object.freeze({ 刚体分布: localized ? distribution : "无法可靠确认", 模拟运动: activity,
      碰撞表现: rebounds > 0 ? "可见碰撞或反弹" : "未见明确峰值", 误判保护: "整画面位移不作为刚体运动证据" }),
    missingInformation: Object.freeze(localized ? [] : ["刚体分布", "模拟运动"])
  });
}

const SPEC: SelfCheckSpec<"sim_rigid_body_2d"> = Object.freeze({ toolName: "sim_rigid_body_2d", displayName: "二维刚体模拟",
  ruleIds: SIM_RIGID_BODY_2D_RULE_IDS, peakRole: "运动或碰撞峰值", changeRole: "刚体分布变化", temporalEvidence: true,
  analyze: analyzeSimRigidBody2dSelfCheck });

export function runSimRigidBody2dSelfCheck(request: EffectSelfCheckRequest<"sim_rigid_body_2d">) { return runEffectSelfCheck(SPEC, request); }
