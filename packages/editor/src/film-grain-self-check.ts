import { baseInformation, channelResiduals, queuedEffectSelfCheck, rounded, runEffectSelfCheck, semanticLevel,
  temporalActivity, type EffectSelfCheckRequest, type EffectSelfCheckView, type PixelFrame, type SelfCheckAnalysis,
  type SelfCheckAnalysisContext, type SelfCheckSpec } from "./visual-quality-self-check-common.js";

const TOOL_NAME = "film_grain" as const;

function analyzeFilmGrain(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const residual = channelResiduals(context.representative); const activity = temporalActivity(context.frames);
  const visibility = semanticLevel(residual.residualStrength, 0.008, 0.025);
  const scale = residual.neighborSimilarity > 0.55 ? "颗粒偏粗" : residual.neighborSimilarity > 0.2 ? "颗粒中等" : "颗粒细密";
  const color = residual.monochromeCorrelation > 0.82 ? "以黑白明暗颗粒为主" : "可见彩色颗粒差异";
  const motion = activity <= 0.004 ? "颗粒基本固定" : activity <= 0.018 ? "颗粒缓慢变化" : "颗粒随时间活跃变化";
  const detail = context.baselineStats.edgeEnergy <= 1e-6 ? 1 : context.finalStats.edgeEnergy / context.baselineStats.edgeEnergy;
  return Object.freeze({
    description: `最终画面呈现${visibility}、${scale}的胶片颗粒，${color}，${motion}。`,
    keyInformation: Object.freeze([...baseInformation("胶片颗粒", visibility), Object.freeze({ label: "颗粒尺度", value: scale }),
      Object.freeze({ label: "颗粒颜色", value: color }), Object.freeze({ label: "时间变化", value: motion }),
      Object.freeze({ label: "原始细节", value: detail >= 0.75 ? "主体细节保持" : "细节被颗粒覆盖较多" })]),
    effect: Object.freeze({ grain_visibility: visibility, grain_scale: scale, grain_color: color, grain_motion: motion,
      picture_detail_retention: rounded(detail, 4), intended_grain_is_not_fault_noise: true })
  });
}

const SPEC: SelfCheckSpec<typeof TOOL_NAME> = Object.freeze({ toolName: TOOL_NAME, displayName: "胶片颗粒",
  ruleIds: Object.freeze(["FG_GRAIN", "FG_TEMPORAL", "FG_DETAIL", "FG_INTENT"]), peakRole: "颗粒代表画面",
  changeRole: "颗粒变化", temporalEvidence: true, protection: "正常胶片颗粒不作为噪声故障",
  evidenceScore: (frame: PixelFrame) => channelResiduals(frame).residualStrength + frame.temporalDelta,
  analyze: analyzeFilmGrain });
export type FilmGrainSelfCheckRequest = Omit<EffectSelfCheckRequest<typeof TOOL_NAME>, "toolName">;
export type FilmGrainSelfCheckView = EffectSelfCheckView<typeof TOOL_NAME>;
export const queuedFilmGrainSelfCheck = (): FilmGrainSelfCheckView => queuedEffectSelfCheck(TOOL_NAME);
export const runFilmGrainSelfCheck = (request: FilmGrainSelfCheckRequest) => runEffectSelfCheck(SPEC, { ...request, toolName: TOOL_NAME });
