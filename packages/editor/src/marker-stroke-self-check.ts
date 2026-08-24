import {
  baseInformation,
  percent,
  runEffectSelfCheck,
  semanticLevel,
  temporalActivity,
  type EffectSelfCheckRequest,
  type PixelFrame,
  type SelfCheckAnalysis,
  type SelfCheckAnalysisContext,
  type SelfCheckSpec
} from "./ten-tool-self-check-io.js";

export const MARKER_STROKE_RULE_IDS = Object.freeze([
  "MARKER_STROKE_COVERAGE", "MARKER_STROKE_TEXTURE", "MARKER_STROKE_REVEAL",
  "MARKER_STROKE_MASK_SAFETY", "MARKER_STROKE_FRAME_QUALITY"
] as const);

function markerFacts(frame: PixelFrame): Readonly<{ roughness: number; isolated: number }> {
  const changed = new Uint8Array(frame.width * frame.height); let boundary = 0; let isolated = 0; let count = 0;
  for (let index = 0; index < changed.length; index += 1) {
    const offset = index * 4;
    const delta = Math.max(Math.abs(frame.pixels[offset]! - frame.baseline[offset]!),
      Math.abs(frame.pixels[offset + 1]! - frame.baseline[offset + 1]!),
      Math.abs(frame.pixels[offset + 2]! - frame.baseline[offset + 2]!));
    if (delta >= 18) { changed[index] = 1; count += 1; }
  }
  for (let y = 1; y < frame.height - 1; y += 1) for (let x = 1; x < frame.width - 1; x += 1) {
    const index = y * frame.width + x; if (changed[index] === 0) continue;
    const neighbors = changed[index - 1]! + changed[index + 1]! + changed[index - frame.width]! + changed[index + frame.width]!;
    if (neighbors < 4) boundary += 1; if (neighbors <= 1) isolated += 1;
  }
  return Object.freeze({ roughness: boundary / Math.max(1, count), isolated: isolated / Math.max(1, count) });
}

export function analyzeMarkerStrokeSelfCheck(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const frame = context.representative; const facts = markerFacts(frame); const activity = temporalActivity(context.frames);
  const coverage = frame.changedRatio < 0.045 ? "局部覆盖" : frame.changedRatio < 0.2 ? "适中覆盖" : "大范围覆盖";
  const texture = facts.roughness < 0.12 ? "边缘平整" : facts.roughness < 0.34 ? "带自然手绘起伏" : "边缘粗粝";
  const fragments = facts.isolated < 0.025 ? "笔迹连贯" : facts.isolated < 0.09 ? "有少量离散墨点" : "离散碎点较多";
  const visible = frame.changedRatio >= 0.001; const localized = frame.changedRatio <= 0.68;
  const info = [...baseInformation("马克笔涂抹", semanticLevel(frame.effectDelta, 0.012, 0.05)),
    { label: "描边覆盖", value: `${coverage}（成片可见区域约 ${percent(frame.changedRatio)}）` },
    { label: "笔触质感", value: `${texture}，${fragments}` },
    { label: "落笔过程", value: activity > 0.004 ? "可见覆盖随时间展开" : "涂抹在抽查时段保持稳定" }];
  return Object.freeze({
    description: visible ? `成片呈现${coverage}的马克笔笔迹，${texture}且${fragments}。` : "成片中未观察到可辨认的马克笔笔迹。",
    keyInformation: Object.freeze(info),
    effect: Object.freeze({ 描边覆盖: coverage, 笔触质感: texture, 落笔状态: activity > 0.004 ? "逐步展开" : "保持稳定", 边缘完整性: fragments }),
    missingInformation: Object.freeze(visible && localized ? [] : ["无法把笔迹与整画面变化可靠分开"])
  });
}

const SPEC: SelfCheckSpec<"marker_stroke"> = Object.freeze({
  toolName: "marker_stroke", displayName: "马克笔涂抹", ruleIds: MARKER_STROKE_RULE_IDS,
  peakRole: "最大涂抹覆盖", changeRole: "落笔推进", temporalEvidence: true, analyze: analyzeMarkerStrokeSelfCheck
});

export function runMarkerStrokeSelfCheck(request: EffectSelfCheckRequest<"marker_stroke">) {
  return runEffectSelfCheck(SPEC, request);
}
