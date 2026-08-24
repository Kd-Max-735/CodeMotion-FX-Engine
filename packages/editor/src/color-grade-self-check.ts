import { baseInformation, imageStats, percent, queuedEffectSelfCheck, rounded, runEffectSelfCheck, semanticLevel,
  type EffectSelfCheckRequest, type EffectSelfCheckView, type PixelFrame, type SelfCheckAnalysis,
  type SelfCheckAnalysisContext, type SelfCheckSpec } from "./visual-quality-self-check-common.js";

const TOOL_NAME = "color_grade" as const;

function analyzeColorGrade(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const brightness = context.finalStats.luminance - context.baselineStats.luminance;
  const saturation = context.finalStats.saturation - context.baselineStats.saturation;
  const warmth = context.finalStats.warmth - context.baselineStats.warmth;
  const tint = context.finalStats.tint - context.baselineStats.tint;
  const brightnessText = Math.abs(brightness) < 0.01 ? "明暗基本保持" : brightness > 0 ? "整体提亮" : "整体压暗";
  const saturationText = Math.abs(saturation) < 0.01 ? "饱和度基本保持" : saturation > 0 ? "色彩更鲜明" : "色彩更克制";
  const temperatureText = Math.abs(warmth) < 0.008 ? "冷暖基本中性" : warmth > 0 ? "整体偏暖" : "整体偏冷";
  const tintText = Math.abs(tint) < 0.006 ? "未见明显偏绿或偏洋红" : tint > 0 ? "略偏洋红" : "略偏绿";
  return Object.freeze({
    description: `最终画面完成色彩分级，${brightnessText}，${saturationText}，${temperatureText}。`,
    keyInformation: Object.freeze([
      ...baseInformation("色彩分级", `${semanticLevel(context.representative.effectDelta, 0.008, 0.04)}（画面变化覆盖 ${percent(context.representative.changedRatio)}）`),
      Object.freeze({ label: "明暗", value: brightnessText }), Object.freeze({ label: "色彩浓度", value: saturationText }),
      Object.freeze({ label: "冷暖", value: temperatureText }), Object.freeze({ label: "色偏", value: tintText }),
      Object.freeze({ label: "高光与暗部", value: `暗部贴边 ${percent(context.finalStats.shadowClipRatio)}，高光贴边 ${percent(context.finalStats.highlightClipRatio)}` })
    ]),
    effect: Object.freeze({
      brightness_change: Object.freeze({ appearance: brightnessText, observed_change: rounded(brightness, 4) }),
      colorfulness_change: Object.freeze({ appearance: saturationText, observed_change: rounded(saturation, 4) }),
      temperature_change: Object.freeze({ appearance: temperatureText, observed_change: rounded(warmth, 4) }),
      tint_change: Object.freeze({ appearance: tintText, observed_change: rounded(tint, 4) }),
      dark_area_at_picture_limit: context.finalStats.shadowClipRatio,
      bright_area_at_picture_limit: context.finalStats.highlightClipRatio
    })
  });
}

const SPEC: SelfCheckSpec<typeof TOOL_NAME> = Object.freeze({ toolName: TOOL_NAME, displayName: "色彩分级",
  ruleIds: Object.freeze(["CG_TONE", "CG_COLOR", "CG_QUALITY", "CG_INTENT"]), peakRole: "分级代表画面",
  changeRole: "色彩变化", temporalEvidence: false, protection: "素材原有色调不作为色彩分级已生效的证据", evidenceScore: (frame: PixelFrame) => {
    const final = imageStats(frame.pixels, frame.width, frame.height); const base = imageStats(frame.baseline, frame.width, frame.height);
    return Math.abs(final.luminance - base.luminance) + Math.abs(final.saturation - base.saturation)
      + Math.abs(final.warmth - base.warmth) + Math.abs(final.tint - base.tint);
  }, analyze: analyzeColorGrade });
export type ColorGradeSelfCheckRequest = Omit<EffectSelfCheckRequest<typeof TOOL_NAME>, "toolName">;
export type ColorGradeSelfCheckView = EffectSelfCheckView<typeof TOOL_NAME>;
export const queuedColorGradeSelfCheck = (): ColorGradeSelfCheckView => queuedEffectSelfCheck(TOOL_NAME);
export const runColorGradeSelfCheck = (request: ColorGradeSelfCheckRequest) => runEffectSelfCheck(SPEC, { ...request, toolName: TOOL_NAME });
