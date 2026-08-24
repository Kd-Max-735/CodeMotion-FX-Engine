import type { VisualEffectAnalyzer } from "../visual-effect-self-check.js";
import { commonInfo, diverseSelection, semantic, temporalSummary } from "./self-check-analysis-shared.js";

export const selfCheckFractal: VisualEffectAnalyzer = (frames) => {
  const temporal = temporalSummary(frames, 0.28, 0.0035);
  const contrast = frames.reduce((sum, frame) => sum + frame.signals.contrast, 0) / Math.max(1, frames.length);
  const detail = frames.reduce((sum, frame) => sum + frame.signals.edgeX + frame.signals.edgeY, 0)
    / Math.max(1, frames.length * 2);
  const hierarchy = semantic(detail, 0.045, 0.105, ["层级简洁", "递归层次清楚", "递归层次丰富"]);
  const separation = semantic(contrast, 0.1, 0.23, ["层间过渡柔和", "层间区分清楚", "层间反差鲜明"]);
  return Object.freeze({
    description: `最终画面呈现${hierarchy}的重复递归结构，${separation}，变化${temporal.continuity}。`,
    keyInformation: Object.freeze([commonInfo("分形"),
      Object.freeze({ label: "递归层次", value: hierarchy }),
      Object.freeze({ label: "层间区分", value: separation }),
      Object.freeze({ label: "中心深入感", value: frames[0]!.signals.centerBrightness !== frames[0]!.signals.borderBrightness ? "中心与外围具有层次差" : "中心层次较平" }),
      Object.freeze({ label: "动画连续性", value: temporal.continuity })]),
    selected: diverseSelection(frames, ["递归起始", "层级变化", "递归代表", "深入变化", "递归结束"], 0.02, 5),
    continuity: temporal.continuity,
    freezeExpected: temporal.average <= 0.0035,
    technicalQuality: Object.freeze({
      递归层可辨: detail > 0.02,
      中心结构完整: frames.every((frame) => frame.signals.darkRatio < 0.9),
      层级动画无闪断: temporal.continuity !== "存在突跳"
    })
  });
};
