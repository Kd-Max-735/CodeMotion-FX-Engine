import type { VisualEffectAnalyzer } from "../visual-effect-self-check.js";
import { commonInfo, diverseSelection, semantic, temporalSummary } from "./self-check-analysis-shared.js";

export const selfCheckWaveSurface: VisualEffectAnalyzer = (frames) => {
  const temporal = temporalSummary(frames, 0.25, 0.003);
  const first = frames[0]!.signals;
  const radialCue = Math.abs(first.centerBrightness - first.borderBrightness);
  const mode = radialCue > 0.1 ? "中心向外的波面层次明显" : Math.abs(first.edgeX - first.edgeY) < 0.009
    ? "交叉波面分布均衡" : "斜向波面变化更突出";
  const relief = semantic(first.contrast, 0.1, 0.23, ["起伏柔和", "峰谷清楚", "峰谷反差强"]);
  return Object.freeze({
    description: `最终画面呈现${mode}，${relief}，波面变化${temporal.continuity}。`,
    keyInformation: Object.freeze([commonInfo("波浪曲面"),
      Object.freeze({ label: "波面形态", value: mode }),
      Object.freeze({ label: "峰谷层次", value: relief }),
      Object.freeze({ label: "波面变化", value: temporal.continuity }),
      Object.freeze({ label: "高光与阴影", value: first.contrast > 0.08 ? "随峰谷形成可见明暗" : "明暗层次较弱" }),
      Object.freeze({ label: "曲面完整性", value: frames.some((frame) => frame.signals.darkRatio > 0.24) ? "部分区域过暗，需结合设计确认" : "未见明显断面" })]),
    selected: diverseSelection(frames, ["波面起始", "峰谷推进", "波面代表", "波面变化", "波面结束"], 0.015, 5),
    continuity: temporal.continuity,
    freezeExpected: temporal.average <= 0.003,
    technicalQuality: Object.freeze({
      曲面峰谷连续: temporal.continuity !== "存在突跳",
      峰谷明暗可辨: first.contrast > 0.05,
      曲面无明显断面: !frames.some((frame) => frame.signals.darkRatio > 0.24)
    })
  });
};
