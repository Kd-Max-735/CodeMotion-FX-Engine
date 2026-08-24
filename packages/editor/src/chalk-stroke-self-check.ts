import { baseInformation, percent, runEffectSelfCheck, semanticLevel, temporalActivity,
  type EffectSelfCheckRequest, type PixelFrame, type SelfCheckAnalysis, type SelfCheckAnalysisContext, type SelfCheckSpec
} from "./ten-tool-self-check-io.js";

export const CHALK_STROKE_RULE_IDS = Object.freeze([
  "CHALK_STROKE_COVERAGE", "CHALK_STROKE_GRAIN", "CHALK_STROKE_SCATTER",
  "CHALK_STROKE_CONTINUITY", "CHALK_STROKE_FRAME_QUALITY"
] as const);

function chalkTexture(frame: PixelFrame): Readonly<{ grain: number; dust: number }> {
  let changed = 0; let alternating = 0; let dust = 0;
  for (let y = 1; y < frame.height - 1; y += 1) for (let x = 1; x < frame.width - 1; x += 1) {
    const offset = (y * frame.width + x) * 4;
    const value = Math.abs(frame.pixels[offset]! - frame.baseline[offset]!)
      + Math.abs(frame.pixels[offset + 1]! - frame.baseline[offset + 1]!)
      + Math.abs(frame.pixels[offset + 2]! - frame.baseline[offset + 2]!);
    if (value < 42) continue; changed += 1;
    const right = offset + 4; const neighbor = Math.abs(frame.pixels[right]! - frame.baseline[right]!)
      + Math.abs(frame.pixels[right + 1]! - frame.baseline[right + 1]!)
      + Math.abs(frame.pixels[right + 2]! - frame.baseline[right + 2]!);
    if (Math.abs(value - neighbor) > 60) alternating += 1; if (neighbor < 24) dust += 1;
  }
  return Object.freeze({ grain: alternating / Math.max(1, changed), dust: dust / Math.max(1, changed) });
}

export function analyzeChalkStrokeSelfCheck(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const frame = context.representative; const texture = chalkTexture(frame); const activity = temporalActivity(context.frames);
  const grain = texture.grain < 0.18 ? "细腻" : texture.grain < 0.42 ? "自然颗粒" : "粗粝断续";
  const dust = texture.dust < 0.08 ? "散粉很少" : texture.dust < 0.24 ? "少量散粉" : "散粉较明显";
  const continuity = texture.dust > 0.48 ? "主笔迹可能被碎点打断" : "主笔迹保持可辨识";
  const visible = frame.changedRatio >= 0.001; const info = [...baseInformation("粉笔描边", semanticLevel(frame.effectDelta, 0.01, 0.04)),
    { label: "描边覆盖", value: `成片可见区域约 ${percent(frame.changedRatio)}` },
    { label: "粉笔颗粒", value: grain }, { label: "散粉表现", value: dust },
    { label: "描边阶段", value: activity > 0.004 ? "可见描边进度变化" : "描边状态保持稳定" }];
  return Object.freeze({
    description: visible ? `成片粉笔描边呈${grain}质感，${dust}，${continuity}。` : "成片中未观察到可辨认的粉笔描边。",
    keyInformation: Object.freeze(info),
    effect: Object.freeze({ 描边覆盖: percent(frame.changedRatio), 粉笔颗粒: grain, 散粉表现: dust, 笔迹完整性: continuity }),
    missingInformation: Object.freeze(visible && frame.changedRatio < 0.65 ? [] : ["粉笔描边与大面积画面变化的区分"])
  });
}

const SPEC: SelfCheckSpec<"chalk_stroke"> = Object.freeze({ toolName: "chalk_stroke", displayName: "粉笔描边",
  ruleIds: CHALK_STROKE_RULE_IDS, peakRole: "最大描边覆盖", changeRole: "描边阶段变化", temporalEvidence: true,
  analyze: analyzeChalkStrokeSelfCheck });

export function runChalkStrokeSelfCheck(request: EffectSelfCheckRequest<"chalk_stroke">) {
  return runEffectSelfCheck(SPEC, request);
}
