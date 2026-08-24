import {
  baseInformation,
  channelResiduals,
  directionLabel,
  percent,
  queuedEffectSelfCheck,
  regionalChange,
  runEffectSelfCheck,
  semanticLevel,
  type EffectSelfCheckRequest,
  type EffectSelfCheckView,
  type PixelFrame,
  type SelfCheckAnalysis,
  type SelfCheckAnalysisContext,
  type SelfCheckSpec
} from "./visual-quality-self-check-common.js";

const TOOL_NAME = "chromatic_aberration" as const;

function analyzeChromaticAberration(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const residual = channelResiduals(context.representative);
  const region = regionalChange(context.representative);
  const visibility = semanticLevel(context.representative.effectDelta, 0.008, 0.035);
  const distribution = region.edge > region.center * 1.25 ? "画面边缘更明显" : "全画面较均匀";
  const direction = directionLabel(residual.directionX, residual.directionY);
  return Object.freeze({
    description: `最终画面出现${visibility}色差，红蓝边缘沿${direction}分开，${distribution}。`,
    keyInformation: Object.freeze([
      ...baseInformation("色差", `${visibility}（画面变化覆盖 ${percent(context.representative.changedRatio)}）`),
      Object.freeze({ label: "通道边缘", value: `红蓝边缘分离，方向${direction}` }),
      Object.freeze({ label: "画面分布", value: distribution }),
      Object.freeze({ label: "通道错位", value: `观测跨度约 ${residual.redBlueDistance} 像素` }),
      Object.freeze({ label: "主体清晰度", value: context.finalStats.edgeEnergy >= context.baselineStats.edgeEnergy * 0.65 ? "主体轮廓仍可辨" : "主体轮廓软化明显" })
    ]),
    effect: Object.freeze({
      channel_separation: Object.freeze({ appearance: visibility, direction, observed_span_px: residual.redBlueDistance }),
      distribution,
      affected_picture_ratio: context.representative.changedRatio,
      subject_legibility: context.finalStats.edgeEnergy >= context.baselineStats.edgeEnergy * 0.65 ? "清楚" : "偏软"
    })
  });
}

const SPEC: SelfCheckSpec<typeof TOOL_NAME> = Object.freeze({
  toolName: TOOL_NAME,
  displayName: "色差",
  ruleIds: Object.freeze(["CA_EFFECT", "CA_CHANNELS", "CA_QUALITY", "CA_INTENT"]),
  peakRole: "色差最明显",
  changeRole: "通道变化",
  temporalEvidence: false,
  protection: "素材原有彩色边缘与整幅偏色不作为色差已生效的证据",
  evidenceScore: (frame: PixelFrame) => channelResiduals(frame).residualStrength + regionalChange(frame).edge,
  analyze: analyzeChromaticAberration
});

export type ChromaticAberrationSelfCheckRequest = Omit<EffectSelfCheckRequest<typeof TOOL_NAME>, "toolName">;
export type ChromaticAberrationSelfCheckView = EffectSelfCheckView<typeof TOOL_NAME>;

export function queuedChromaticAberrationSelfCheck(): ChromaticAberrationSelfCheckView {
  return queuedEffectSelfCheck(TOOL_NAME);
}

export function runChromaticAberrationSelfCheck(request: ChromaticAberrationSelfCheckRequest) {
  return runEffectSelfCheck(SPEC, { ...request, toolName: TOOL_NAME });
}
