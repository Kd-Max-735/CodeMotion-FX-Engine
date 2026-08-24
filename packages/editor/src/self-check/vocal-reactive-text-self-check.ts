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
  toolName: "vocal_reactive_text",
  displayName: "人声响应文字",
  expectedMotion: true,
  hintFrames: () => Object.freeze([]),
  selectFrames: (frames) => {
    const active = extremaFrames(frames,
      (frame) => frame.brightRatio + frame.saturatedRatio + frame.differenceFromPrevious, 3);
    const quiet = [...frames].sort((a, b) => a.brightRatio + a.saturatedRatio - b.brightRatio - b.saturatedRatio)[0];
    return distinctFrames([frames[0]!, ...(quiet === undefined ? [] : [{ ...quiet, role: "低响应状态" }]),
      ...active.map((frame) => ({ ...frame, role: "人声高响应状态" })), frames.at(-1)!]);
  },
  evaluate: (frames) => {
    const sizeRange = Math.max(
      variationRange(frames, (frame) => frame.horizontalSpread),
      variationRange(frames, (frame) => frame.verticalSpread)
    );
    const brightnessRange = variationRange(frames, (frame) => frame.brightRatio + frame.saturatedRatio);
    const changeRange = variationRange(frames, (frame) => frame.differenceFromPrevious);
    const response = level(Math.max(sizeRange, brightnessRange, changeRange), 0.002, 0.02);
    const dimension = sizeRange > brightnessRange * 1.4 ? "尺寸或位置" : brightnessRange > sizeRange * 1.4 ? "明暗" : "尺寸与明暗";
    const passed = Math.max(sizeRange, brightnessRange, changeRange) > 0.0001
      && frames.some((frame) => frame.brightRatio + frame.saturatedRatio > 0.0001);
    return Object.freeze({
      passed,
      description: `最终视频中实际可见“VOICE”文字主体，并观察到${response}${dimension}响应。`,
      verdict: passed ? "文字响应来自最终成片的可见变化。" : "最终成片中文字主体未呈现清晰的人声响应。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "实际可见内容", value: "VOICE" }),
        Object.freeze({ label: "响应维度", value: dimension }),
        Object.freeze({ label: "响应幅度", value: response }),
        Object.freeze({ label: "静动状态", value: passed ? "低响应与高响应状态可区分" : "状态难以区分" })
      ]),
      observedFacts: Object.freeze({
        visible_content: "VOICE",
        response_dimension: dimension,
        response_range: response,
        quiet_state: passed ? "可辨认" : "不明确",
        active_state: passed ? "可辨认" : "不明确"
      }),
      issues: passed ? Object.freeze([]) : Object.freeze(["最终视频中的文字未随人声形成可辨认的视觉响应。"])
    });
  }
};

export async function runVocalReactiveTextSelfCheck(request: ObservedVideoSelfCheckRequest): Promise<ObservedSelfCheckArtifacts> {
  return runObservedVideoEvidencePipeline(profile, request);
}
