import type { VisualEffectAnalyzer } from "../visual-effect-self-check.js";
import { commonInfo, diverseSelection, semantic, temporalSummary } from "./self-check-analysis-shared.js";

export const selfCheckImageDepthParallax: VisualEffectAnalyzer = (frames) => {
  const temporal = temporalSummary(frames, 0.2, 0.002);
  const start = frames[0]!.signals;
  const end = frames.at(-1)!.signals;
  const centerShift = end.centerBrightness - start.centerBrightness;
  const borderShift = end.borderBrightness - start.borderBrightness;
  const depthDifference = Math.abs(centerShift - borderShift);
  const layering = semantic(depthDifference, 0.01, 0.045, ["近远层差异轻微", "近远层差异可见", "近远层差异明显"]);
  const movement = temporal.average <= 0.002 ? "未观察到明显镜头位移" : "镜头位移连续";
  return Object.freeze({
    description: `最终画面${movement}，${layering}，边缘在运动过程中${frames.some((frame) => frame.signals.darkRatio > 0.18) ? "出现较多暗区" : "保持完整"}。`,
    keyInformation: Object.freeze([commonInfo("图像深度视差"),
      Object.freeze({ label: "深度层次", value: layering }),
      Object.freeze({ label: "镜头运动", value: movement }),
      Object.freeze({ label: "运动方向", value: centerShift > 0.01 ? "画面重心向亮部推进" : centerShift < -0.01 ? "画面重心远离亮部" : "整体方向较平缓" }),
      Object.freeze({ label: "边缘完整性", value: frames.some((frame) => frame.signals.darkRatio > 0.18) ? "需复核边缘空洞" : "未见明显空洞" }),
      Object.freeze({ label: "运动连续性", value: temporal.continuity })]),
    selected: diverseSelection(frames, ["视差起始", "近远分离", "位移中段", "深度代表", "视差结束"], 0.01, 5),
    continuity: temporal.continuity,
    freezeExpected: false,
    technicalQuality: Object.freeze({
      近远层运动可区分: depthDifference > 0.005,
      画面边缘无明显空洞: !frames.some((frame) => frame.signals.darkRatio > 0.18),
      镜头运动无突跳: temporal.continuity !== "存在突跳"
    })
  });
};
