import { baseInformation, blurAxis, clamp, percent, queuedEffectSelfCheck, rounded, runEffectSelfCheck, semanticLevel,
  type EffectSelfCheckRequest, type EffectSelfCheckView, type PixelFrame, type SelfCheckAnalysis,
  type SelfCheckAnalysisContext, type SelfCheckSpec } from "./visual-quality-self-check-common.js";

const TOOL_NAME = "directional_blur" as const;

function analyzeDirectionalBlur(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const axis = blurAxis(context.representative); const edge = context.baselineStats.edgeEnergy <= 1e-6 ? 1 : context.finalStats.edgeEnergy / context.baselineStats.edgeEnergy;
  const visibility = semanticLevel(1 - clamp(edge, 0, 1), 0.08, 0.3); const coherence = axis.anisotropy >= 0.25 ? "拖影方向集中" : "拖影方向不够集中";
  return Object.freeze({ description: `最终画面沿${axis.label}形成${visibility}方向模糊，${coherence}。`,
    keyInformation: Object.freeze([...baseInformation("方向模糊", visibility), Object.freeze({ label: "拖影轴向", value: axis.label }),
      Object.freeze({ label: "方向一致性", value: coherence }), Object.freeze({ label: "轮廓保留", value: `约 ${percent(edge)}` }),
      Object.freeze({ label: "边缘表现", value: context.representative.changedRatio > 0.95 ? "全画面均有可见拖影" : "主要轮廓区域出现拖影" })]),
    effect: Object.freeze({ directional_trail: Object.freeze({ direction: axis.label, observed_angle_degrees: axis.angle }),
      trail_visibility: visibility, direction_coherence: rounded(axis.anisotropy, 4), contour_retention: rounded(edge, 4) }) });
}

const SPEC: SelfCheckSpec<typeof TOOL_NAME> = Object.freeze({ toolName: TOOL_NAME, displayName: "方向模糊",
  ruleIds: Object.freeze(["DB_TRAIL", "DB_DIRECTION", "DB_QUALITY", "DB_INTENT"]), peakRole: "方向拖影代表",
  changeRole: "拖影变化", temporalEvidence: false, protection: "普通失焦与无单一轴向的柔化不作为方向模糊证据",
  evidenceScore: (frame: PixelFrame) => blurAxis(frame).anisotropy * (1 + frame.effectDelta), analyze: analyzeDirectionalBlur });
export type DirectionalBlurSelfCheckRequest = Omit<EffectSelfCheckRequest<typeof TOOL_NAME>, "toolName">;
export type DirectionalBlurSelfCheckView = EffectSelfCheckView<typeof TOOL_NAME>;
export const queuedDirectionalBlurSelfCheck = (): DirectionalBlurSelfCheckView => queuedEffectSelfCheck(TOOL_NAME);
export const runDirectionalBlurSelfCheck = (request: DirectionalBlurSelfCheckRequest) => runEffectSelfCheck(SPEC, { ...request, toolName: TOOL_NAME });
