import { baseInformation, runEffectSelfCheck, semanticLevel,
  type EffectSelfCheckRequest, type PixelFrame, type SelfCheckAnalysis, type SelfCheckAnalysisContext, type SelfCheckSpec
} from "./ten-tool-self-check-io.js";

export const DEPTH_OF_FIELD_RULE_IDS = Object.freeze([
  "DEPTH_OF_FIELD_FOCUS", "DEPTH_OF_FIELD_BLUR_SEPARATION", "DEPTH_OF_FIELD_EDGE_SAFETY",
  "DEPTH_OF_FIELD_FOCUS_STABILITY", "DEPTH_OF_FIELD_FRAME_QUALITY"
] as const);
const REGIONS = ["左上", "上方", "右上", "左侧", "中央", "右侧", "左下", "下方", "右下"] as const;

function detailGrid(frame: PixelFrame): readonly number[] {
  const totals = new Array<number>(9).fill(0); const counts = new Array<number>(9).fill(0);
  const light = (x: number, y: number): number => { const offset = (y * frame.width + x) * 4;
    return (frame.pixels[offset]! + frame.pixels[offset + 1]! + frame.pixels[offset + 2]!) / 3; };
  for (let y = 1; y < frame.height - 1; y += 1) for (let x = 1; x < frame.width - 1; x += 1) {
    const value = Math.abs(light(x - 1, y) + light(x + 1, y) + light(x, y - 1) + light(x, y + 1) - 4 * light(x, y));
    const cell = Math.min(2, Math.floor(y / frame.height * 3)) * 3 + Math.min(2, Math.floor(x / frame.width * 3));
    totals[cell] = totals[cell]! + value; counts[cell] = counts[cell]! + 1;
  }
  return Object.freeze(totals.map((total, index) => total / Math.max(1, counts[index]!)));
}

export function analyzeDepthOfFieldSelfCheck(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const grids = context.frames.map(detailGrid); const grid = detailGrid(context.representative);
  const focusIndex = grid.indexOf(Math.max(...grid)); const sorted = [...grid].sort((a, b) => a - b);
  const contrast = (sorted[6] ?? 0) / Math.max(0.1, sorted[2] ?? 0); const detailEnough = Math.max(...grid) >= 1.2;
  const depth = contrast < 1.25 ? "焦内外差异较弱" : contrast < 2.5 ? "景深层次清楚" : "焦内外反差强";
  const focusSeries = grids.map((item) => item.indexOf(Math.max(...item)));
  const moves = focusSeries.slice(1).filter((value, index) => value !== focusSeries[index]).length;
  return Object.freeze({
    description: detailEnough ? `成片清晰焦点主要位于${REGIONS[focusIndex]}，${depth}。`
      : "源画面纹理不足，无法用实际局部清晰度可靠判断景深焦点。",
    keyInformation: Object.freeze([...baseInformation("景深", semanticLevel(context.representative.effectDelta, 0.008, 0.035)),
      { label: "清晰焦点", value: detailEnough ? REGIONS[focusIndex]! : "无法可靠确认" },
      { label: "焦内外层次", value: detailEnough ? depth : "无法可靠确认" },
      { label: "焦点稳定性", value: moves === 0 ? "焦点保持稳定" : `焦点区域出现 ${moves} 次可见转移` },
      { label: "边缘表现", value: contrast > 5 ? "反差很强，需检查边缘光晕" : "未见异常强烈的清晰度断层" }]),
    effect: Object.freeze({ 清晰焦点: detailEnough ? REGIONS[focusIndex]! : "无法可靠确认", 焦内外层次: depth,
      焦点稳定性: moves === 0 ? "稳定" : "发生转移", 误判保护: "低纹理区域不直接判为失焦" }),
    missingInformation: Object.freeze(detailEnough ? [] : ["清晰焦点", "焦内外层次"])
  });
}

const SPEC: SelfCheckSpec<"depth_of_field"> = Object.freeze({ toolName: "depth_of_field", displayName: "景深",
  ruleIds: DEPTH_OF_FIELD_RULE_IDS, peakRole: "焦内外差异最清晰", changeRole: "焦点区域变化", temporalEvidence: true,
  analyze: analyzeDepthOfFieldSelfCheck });

export function runDepthOfFieldSelfCheck(request: EffectSelfCheckRequest<"depth_of_field">) { return runEffectSelfCheck(SPEC, request); }
