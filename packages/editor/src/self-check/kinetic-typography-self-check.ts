import {
  runObservedVideoEvidencePipeline,
  distinctFrames,
  extremaFrames,
  finite,
  level,
  publicText,
  temporalHints,
  variationRange,
  type ObservedSelfCheckArtifacts,
  type ObservedSelfCheckProfile,
  type ObservedVideoSelfCheckRequest
} from "./observed-video-self-check.js";

const profile: ObservedSelfCheckProfile = {
  toolName: "kinetic_typography",
  displayName: "动感排版",
  expectedMotion: true,
  hintFrames: (request) => {
    const duration = Math.max(0, finite(request.effectParams?.jumpDuration, 1));
    const end = duration === 0 ? request.durationSeconds : Math.min(duration, request.durationSeconds);
    return temporalHints(request, [
      { time: 0, role: "排版起态" },
      { time: end * 0.25, role: "第一节奏态" },
      { time: end * 0.5, role: "中段节奏态" },
      { time: end * 0.75, role: "后段节奏态" },
      { time: end, role: "归位状态" }
    ]);
  },
  selectFrames: (frames) => distinctFrames([
    frames[0]!,
    ...extremaFrames(frames, (frame) => frame.differenceFromPrevious + frame.horizontalSpread + frame.verticalSpread, 4),
    frames.at(-1)!
  ]),
  evaluate: (frames, _selected, params) => {
    const text = publicText(params.text, "动感排版");
    const spatialRange = Math.max(
      variationRange(frames, (frame) => frame.horizontalSpread),
      variationRange(frames, (frame) => frame.verticalSpread)
    );
    const changeRange = variationRange(frames, (frame) => frame.differenceFromPrevious);
    const rhythm = extremaFrames(frames, (frame) => frame.differenceFromPrevious, 8)
      .filter((frame) => frame.differenceFromPrevious > 0.00005).length;
    const intensity = level(Math.max(spatialRange, changeRange), 0.003, 0.03);
    const passed = rhythm > 0 && Math.max(spatialRange, changeRange) > 0.00005;
    return Object.freeze({
      passed,
      description: `最终视频中“${text}”保持可读，并出现 ${rhythm} 个${intensity}排版节奏变化后进入末态。`,
      verdict: passed ? "最终成片中文字布局或尺寸实际随节奏变化。" : "最终成片未观察到清晰的动感排版变化。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "实际可见内容", value: text }),
        Object.freeze({ label: "排版运动", value: rhythm > 0 ? `${rhythm} 个可见节奏态` : "未见节奏态" }),
        Object.freeze({ label: "变化强度", value: intensity }),
        Object.freeze({ label: "可读性", value: frames.every((frame) => frame.nonDarkRatio > 0.001) ? "全程可辨" : "部分阶段不足" })
      ]),
      observedFacts: Object.freeze({
        visible_content: text,
        layout_motion: rhythm > 0 ? "可见" : "不足",
        scale_rhythm: `${rhythm} 个可辨变化态`,
        readability: frames.every((frame) => frame.nonDarkRatio > 0.001) ? "保持" : "部分丢失",
        start_state: "可见",
        end_state: "可见末态"
      }),
      issues: passed ? Object.freeze([]) : Object.freeze(["文字排版没有在最终视频中形成可见节奏变化。"])
    });
  }
};

export async function runKineticTypographySelfCheck(request: ObservedVideoSelfCheckRequest): Promise<ObservedSelfCheckArtifacts> {
  return runObservedVideoEvidencePipeline(profile, request);
}
