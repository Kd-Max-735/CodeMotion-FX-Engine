import type { VisualEffectAnalyzer } from "../visual-effect-self-check.js";
import { commonInfo, diverseSelection, semantic, temporalSummary } from "./self-check-analysis-shared.js";

export const selfCheckGlass: VisualEffectAnalyzer = (frames) => {
  const temporal = temporalSummary(frames, 0.22, 0.003);
  const contrast = frames.reduce((sum, frame) => sum + frame.signals.contrast, 0) / Math.max(1, frames.length);
  const separation = frames.reduce((sum, frame) => sum + frame.signals.colorSeparation, 0) / Math.max(1, frames.length);
  const clarity = semantic(contrast, 0.09, 0.22, ["磨砂朦胧", "半透明柔化", "清透锐利"]);
  const tint = semantic(separation, 0.07, 0.19, ["偏色轻微", "可见色调", "色调明显"]);
  const border = frames.reduce((sum, frame) => sum + frame.signals.borderBrightness - frame.signals.centerBrightness, 0)
    / Math.max(1, frames.length);
  return Object.freeze({
    description: `最终画面具有${clarity}的玻璃观感，${tint}，边缘${border > 0.08 ? "高光较明显" : "高光克制"}。`,
    keyInformation: Object.freeze([commonInfo("玻璃材质"),
      Object.freeze({ label: "通透与磨砂", value: clarity }),
      Object.freeze({ label: "折射表现", value: contrast < 0.06 ? "折射细节不易辨认" : "画面细节经过玻璃柔化与偏移" }),
      Object.freeze({ label: "玻璃色调", value: tint }),
      Object.freeze({ label: "边缘高光", value: border > 0.08 ? "明显" : "克制" }),
      Object.freeze({ label: "原有运动保留", value: temporal.average > 0.003 ? "可见且连续" : "画面保持静态" })]),
    selected: diverseSelection(frames, ["玻璃起始", "材质代表", "运动保留", "玻璃结束"], 0.016, 4),
    continuity: temporal.continuity,
    freezeExpected: temporal.average <= 0.003,
    technicalQuality: Object.freeze({
      玻璃后内容可辨: contrast >= 0.04,
      边缘高光未过曝: frames.every((frame) => frame.signals.borderBrightness < 0.97),
      原有运动连续: temporal.continuity !== "存在突跳"
    })
  });
};
