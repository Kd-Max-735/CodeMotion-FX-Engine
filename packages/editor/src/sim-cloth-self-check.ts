import { baseInformation, imageStats, runEffectSelfCheck, semanticLevel, temporalActivity,
  type EffectSelfCheckRequest, type SelfCheckAnalysis, type SelfCheckAnalysisContext, type SelfCheckSpec
} from "./ten-tool-self-check-io.js";

export const SIM_CLOTH_RULE_IDS = Object.freeze([
  "SIM_CLOTH_NON_RIGID_MOTION", "SIM_CLOTH_FOLDS", "SIM_CLOTH_ANCHOR_STABILITY",
  "SIM_CLOTH_CONTINUITY", "SIM_CLOTH_FRAME_QUALITY"
] as const);

export function analyzeSimClothSelfCheck(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const frame = context.representative; const activity = temporalActivity(context.frames);
  const details = context.frames.map((item) => imageStats(item.pixels, item.width, item.height).fineDetail);
  const foldRange = Math.max(...details) - Math.min(...details); const motion = activity < 0.006 ? "轻微摆动" : activity < 0.03 ? "自然摆动" : "大幅摆动";
  const folds = foldRange < 0.006 ? "褶皱较平缓" : foldRange < 0.025 ? "褶皱层次可见" : "褶皱明暗强烈";
  const localized = frame.changedRatio > 0.025 && frame.changedRatio < 0.82;
  const jumps = context.frames.slice(1).filter((item, index) => Math.abs(item.temporalDelta - context.frames[index]!.temporalDelta) > 0.22).length;
  return Object.freeze({
    description: localized ? `布面呈${motion}，${folds}，非刚性形变在时间上${jumps === 0 ? "连续" : "存在突跳"}。`
      : "局部非刚性形变证据不足，不能把整幅画面的平移或缩放当成布料模拟。",
    keyInformation: Object.freeze([...baseInformation("布料模拟", semanticLevel(frame.effectDelta, 0.02, 0.08)),
      { label: "布面运动", value: localized ? motion : "无法可靠确认" }, { label: "褶皱表现", value: folds },
      { label: "形变连续性", value: jumps === 0 ? "连续" : "存在突跳风险" },
      { label: "锚点稳定", value: localized ? "局部固定区域与摆动区域可区分" : "无法可靠确认" }]),
    effect: Object.freeze({ 布面运动: localized ? motion : "无法可靠确认", 褶皱表现: folds,
      形变连续性: jumps === 0 ? "连续" : "存在突跳", 误判保护: "整画面平移不作为布料形变证据" }),
    missingInformation: Object.freeze(localized ? [] : ["布面运动", "锚点稳定"])
  });
}

const SPEC: SelfCheckSpec<"sim_cloth"> = Object.freeze({ toolName: "sim_cloth", displayName: "布料模拟",
  ruleIds: SIM_CLOTH_RULE_IDS, peakRole: "最大布面形变", changeRole: "摆动或褶皱变化", temporalEvidence: true,
  analyze: analyzeSimClothSelfCheck });

export function runSimClothSelfCheck(request: EffectSelfCheckRequest<"sim_cloth">) { return runEffectSelfCheck(SPEC, request); }
