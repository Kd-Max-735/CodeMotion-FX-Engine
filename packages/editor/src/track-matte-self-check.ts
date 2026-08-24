import { baseInformation, matteFacts, percent, queuedEffectSelfCheck, runEffectSelfCheck,
  type EffectSelfCheckRequest, type EffectSelfCheckView, type PixelFrame, type SelfCheckAnalysis,
  type SelfCheckAnalysisContext, type SelfCheckSpec } from "./visual-quality-self-check-common.js";

const TOOL_NAME = "track_matte" as const;

function analyzeTrackMatte(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const facts = matteFacts(context.representative); const retained = facts.retained >= facts.hidden ? "保留区域为主" : "隐藏区域为主";
  const visibility = context.representative.changedRatio < 0.01 ? "轻微" : context.representative.changedRatio < 0.4 ? "中等" : "明显";
  return Object.freeze({ description: `最终画面完成轨道遮罩，${retained}，${facts.boundaryContinuity}。`,
    keyInformation: Object.freeze([...baseInformation("轨道遮罩", visibility), Object.freeze({ label: "保留画面", value: `约 ${percent(facts.retained)}` }),
      Object.freeze({ label: "隐藏画面", value: `约 ${percent(facts.hidden)}` }), Object.freeze({ label: "过渡区域", value: `约 ${percent(facts.transition)}` }),
      Object.freeze({ label: "遮罩边界", value: facts.boundaryContinuity }), Object.freeze({ label: "主体状态", value: retained })]),
    effect: Object.freeze({ retained_picture_ratio: facts.retained, hidden_picture_ratio: facts.hidden,
      transition_picture_ratio: facts.transition, boundary_appearance: facts.boundaryContinuity, retained_area_appearance: retained }) });
}

const SPEC: SelfCheckSpec<typeof TOOL_NAME> = Object.freeze({ toolName: TOOL_NAME, displayName: "轨道遮罩",
  ruleIds: Object.freeze(["TM_COVERAGE", "TM_BOUNDARY", "TM_QUALITY", "TM_INTENT"]), peakRole: "遮罩代表画面",
  changeRole: "遮罩变化", temporalEvidence: false, protection: "符合要求的隐藏区不作为黑帧或画面丢失故障", evidenceScore: (frame: PixelFrame) => {
    const facts = matteFacts(frame); return frame.effectDelta + facts.transition;
  }, analyze: analyzeTrackMatte });
export type TrackMatteSelfCheckRequest = Omit<EffectSelfCheckRequest<typeof TOOL_NAME>, "toolName">;
export type TrackMatteSelfCheckView = EffectSelfCheckView<typeof TOOL_NAME>;
export const queuedTrackMatteSelfCheck = (): TrackMatteSelfCheckView => queuedEffectSelfCheck(TOOL_NAME);
export const runTrackMatteSelfCheck = (request: TrackMatteSelfCheckRequest) => runEffectSelfCheck(SPEC, { ...request, toolName: TOOL_NAME });
