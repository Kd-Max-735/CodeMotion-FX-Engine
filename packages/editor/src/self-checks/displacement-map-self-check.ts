import type { VisualEffectAnalyzer } from "../visual-effect-self-check.js";
import { commonInfo, diverseSelection, semantic, temporalSummary } from "./self-check-analysis-shared.js";

export const selfCheckDisplacementMap: VisualEffectAnalyzer = (frames) => {
  const temporal = temporalSummary(frames, 0.18, 0.0025);
  const meanEdge = frames.reduce((sum, frame) => sum + frame.signals.edgeX + frame.signals.edgeY, 0)
    / Math.max(1, frames.length * 2);
  const anisotropy = frames.reduce((sum, frame) => sum + Math.abs(frame.signals.edgeX - frame.signals.edgeY), 0)
    / Math.max(1, frames.length);
  const scope = semantic(meanEdge, 0.035, 0.09, ["局部轻微", "多区域可见", "大范围明显"]);
  const direction = anisotropy < 0.008 ? "水平与垂直方向均有变化" : frames[0]!.signals.edgeX > frames[0]!.signals.edgeY
    ? "纵向轮廓变化更突出" : "横向轮廓变化更突出";
  return Object.freeze({
    description: `最终画面呈现${scope}的贴图驱动形变，${direction}，跨时刻表现${temporal.continuity}。`,
    keyInformation: Object.freeze([commonInfo("置换贴图"),
      Object.freeze({ label: "实际形变范围", value: scope }),
      Object.freeze({ label: "形变方向", value: direction }),
      Object.freeze({ label: "连续性", value: temporal.continuity }),
      Object.freeze({ label: "边缘表现", value: frames.some((frame) => frame.signals.darkRatio > 0.22) ? "存在较大暗边区域，需结合素材确认" : "未见明显新增暗边" })]),
    selected: diverseSelection(frames, ["形变起始", "形变代表", "形变变化", "形变结束"], 0.012, 4),
    continuity: temporal.continuity,
    freezeExpected: temporal.average <= 0.0025,
    technicalQuality: Object.freeze({
      形变轮廓连续: temporal.continuity !== "存在突跳",
      画面边缘完整: !frames.some((frame) => frame.signals.darkRatio > 0.22),
      静态形变稳定: temporal.average <= 0.0025 ? "符合静态表现" : "存在时间变化，按用户要求复核"
    })
  });
};
