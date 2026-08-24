import { baseInformation, channelResiduals, directionLabel, percent, queuedEffectSelfCheck, regionalChange, runEffectSelfCheck, semanticLevel,
  type EffectSelfCheckRequest, type EffectSelfCheckView, type PixelFrame, type SelfCheckAnalysis,
  type SelfCheckAnalysisContext, type SelfCheckSpec } from "./visual-quality-self-check-common.js";

const TOOL_NAME = "rgb_split" as const;

function analyzeRgbSplit(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const residual = channelResiduals(context.representative); const region = regionalChange(context.representative);
  const contour = context.baselineStats.edgeEnergy <= 1e-6 ? 1 : context.finalStats.edgeEnergy / context.baselineStats.edgeEnergy;
  const direction = directionLabel(residual.directionX, residual.directionY);
  const shape = region.edge > region.center * 1.35 ? "由中心向外分离" : "沿统一轴向对称分离";
  const visibility = semanticLevel(context.representative.effectDelta, 0.01, 0.045);
  return Object.freeze({ description: `最终画面出现${visibility} RGB 分离，红蓝通道沿${direction}错开，表现为${shape}。`,
    keyInformation: Object.freeze([...baseInformation("RGB 分离", visibility),
      Object.freeze({ label: "红蓝错位", value: `${direction}，观测跨度约 ${residual.redBlueDistance} 像素` }),
      Object.freeze({ label: "分离形态", value: shape }), Object.freeze({ label: "绿色主体", value: "绿色通道作为主体轮廓参照" }),
      Object.freeze({ label: "画面覆盖", value: percent(context.representative.changedRatio) })]),
    effect: Object.freeze({ rgb_separation: Object.freeze({ appearance: visibility, direction, observed_span_px: residual.redBlueDistance }),
      separation_shape: shape, affected_picture_ratio: context.representative.changedRatio,
      green_subject_reference: "保持为主体轮廓参照", subject_contour_retention: Math.round(contour * 10_000) / 10_000 }) });
}

const SPEC: SelfCheckSpec<typeof TOOL_NAME> = Object.freeze({ toolName: TOOL_NAME, displayName: "RGB 分离",
  ruleIds: Object.freeze(["RS_CHANNELS", "RS_SHAPE", "RS_QUALITY", "RS_INTENT"]), peakRole: "通道分离最明显",
  changeRole: "分离变化", temporalEvidence: false, protection: "整幅偏色或素材原有彩边不作为 RGB 通道分离证据", evidenceScore: (frame: PixelFrame) => {
    const residual = channelResiduals(frame); return residual.residualStrength + residual.redBlueDistance / Math.max(frame.width, frame.height);
  }, analyze: analyzeRgbSplit });
export type RgbSplitSelfCheckRequest = Omit<EffectSelfCheckRequest<typeof TOOL_NAME>, "toolName">;
export type RgbSplitSelfCheckView = EffectSelfCheckView<typeof TOOL_NAME>;
export const queuedRgbSplitSelfCheck = (): RgbSplitSelfCheckView => queuedEffectSelfCheck(TOOL_NAME);
export const runRgbSplitSelfCheck = (request: RgbSplitSelfCheckRequest) => runEffectSelfCheck(SPEC, { ...request, toolName: TOOL_NAME });
