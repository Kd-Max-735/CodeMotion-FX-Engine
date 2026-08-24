import type { VisualEffectAnalyzer } from "../visual-effect-self-check.js";
import { commonInfo, diverseSelection, semantic, temporalSummary } from "./self-check-analysis-shared.js";

export const selfCheckLiquidDisplace: VisualEffectAnalyzer = (frames) => {
  const temporal = temporalSummary(frames, 0.2, 0.004);
  const color = frames.reduce((sum, frame) => sum + frame.signals.colorSeparation, 0) / Math.max(1, frames.length);
  const flow = semantic(temporal.average, 0.012, 0.055, ["缓慢黏稠", "柔和流动", "活跃流动"]);
  const refraction = semantic(frames.reduce((sum, frame) => sum + frame.signals.contrast, 0)
    / Math.max(1, frames.length), 0.12, 0.24, ["折射较柔", "折射清楚", "折射强烈"]);
  const dispersion = semantic(color, 0.08, 0.2, ["色边不明显", "有轻微彩色折射", "彩色折射明显"]);
  return Object.freeze({
    description: `最终画面呈现${flow}的液态形变，${refraction}，${dispersion}。`,
    keyInformation: Object.freeze([commonInfo("液态置换"),
      Object.freeze({ label: "液态流动", value: flow }),
      Object.freeze({ label: "折射表现", value: refraction }),
      Object.freeze({ label: "彩色边缘", value: dispersion }),
      Object.freeze({ label: "流动连续性", value: temporal.continuity })]),
    selected: diverseSelection(frames, ["流动起始", "液态推进", "折射代表", "流动变化", "流动结束"], 0.014, 5),
    continuity: temporal.continuity,
    freezeExpected: temporal.average <= 0.004,
    technicalQuality: Object.freeze({
      液态流动连贯: temporal.continuity !== "存在突跳",
      折射轮廓完整: !frames.some((frame) => frame.signals.darkRatio > 0.2),
      亮度变化自然: temporal.peak <= 0.2
    })
  });
};
