import { baseInformation, percent, radialContinuity, regionalChange, runEffectSelfCheck, semanticLevel, temporalActivity,
  type EffectSelfCheckRequest, type SelfCheckAnalysis, type SelfCheckAnalysisContext, type SelfCheckSpec
} from "./ten-tool-self-check-io.js";

export const RADIAL_WIPE_RULE_IDS = Object.freeze([
  "RADIAL_WIPE_SECTOR", "RADIAL_WIPE_DIRECTION", "RADIAL_WIPE_PROGRESS",
  "RADIAL_WIPE_CONTINUITY", "RADIAL_WIPE_FRAME_QUALITY"
] as const);

export function analyzeRadialWipeSelfCheck(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const frame = context.representative; const region = regionalChange(frame);
  const radial = radialContinuity(frame, region.minimumX, region.minimumY); const activity = temporalActivity(context.frames);
  const ratios = context.frames.map((item) => item.changedRatio);
  const monotonic = ratios.slice(1).filter((value, index) => value + 0.02 >= ratios[index]!).length / Math.max(1, ratios.length - 1);
  const progress = ratios.at(-1)! > 0.82 ? "接近完整切换" : ratios.at(-1)! > 0.35 ? "部分完成" : "变化范围较小";
  const radialEvidence = radial.pattern === "围绕中心旋转拖开" && frame.changedRatio > 0.02 && activity > 0.002;
  return Object.freeze({
    description: radialEvidence ? `成片形成围绕${region.minimumRegion}附近推进的扇形擦除，${progress}。`
      : "画面变化未形成可靠的扇形推进证据，不能把淡变或整帧切换当成径向擦除。",
    keyInformation: Object.freeze([...baseInformation("径向擦除", semanticLevel(frame.effectDelta, 0.025, 0.12)),
      { label: "擦除中心", value: radialEvidence ? `${region.minimumRegion}附近` : "无法可靠确认" },
      { label: "擦除进度", value: `${progress}（最终变化约 ${percent(ratios.at(-1)!)}）` },
      { label: "擦除方向", value: radialEvidence ? "沿圆周连续推进，顺逆方向需结合关键帧" : "无法可靠确认" },
      { label: "阶段连续性", value: monotonic >= 0.72 ? "覆盖总体连续增加" : "覆盖存在回退或跳切" }]),
    effect: Object.freeze({ 擦除中心: radialEvidence ? region.minimumRegion : "无法可靠确认", 擦除进度: progress,
      扇形推进: radialEvidence ? "可见" : "证据不足", 阶段连续性: monotonic >= 0.72 ? "连续" : "存在回退" }),
    missingInformation: Object.freeze(radialEvidence ? [] : ["擦除中心", "擦除方向"])
  });
}

const SPEC: SelfCheckSpec<"radial_wipe"> = Object.freeze({ toolName: "radial_wipe", displayName: "径向擦除",
  ruleIds: RADIAL_WIPE_RULE_IDS, peakRole: "最大擦除覆盖", changeRole: "扇形推进阶段", temporalEvidence: true,
  analyze: analyzeRadialWipeSelfCheck });

export function runRadialWipeSelfCheck(request: EffectSelfCheckRequest<"radial_wipe">) { return runEffectSelfCheck(SPEC, request); }
