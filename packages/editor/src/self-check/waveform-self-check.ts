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
  toolName: "waveform",
  displayName: "音频波形",
  expectedMotion: true,
  hintFrames: () => Object.freeze([]),
  selectFrames: (frames) => {
    const wide = extremaFrames(frames, (frame) => frame.verticalSpread + frame.differenceFromPrevious, 3);
    const narrow = [...frames].sort((a, b) => a.verticalSpread - b.verticalSpread)[0];
    return distinctFrames([frames[0]!, ...(narrow === undefined ? [] : [{ ...narrow, role: "低振幅波形" }]),
      ...wide.map((frame) => ({ ...frame, role: "高振幅波形" })), frames.at(-1)!]);
  },
  evaluate: (frames) => {
    const extentRange = variationRange(frames, (frame) => frame.verticalSpread);
    const changeRange = variationRange(frames, (frame) => frame.differenceFromPrevious);
    const upper = frames.reduce((sum, frame) => sum + frame.upperActivity, 0);
    const lower = frames.reduce((sum, frame) => sum + frame.lowerActivity, 0);
    const balance = Math.min(upper, lower) / Math.max(0.000001, Math.max(upper, lower));
    const trace = balance > 0.72 ? "上下镜像双线" : "单条主波形";
    const response = level(Math.max(extentRange, changeRange), 0.003, 0.025);
    const passed = frames.some((frame) => frame.horizontalSpread > 0.2)
      && Math.max(extentRange, changeRange) > 0.0001;
    return Object.freeze({
      passed,
      description: `最终视频中观察到${trace}，振幅随时间产生${response}变化且横向连续。`,
      verdict: passed ? "最终成片的可见波形随时间变化。" : "最终成片未呈现连续且变化的音频波形。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "波形形态", value: trace }),
        Object.freeze({ label: "振幅变化", value: response }),
        Object.freeze({ label: "连续性", value: frames.some((frame) => frame.horizontalSpread > 0.2) ? "横向连续" : "不完整" })
      ]),
      observedFacts: Object.freeze({
        trace_count: trace === "上下镜像双线" ? 2 : 1,
        vertical_extent_range: response,
        temporal_variation: changeRange > 0.0001 ? "可见" : "不足",
        continuity: frames.some((frame) => frame.horizontalSpread > 0.2) ? "连续" : "不完整"
      }),
      issues: passed ? Object.freeze([]) : Object.freeze(["最终视频中的波形没有形成连续的可见时域变化。"])
    });
  }
};

export async function runWaveformSelfCheck(request: ObservedVideoSelfCheckRequest): Promise<ObservedSelfCheckArtifacts> {
  return runObservedVideoEvidencePipeline(profile, request);
}
