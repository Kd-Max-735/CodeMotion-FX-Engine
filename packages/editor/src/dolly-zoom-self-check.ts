import { baseInformation, runEffectSelfCheck, semanticLevel, temporalActivity,
  type EffectSelfCheckRequest, type PixelFrame, type SelfCheckAnalysis, type SelfCheckAnalysisContext, type SelfCheckSpec
} from "./ten-tool-self-check-io.js";

export const DOLLY_ZOOM_RULE_IDS = Object.freeze([
  "DOLLY_ZOOM_SUBJECT_SCALE", "DOLLY_ZOOM_BACKGROUND_FLOW", "DOLLY_ZOOM_DIRECTION",
  "DOLLY_ZOOM_CONTINUITY", "DOLLY_ZOOM_FRAME_QUALITY"
] as const);

function edgeRadius(frame: PixelFrame, centerOnly: boolean): number {
  let total = 0; let weight = 0;
  const cx = (frame.width - 1) / 2; const cy = (frame.height - 1) / 2;
  const maxRadius = Math.hypot(cx, cy);
  const luma = (x: number, y: number): number => {
    const offset = (y * frame.width + x) * 4;
    return frame.pixels[offset]! * 0.2126 + frame.pixels[offset + 1]! * 0.7152 + frame.pixels[offset + 2]! * 0.0722;
  };
  for (let y = 1; y < frame.height - 1; y += 2) for (let x = 1; x < frame.width - 1; x += 2) {
    const radius = Math.hypot(x - cx, y - cy) / Math.max(1, maxRadius);
    if (centerOnly ? radius > 0.28 : radius < 0.48) continue;
    const edge = Math.abs(luma(x + 1, y) - luma(x - 1, y)) + Math.abs(luma(x, y + 1) - luma(x, y - 1));
    total += radius * edge; weight += edge;
  }
  return weight <= 0 ? 0 : total / weight;
}

export function analyzeDollyZoomSelfCheck(context: SelfCheckAnalysisContext): SelfCheckAnalysis {
  const frames = context.frames; const peripheral = frames.map((frame) => edgeRadius(frame, false));
  const central = frames.map((frame) => edgeRadius(frame, true));
  const peripheralTravel = peripheral.at(-1)! - peripheral[0]!;
  const centerTravel = Math.abs(central.at(-1)! - central[0]!);
  const direction = Math.abs(peripheralTravel) < 0.005 ? "外围空间变化不明显"
    : peripheralTravel > 0 ? "背景向外展开" : "背景向中心收拢";
  const movement = semanticLevel(Math.abs(peripheralTravel), 0.012, 0.04);
  const protectedSubject = centerTravel <= Math.max(0.012, Math.abs(peripheralTravel) * 0.55);
  const deltas = frames.map((frame) => frame.temporalDelta);
  const turnIndex = deltas.findIndex((_, index) => index > 1
    && Math.sign(peripheral[index + 1]! - peripheral[index]!) !== Math.sign(peripheral[index]! - peripheral[index - 1]!));
  const reliable = Math.abs(peripheralTravel) >= 0.005 && temporalActivity(frames) > 0.002;
  return Object.freeze({
    description: reliable ? `推拉变焦产生${movement}的${direction}效果，中央主体${protectedSubject ? "大小基本稳定" : "出现明显尺度漂移"}。`
      : "未观察到中央主体受保护且外围空间发生差异变化的证据，不能把普通缩放误判为推拉变焦。",
    keyInformation: Object.freeze([...baseInformation("推拉变焦镜头", semanticLevel(context.representative.effectDelta, 0.02, 0.08)),
      { label: "镜头空间变化", value: reliable ? `${movement}，${direction}` : "无法可靠确认" },
      { label: "中央主体", value: protectedSubject ? "投影大小基本稳定" : "大小变化明显" },
      { label: "起终关系", value: turnIndex > 0 ? "中途折返" : "单向推进" },
      { label: "画面连续性", value: Math.max(...deltas, 0) > 0.35 ? "存在跳切或撕裂风险" : "镜头变化连续" }]),
    effect: Object.freeze({ 镜头空间变化: reliable ? direction : "无法可靠确认", 效果强度: movement,
      中央主体: protectedSubject ? "大小基本稳定" : "大小变化明显", 起终关系: turnIndex > 0 ? "中途折返" : "单向推进",
      误判保护: "中央与外围同幅缩放不作为推拉变焦证据" }),
    missingInformation: Object.freeze(reliable ? [] : ["镜头空间变化"]),
  });
}

const SPEC: SelfCheckSpec<"dolly_zoom"> = Object.freeze({ toolName: "dolly_zoom", displayName: "推拉变焦镜头",
  ruleIds: DOLLY_ZOOM_RULE_IDS, peakRole: "空间变化峰值", changeRole: "镜头推进或折返", temporalEvidence: true,
  analyze: analyzeDollyZoomSelfCheck });

export function runDollyZoomSelfCheck(request: EffectSelfCheckRequest<"dolly_zoom">) { return runEffectSelfCheck(SPEC, request); }
