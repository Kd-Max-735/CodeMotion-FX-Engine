import { baseInformation, runEffectSelfCheck, semanticLevel, temporalActivity,
  type EffectSelfCheckRequest, type PixelFrame, type SelfCheckAnalysis, type SelfCheckAnalysisContext, type SelfCheckSpec
} from "./ten-tool-self-check-io.js";

export const SHAKE_RULE_IDS = Object.freeze([
  "SHAKE_GLOBAL_MOTION", "SHAKE_PEAK_STRENGTH", "SHAKE_RHYTHM",
  "SHAKE_DECAY", "SHAKE_FRAME_QUALITY"
] as const);

function translation(frame: PixelFrame, limit = 8): readonly [number, number, number] {
  let best = Number.POSITIVE_INFINITY; let second = Number.POSITIVE_INFINITY; let bx = 0; let by = 0;
  for (let dy = -limit; dy <= limit; dy += 1) for (let dx = -limit; dx <= limit; dx += 1) {
    let error = 0; let count = 0;
    for (let y = limit; y < frame.height - limit; y += 6) for (let x = limit; x < frame.width - limit; x += 6) {
      const a = (y * frame.width + x) * 4; const b = ((y + dy) * frame.width + x + dx) * 4;
      error += Math.abs(frame.baseline[a]! - frame.pixels[b]!) + Math.abs(frame.baseline[a + 1]! - frame.pixels[b + 1]!)
        + Math.abs(frame.baseline[a + 2]! - frame.pixels[b + 2]!); count += 3;
    }
    const value = error / Math.max(1, count);
    if (value < best) { second = best; best = value; bx = dx; by = dy; } else if (value < second) second = value;
  }
  return [bx, by, second <= 0 ? 0 : (second - best) / second];
}

export function analyzeShakeSelfCheck(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const shifts = context.frames.map((frame) => translation(frame)); const magnitudes = shifts.map((item) => Math.hypot(item[0], item[1]));
  const peak = Math.max(...magnitudes); const early = Math.max(...magnitudes.slice(0, Math.ceil(magnitudes.length * 0.5)));
  const late = magnitudes.slice(Math.floor(magnitudes.length * 0.75)).reduce((sum, value) => sum + value, 0)
    / Math.max(1, magnitudes.length - Math.floor(magnitudes.length * 0.75));
  const reversals = shifts.slice(1).filter((item, index) => item[0] * shifts[index]![0] + item[1] * shifts[index]![1] < 0).length;
  const confidence = shifts.filter((item) => item[2] > 0.002).length / Math.max(1, shifts.length);
  const strength = peak <= 1 ? "轻微" : peak <= 4 ? "中等" : "明显";
  const rhythm = reversals <= 1 ? "顿挫" : reversals <= 4 ? "自然" : "密集";
  const decay = early <= 0.5 ? "未见明显冲击" : late <= early * 0.4 ? "明显衰减并趋稳" : "持续到后段";
  const reliable = confidence >= 0.35 && temporalActivity(context.frames) > 0.002;
  return Object.freeze({
    description: reliable ? `整幅画面出现${strength}、${rhythm}的冲击震动，并${decay}。`
      : "整画面同步位移证据不足，不能把局部主体运动或镜头切换误判为冲击震动。",
    keyInformation: Object.freeze([...baseInformation("冲击震动", semanticLevel(context.representative.effectDelta, 0.02, 0.08)),
      { label: "震动强度", value: reliable ? strength : "无法可靠确认" }, { label: "震动节奏", value: reliable ? rhythm : "无法可靠确认" },
      { label: "衰减表现", value: decay }, { label: "整画面一致性", value: reliable ? "多数画面区域同步位移" : "一致性不足" }]),
    effect: Object.freeze({ 震动强度: reliable ? strength : "无法可靠确认", 震动节奏: rhythm, 衰减表现: decay,
      误判保护: reliable ? "已确认整画面同步位移" : "局部运动不作为震动证据" }),
    missingInformation: Object.freeze(reliable ? [] : ["震动强度", "震动节奏"])
  });
}

const SPEC: SelfCheckSpec<"shake"> = Object.freeze({ toolName: "shake", displayName: "冲击震动", ruleIds: SHAKE_RULE_IDS,
  peakRole: "震动峰值", changeRole: "反向回摆或衰减", temporalEvidence: true, analyze: analyzeShakeSelfCheck });

export function runShakeSelfCheck(request: EffectSelfCheckRequest<"shake">) { return runEffectSelfCheck(SPEC, request); }
