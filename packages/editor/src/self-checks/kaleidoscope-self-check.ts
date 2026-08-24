import type { VisualEffectAnalyzer } from "../visual-effect-self-check.js";
import { commonInfo, diverseSelection, semantic, temporalSummary } from "./self-check-analysis-shared.js";

export const selfCheckKaleidoscope: VisualEffectAnalyzer = (frames) => {
  const temporal = temporalSummary(frames, 0.24, 0.003);
  const symmetry = frames.reduce((sum, frame) => sum + frame.signals.mirrorAgreement, 0) / Math.max(1, frames.length);
  const symmetryText = semantic(symmetry, 0.72, 0.9, ["对称关系较弱", "对称结构可辨", "对称结构清晰"]);
  const centerDelta = frames.reduce((sum, frame) => sum
    + Math.abs(frame.signals.centerBrightness - frame.signals.borderBrightness), 0) / Math.max(1, frames.length);
  const centerText = centerDelta > 0.12 ? "中心聚合明显" : "中心与外围过渡均衡";
  return Object.freeze({
    description: `最终画面形成${symmetryText}的重复扇区，${centerText}，旋转变化${temporal.continuity}。`,
    keyInformation: Object.freeze([commonInfo("万花筒"),
      Object.freeze({ label: "对称性", value: symmetryText }),
      Object.freeze({ label: "中心表现", value: centerText }),
      Object.freeze({ label: "旋转连续性", value: temporal.continuity }),
      Object.freeze({ label: "接缝质量", value: symmetry < 0.58 ? "部分扇区衔接需复核" : "未见明显断裂接缝" })]),
    selected: diverseSelection(frames, ["对称起始", "旋转变化", "对称代表", "旋转后段", "对称结束"], 0.018, 5),
    continuity: temporal.continuity,
    freezeExpected: temporal.average <= 0.003,
    technicalQuality: Object.freeze({
      对称结构稳定: symmetry >= 0.58,
      扇区接缝完整: symmetry >= 0.58,
      旋转无突跳: temporal.continuity !== "存在突跳"
    })
  });
};
