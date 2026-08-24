import type { VisualEffectAnalyzer } from "../visual-effect-self-check.js";
import { commonInfo, diverseSelection, semantic, temporalSummary } from "./self-check-analysis-shared.js";

export const selfCheckWaveWarp: VisualEffectAnalyzer = (frames) => {
  const temporal = temporalSummary(frames, 0.21, 0.0025);
  const first = frames[0]!.signals;
  const axisDifference = Math.abs(first.edgeX - first.edgeY);
  const direction = axisDifference < 0.007 ? "横纵变化接近" : first.edgeX > first.edgeY
    ? "纵向轮廓中的横向摆动更明显" : "横向轮廓中的纵向起伏更明显";
  const density = semantic((first.edgeX + first.edgeY) / 2, 0.04, 0.105, ["波纹舒展", "波纹疏密适中", "波纹较密"]);
  return Object.freeze({
    description: `最终画面形成规则波浪扭曲，${direction}，${density}，传播${temporal.continuity}。`,
    keyInformation: Object.freeze([commonInfo("波浪扭曲"),
      Object.freeze({ label: "扭曲方向", value: direction }),
      Object.freeze({ label: "波纹疏密", value: density }),
      Object.freeze({ label: "波形连续性", value: temporal.continuity }),
      Object.freeze({ label: "边缘稳定性", value: frames.some((frame) => frame.signals.darkRatio > 0.18) ? "存在暗边风险" : "未见明显撕裂或暗边" })]),
    selected: diverseSelection(frames, ["波形起始", "波峰变化", "波形代表", "波谷变化", "波形结束"], 0.013, 5),
    continuity: temporal.continuity,
    freezeExpected: temporal.average <= 0.0025,
    technicalQuality: Object.freeze({
      波形轮廓连续: temporal.continuity !== "存在突跳",
      波纹方向可辨: axisDifference >= 0.002,
      画面边缘稳定: !frames.some((frame) => frame.signals.darkRatio > 0.18)
    })
  });
};
