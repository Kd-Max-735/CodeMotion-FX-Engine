import {
  runObservedVideoEvidencePipeline,
  distinctFrames,
  extremaFrames,
  level,
  variationRange,
  type ObservedSelfCheckArtifacts,
  type ObservedSelfCheckProfile,
  type ObservedVideoSelfCheckRequest
} from "./observed-video-self-check.js";

const profile: ObservedSelfCheckProfile = {
  toolName: "spectrum_bars",
  displayName: "频谱柱",
  expectedMotion: true,
  hintFrames: () => Object.freeze([]),
  selectFrames: (frames) => {
    const high = extremaFrames(frames, (frame) => frame.verticalSpread + frame.differenceFromPrevious, 3);
    const low = [...frames].sort((a, b) => a.verticalSpread - b.verticalSpread)[0];
    return distinctFrames([frames[0]!, ...(low === undefined ? [] : [low]), ...high, frames.at(-1)!]);
  },
  evaluate: (frames) => {
    const heightRange = variationRange(frames, (frame) => frame.verticalSpread);
    const changeRange = variationRange(frames, (frame) => frame.differenceFromPrevious);
    const groups = Math.max(...frames.map((frame) => frame.columnGroupCount));
    const response = level(Math.max(heightRange, changeRange), 0.005, 0.04);
    const passed = groups >= 3 && Math.max(heightRange, changeRange) > 0.0001;
    return Object.freeze({
      passed,
      description: `最终视频中可见约 ${groups} 组频谱柱，柱高随时间产生${response}变化。`,
      verdict: passed ? "最终成片实际柱形高度随时间变化。" : "最终成片未形成足够清晰且变化的频谱柱。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "可见柱组", value: `约 ${groups} 组` }),
        Object.freeze({ label: "柱高变化", value: response }),
        Object.freeze({ label: "时间响应", value: changeRange > 0.0001 ? "持续变化" : "近似静止" })
      ]),
      observedFacts: Object.freeze({
        visible_bar_groups: groups,
        height_range: response,
        temporal_variation: changeRange > 0.0001 ? "可见" : "不足",
        frequency_layout: groups >= 3 ? "横向多柱分布" : "柱形分布不完整"
      }),
      issues: passed ? Object.freeze([]) : Object.freeze(["最终视频中的频谱柱数量或动态高度不足。"])
    });
  }
};

export async function runSpectrumBarsSelfCheck(request: ObservedVideoSelfCheckRequest): Promise<ObservedSelfCheckArtifacts> {
  return runObservedVideoEvidencePipeline(profile, request);
}
