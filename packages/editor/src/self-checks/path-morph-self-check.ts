import type { VisualEffectAnalyzer } from "../visual-effect-self-check.js";
import { commonInfo, frameDifference, selectedFrame, temporalSummary } from "./self-check-analysis-shared.js";

export const selfCheckPathMorph: VisualEffectAnalyzer = (frames) => {
  const temporal = temporalSummary(frames, 0.3, 0.002);
  const startEndDifference = frameDifference(frames[0]!, frames.at(-1)!);
  const peakIndex = frames.reduce((best, frame, index) => frame.changeFromPrevious > frames[best]!.changeFromPrevious ? index : best, 0);
  const completion = startEndDifference < 0.015 ? "起止画面接近，需确认是否确有目标切换" : "起止画面明确不同";
  const selectedIndexes = new Set([0, Math.max(1, peakIndex - 1), peakIndex,
    Math.min(frames.length - 1, peakIndex + 1), frames.length - 1]);
  const selected = [...selectedIndexes].sort((a, b) => a - b).map((index, ordinal) =>
    selectedFrame(frames[index]!, ["源画面", "变形进入", "最大变形", "目标显现", "目标稳定"][ordinal]!, ordinal + 1));
  return Object.freeze({
    description: `最终视频呈现从源画面到目标画面的变形转场，${completion}，过渡${temporal.continuity}。`,
    keyInformation: Object.freeze([commonInfo("路径变形"),
      Object.freeze({ label: "起止关系", value: completion }),
      Object.freeze({ label: "变形峰值", value: peakIndex > 0 && peakIndex < frames.length - 1 ? "位于转场中段" : "靠近转场边界" }),
      Object.freeze({ label: "推进方向", value: "由源画面逐步让位于目标画面" }),
      Object.freeze({ label: "过渡连续性", value: temporal.continuity }),
      Object.freeze({ label: "结束稳定性", value: frames.at(-1)!.changeFromPrevious < 0.035 ? "目标画面趋于稳定" : "结束阶段仍有明显变化" })]),
    selected: Object.freeze(selected),
    continuity: temporal.continuity,
    freezeExpected: false,
    technicalQuality: Object.freeze({
      起止画面完成切换: startEndDifference >= 0.015,
      中间变形阶段存在: peakIndex > 0 && peakIndex < frames.length - 1,
      目标画面结束稳定: frames.at(-1)!.changeFromPrevious < 0.035
    })
  });
};
