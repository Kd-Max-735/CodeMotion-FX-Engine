import type { VisualEffectAnalyzer } from "../visual-effect-self-check.js";
import { commonInfo, diverseSelection, semantic, temporalSummary } from "./self-check-analysis-shared.js";

export const selfCheckTurbulentDisplace: VisualEffectAnalyzer = (frames) => {
  const temporal = temporalSummary(frames, 0.23, 0.0035);
  const edgeVariation = frames.reduce((sum, frame) => sum + Math.abs(frame.signals.edgeX - frame.signals.edgeY), 0)
    / Math.max(1, frames.length);
  const detail = frames.reduce((sum, frame) => sum + frame.signals.edgeX + frame.signals.edgeY, 0)
    / Math.max(1, frames.length * 2);
  const scale = semantic(detail, 0.04, 0.11, ["大块柔和", "有机多尺度", "细碎复杂"]);
  const bias = edgeVariation < 0.008 ? "方向分布均衡" : frames[0]!.signals.edgeX > frames[0]!.signals.edgeY
    ? "纵向拉扯更突出" : "横向拉扯更突出";
  return Object.freeze({
    description: `最终画面呈现${scale}的非规则湍流形变，${bias}，演化${temporal.continuity}。`,
    keyInformation: Object.freeze([commonInfo("湍流置换"),
      Object.freeze({ label: "形变尺度", value: scale }),
      Object.freeze({ label: "方向偏置", value: bias }),
      Object.freeze({ label: "有机连续性", value: temporal.continuity }),
      Object.freeze({ label: "边缘表现", value: frames.some((frame) => frame.signals.darkRatio > 0.2) ? "边缘暗区较多，需复核" : "未见明显破边" })]),
    selected: diverseSelection(frames, ["湍流起始", "场变化", "湍流代表", "演化后段", "湍流结束"], 0.016, 5),
    continuity: temporal.continuity,
    freezeExpected: temporal.average <= 0.0035,
    technicalQuality: Object.freeze({
      有机形变连续: temporal.continuity !== "存在突跳",
      方向变化非整帧抖动: edgeVariation > 0.001,
      画面边缘完整: !frames.some((frame) => frame.signals.darkRatio > 0.2)
    })
  });
};
