import { baseInformation, percent, queuedEffectSelfCheck, regionalChange, rounded, runEffectSelfCheck, semanticLevel, temporalActivity,
  type EffectSelfCheckRequest, type EffectSelfCheckView, type PixelFrame, type SelfCheckAnalysis,
  type SelfCheckAnalysisContext, type SelfCheckSpec } from "./visual-quality-self-check-common.js";

const TOOL_NAME = "texture_overlay" as const;

function analyzeTextureOverlay(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const activity = temporalActivity(context.frames); const edge = context.baselineStats.edgeEnergy <= 1e-6 ? 1 : context.finalStats.edgeEnergy / context.baselineStats.edgeEnergy;
  const region = regionalChange(context.representative); const visibility = semanticLevel(context.representative.effectDelta, 0.01, 0.05);
  const coverage = context.representative.changedRatio > 0.7 ? "大面积覆盖" : context.representative.changedRatio > 0.25 ? "局部覆盖" : "小范围覆盖";
  const motion = activity <= 0.004 ? "纹理位置稳定" : activity <= 0.02 ? "纹理缓慢移动" : "纹理移动明显";
  const concentration = region.edge > region.center * 2 ? "效果偏向画面外围" : region.center > region.edge * 1.5 ? "效果集中在画面中央主体" : "效果在目标区域内较均匀";
  return Object.freeze({ description: `最终画面叠加${visibility}纹理，${coverage}，${motion}。`,
    keyInformation: Object.freeze([...baseInformation("纹理叠加", visibility),
      Object.freeze({ label: "覆盖范围", value: `${coverage}（约 ${percent(context.representative.changedRatio)}）` }),
      Object.freeze({ label: "目标集中度", value: concentration }), Object.freeze({ label: "纹理运动", value: motion }),
      Object.freeze({ label: "底图可辨性", value: edge >= 0.55 ? "底图主体仍清楚" : "纹理压盖底图较多" }),
      Object.freeze({ label: "接缝与拉伸", value: "结合关键帧检查重复接缝、突兀拉伸和边界溢出" })]),
    effect: Object.freeze({ texture_visibility: visibility,
      coverage: Object.freeze({ appearance: coverage, observed_picture_ratio: context.representative.changedRatio }),
      target_concentration: concentration, texture_motion: motion, base_picture_legibility: edge >= 0.55 ? "清楚" : "受压盖",
      base_contour_retention: rounded(edge, 4) }) });
}

const SPEC: SelfCheckSpec<typeof TOOL_NAME> = Object.freeze({ toolName: TOOL_NAME, displayName: "纹理叠加",
  ruleIds: Object.freeze(["TO_TEXTURE", "TO_COVERAGE", "TO_QUALITY", "TO_INTENT"]), peakRole: "纹理代表画面",
  changeRole: "纹理位移", temporalEvidence: true, protection: "底图原有纹理不作为叠加纹理已出现的证据",
  evidenceScore: (frame: PixelFrame) => frame.effectDelta + frame.temporalDelta, analyze: analyzeTextureOverlay });
export type TextureOverlaySelfCheckRequest = Omit<EffectSelfCheckRequest<typeof TOOL_NAME>, "toolName">;
export type TextureOverlaySelfCheckView = EffectSelfCheckView<typeof TOOL_NAME>;
export const queuedTextureOverlaySelfCheck = (): TextureOverlaySelfCheckView => queuedEffectSelfCheck(TOOL_NAME);
export const runTextureOverlaySelfCheck = (request: TextureOverlaySelfCheckRequest) => runEffectSelfCheck(SPEC, { ...request, toolName: TOOL_NAME });
