import { baseInformation, queuedEffectSelfCheck, radialContinuity, regionalChange, rounded, runEffectSelfCheck, semanticLevel,
  type EffectSelfCheckRequest, type EffectSelfCheckView, type PixelFrame, type SelfCheckAnalysis,
  type SelfCheckAnalysisContext, type SelfCheckSpec } from "./visual-quality-self-check-common.js";

const TOOL_NAME = "radial_blur" as const;

function analyzeRadialBlur(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const region = regionalChange(context.representative);
  const continuity = radialContinuity(context.representative, region.minimumX, region.minimumY);
  const edgeGrowth = region.edge - region.center;
  const visibility = semanticLevel(context.representative.effectDelta, 0.01, 0.045);
  return Object.freeze({ description: `最终画面以${region.minimumRegion}附近为视觉中心，呈现${visibility}的${continuity.pattern}。`,
    keyInformation: Object.freeze([...baseInformation("径向模糊", visibility),
      Object.freeze({ label: "视觉中心", value: region.minimumRegion }), Object.freeze({ label: "径向形态", value: continuity.pattern }),
      Object.freeze({ label: "中心与边缘", value: edgeGrowth > 0.008 ? "中心相对稳定，边缘拖影更明显" : "中心与边缘变化接近" }),
      Object.freeze({ label: "主体可辨性", value: context.finalStats.edgeEnergy >= context.baselineStats.edgeEnergy * 0.5 ? "主体仍可辨" : "主体被强烈拖散" })]),
    effect: Object.freeze({ visual_center: region.minimumRegion, radial_appearance: continuity.pattern, blur_visibility: visibility,
      center_change: region.center, edge_change: region.edge, center_to_edge_separation: rounded(edgeGrowth, 5),
      subject_legibility: context.finalStats.edgeEnergy >= context.baselineStats.edgeEnergy * 0.5 ? "清楚" : "受强烈拖散" }) });
}

const SPEC: SelfCheckSpec<typeof TOOL_NAME> = Object.freeze({ toolName: TOOL_NAME, displayName: "径向模糊",
  ruleIds: Object.freeze(["RB_CENTER", "RB_PATTERN", "RB_QUALITY", "RB_INTENT"]), peakRole: "径向形态代表",
  changeRole: "径向变化", temporalEvidence: false, protection: "无视觉中心的均匀模糊不作为径向模糊证据", evidenceScore: (frame: PixelFrame) => {
    const region = regionalChange(frame); return Math.max(0, region.edge - region.center) + frame.effectDelta;
  }, analyze: analyzeRadialBlur });
export type RadialBlurSelfCheckRequest = Omit<EffectSelfCheckRequest<typeof TOOL_NAME>, "toolName">;
export type RadialBlurSelfCheckView = EffectSelfCheckView<typeof TOOL_NAME>;
export const queuedRadialBlurSelfCheck = (): RadialBlurSelfCheckView => queuedEffectSelfCheck(TOOL_NAME);
export const runRadialBlurSelfCheck = (request: RadialBlurSelfCheckRequest) => runEffectSelfCheck(SPEC, { ...request, toolName: TOOL_NAME });
