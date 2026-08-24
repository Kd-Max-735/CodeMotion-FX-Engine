import {
  runObservedVideoEvidencePipeline,
  distinctFrames,
  finite,
  publicText,
  temporalHints,
  variationRange,
  type ObservedSelfCheckArtifacts,
  type ObservedSelfCheckProfile,
  type ObservedVideoSelfCheckRequest
} from "./observed-video-self-check.js";

const profile: ObservedSelfCheckProfile = {
  toolName: "text_morph",
  displayName: "文字变形",
  expectedMotion: true,
  hintFrames: (request) => {
    const duration = Math.max(0.2, finite(request.effectParams?.duration, 2.5));
    const sourceLength = [...publicText(request.effectParams?.sourceText, "源文字")].length;
    const targetLength = [...publicText(request.effectParams?.targetText, "目标文字")].length;
    const milestoneCount = Math.max(4, Math.min(8, 4 + Math.abs(sourceLength - targetLength)));
    return temporalHints(request, Array.from({ length: milestoneCount }, (_, index) => ({
      time: Math.min(request.durationSeconds, duration * index / Math.max(1, milestoneCount - 1)),
      role: index === 0 ? "源文字" : index === milestoneCount - 1 ? "目标文字" : `第 ${index} 个形态变化阶段`
    })));
  },
  selectFrames: (frames) => distinctFrames(frames.filter((frame) => frame.role !== "变化扫描")),
  evaluate: (frames, selected, params) => {
    const source = publicText(params.sourceText, "源文字");
    const target = publicText(params.targetText, "目标文字");
    const variation = variationRange(frames, (frame) => frame.differenceFromFirst);
    const middleChanges = frames.slice(1, -1).filter((frame) => frame.differenceFromPrevious > 0.00002).length;
    const complete = variation > 0.00005 && middleChanges > 0 && selected.at(-1)!.nonDarkRatio > 0.001;
    return Object.freeze({
      passed: complete,
      description: `最终视频从“${source}”经过可见中间形态变为“${target}”，目标末态${complete ? "完整" : "不完整"}。`,
      verdict: complete ? "最终成片同时具备源态、中间变形与目标态。" : "最终成片缺少源态、中间变化或完整目标态。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "实际源内容", value: source }),
        Object.freeze({ label: "实际目标内容", value: target }),
        Object.freeze({ label: "形态顺序", value: "源态 → 中间变形 → 目标态" }),
        Object.freeze({ label: "终点完整性", value: complete ? "完整" : "不完整" })
      ]),
      observedFacts: Object.freeze({
        source_content: source,
        target_content: target,
        morph_sequence: Object.freeze(["源态", "中间变形", "目标态"]),
        source_state: "可见",
        transition_state: middleChanges > 0 ? "可见" : "缺失",
        target_state: complete ? "完整可见" : "不完整",
        complete
      }),
      issues: complete ? Object.freeze([]) : Object.freeze(["文字变形的源态、中间态和目标态没有完整出现在最终视频中。"])
    });
  }
};

export async function runTextMorphSelfCheck(request: ObservedVideoSelfCheckRequest): Promise<ObservedSelfCheckArtifacts> {
  return runObservedVideoEvidencePipeline(profile, request);
}
