import { baseInformation, blurAxis, clamp, imageStats, percent, queuedEffectSelfCheck, rounded, runEffectSelfCheck, semanticLevel,
  type EffectSelfCheckRequest, type EffectSelfCheckView, type PixelFrame, type SelfCheckAnalysis,
  type SelfCheckAnalysisContext, type SelfCheckSpec } from "./visual-quality-self-check-common.js";

const TOOL_NAME = "gaussian_blur" as const;

function analyzeGaussianBlur(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const edge = context.baselineStats.edgeEnergy <= 1e-6 ? 1 : context.finalStats.edgeEnergy / context.baselineStats.edgeEnergy;
  const detail = context.baselineStats.fineDetail <= 1e-6 ? 1 : context.finalStats.fineDetail / context.baselineStats.fineDetail;
  const visibility = semanticLevel(1 - clamp(edge, 0, 1), 0.08, 0.3); const axis = blurAxis(context.representative);
  const uniformity = axis.anisotropy < 0.35 ? "各方向软化较均匀" : "存在较明显单向拖开";
  return Object.freeze({ description: `最终画面呈现${visibility}的整体柔化，${uniformity}。`,
    keyInformation: Object.freeze([...baseInformation("高斯模糊", visibility),
      Object.freeze({ label: "轮廓柔化", value: `轮廓清晰度保留约 ${percent(edge)}` }),
      Object.freeze({ label: "细节柔化", value: `细小纹理保留约 ${percent(detail)}` }),
      Object.freeze({ label: "方向均匀性", value: uniformity }),
      Object.freeze({ label: "失焦保护", value: "作为目标柔化审查，不按拍摄失焦故障处理" })]),
    effect: Object.freeze({ blur_appearance: visibility, contour_softness: Object.freeze({ retained: rounded(edge, 4),
      appearance: edge > 0.8 ? "轻微软化" : edge > 0.55 ? "柔化明显" : "强烈柔化" }),
      fine_texture_retention: rounded(detail, 4), directional_uniformity: uniformity }) });
}

const SPEC: SelfCheckSpec<typeof TOOL_NAME> = Object.freeze({ toolName: TOOL_NAME, displayName: "高斯模糊",
  ruleIds: Object.freeze(["GB_SOFTNESS", "GB_UNIFORMITY", "GB_QUALITY", "GB_INTENT"]), peakRole: "柔化代表画面",
  changeRole: "柔化变化", temporalEvidence: false, protection: "符合要求的均匀柔化不作为拍摄失焦故障", evidenceScore: (frame: PixelFrame) => {
    const final = imageStats(frame.pixels, frame.width, frame.height); const base = imageStats(frame.baseline, frame.width, frame.height);
    return 1 - clamp(final.edgeEnergy / Math.max(1e-6, base.edgeEnergy), 0, 1);
  }, analyze: analyzeGaussianBlur });
export type GaussianBlurSelfCheckRequest = Omit<EffectSelfCheckRequest<typeof TOOL_NAME>, "toolName">;
export type GaussianBlurSelfCheckView = EffectSelfCheckView<typeof TOOL_NAME>;
export const queuedGaussianBlurSelfCheck = (): GaussianBlurSelfCheckView => queuedEffectSelfCheck(TOOL_NAME);
export const runGaussianBlurSelfCheck = (request: GaussianBlurSelfCheckRequest) => runEffectSelfCheck(SPEC, { ...request, toolName: TOOL_NAME });
