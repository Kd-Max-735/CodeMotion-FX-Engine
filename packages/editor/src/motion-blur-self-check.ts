import { baseInformation, blurAxis, clamp, queuedEffectSelfCheck, runEffectSelfCheck, semanticLevel, trailBalance,
  type EffectSelfCheckRequest, type EffectSelfCheckView, type PixelFrame, type SelfCheckAnalysis,
  type SelfCheckAnalysisContext, type SelfCheckSpec } from "./visual-quality-self-check-common.js";

const TOOL_NAME = "motion_blur" as const;

function analyzeMotionBlur(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const axis = blurAxis(context.representative); const balance = trailBalance(context.representative, axis.angle);
  const edge = context.baselineStats.edgeEnergy <= 1e-6 ? 1 : context.finalStats.edgeEnergy / context.baselineStats.edgeEnergy;
  const visibility = semanticLevel(1 - clamp(edge, 0, 1), 0.07, 0.28);
  return Object.freeze({ description: `最终画面沿${axis.label}形成${visibility}运动拖影，${balance.description}。`,
    keyInformation: Object.freeze([...baseInformation("运动模糊", visibility), Object.freeze({ label: "运动轴向", value: axis.label }),
      Object.freeze({ label: "拖尾分布", value: balance.description }), Object.freeze({ label: "速度感", value: visibility === "明显" ? "速度感强" : visibility === "中等" ? "速度感适中" : "速度感克制" }),
      Object.freeze({ label: "误判保护", value: "与运动方向一致的拖影不作为画面失焦故障" })]),
    effect: Object.freeze({ motion_trail: Object.freeze({ direction: axis.label, observed_angle_degrees: axis.angle }),
      trail_visibility: visibility, trail_distribution: balance.description, two_side_balance: balance.balance,
      subject_contour_retention: Math.round(edge * 10_000) / 10_000,
      motion_blur_is_not_focus_failure: true }) });
}

const SPEC: SelfCheckSpec<typeof TOOL_NAME> = Object.freeze({ toolName: TOOL_NAME, displayName: "运动模糊",
  ruleIds: Object.freeze(["MB_TRAIL", "MB_MOTION", "MB_QUALITY", "MB_INTENT"]), peakRole: "运动拖影代表",
  changeRole: "拖尾变化", temporalEvidence: false, protection: "与运动方向一致的目标拖影不作为失焦故障",
  evidenceScore: (frame: PixelFrame) => blurAxis(frame).anisotropy * (1 + frame.temporalDelta + frame.effectDelta), analyze: analyzeMotionBlur });
export type MotionBlurSelfCheckRequest = Omit<EffectSelfCheckRequest<typeof TOOL_NAME>, "toolName">;
export type MotionBlurSelfCheckView = EffectSelfCheckView<typeof TOOL_NAME>;
export const queuedMotionBlurSelfCheck = (): MotionBlurSelfCheckView => queuedEffectSelfCheck(TOOL_NAME);
export const runMotionBlurSelfCheck = (request: MotionBlurSelfCheckRequest) => runEffectSelfCheck(SPEC, { ...request, toolName: TOOL_NAME });
