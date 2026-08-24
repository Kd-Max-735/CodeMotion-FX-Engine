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

const DIRECTIONS: Readonly<Record<string, string>> = Object.freeze({
  left_to_right: "从左向右",
  right_to_left: "从右向左",
  top_to_bottom: "从上向下",
  bottom_to_top: "从下向上",
  clockwise: "顺时针",
  counter_clockwise: "逆时针"
});

const profile: ObservedSelfCheckProfile = {
  toolName: "path_trim",
  displayName: "路径修剪",
  expectedMotion: true,
  hintFrames: (request) => {
    const duration = Math.max(0.2, finite(request.effectParams?.duration, 3));
    const milestoneCount = Math.max(3, Math.min(8, Math.ceil(duration) + 2));
    return temporalHints(request, Array.from({ length: milestoneCount }, (_, index) => ({
      time: Math.min(request.durationSeconds, duration * index / Math.max(1, milestoneCount - 1)),
      role: index === 0 ? "路径起态" : index === milestoneCount - 1 ? "路径终态" : `第 ${index} 个路径推进阶段`
    })));
  },
  selectFrames: (frames) => distinctFrames(frames.filter((frame) => frame.role !== "变化扫描")),
  evaluate: (frames, selected, params) => {
    const mode = publicText(params.mode, "reveal") === "erase" ? "擦除" : "显现";
    const direction = DIRECTIONS[publicText(params.direction, "left_to_right")] ?? "沿路径推进";
    const coverageRange = Math.max(
      variationRange(frames, (frame) => frame.nonDarkRatio),
      variationRange(frames, (frame) => frame.differenceFromFirst)
    );
    const progressive = frames.slice(1).filter((frame) => frame.differenceFromPrevious > 0.00002).length;
    const complete = coverageRange > 0.00005 && progressive > 0;
    const startState = mode === "显现" ? "少量或未显现" : "主体完整可见";
    const endState = mode === "显现" ? "主体显现完成" : "主体擦除完成";
    return Object.freeze({
      passed: complete,
      description: `最终视频中的路径${direction}${mode}，从${startState}连续推进到${endState}。`,
      verdict: complete ? "最终成片实际呈现连续的路径覆盖变化。" : "最终成片未形成完整连续的路径修剪过程。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "实际推进顺序", value: `起态 → 路径中段 → ${endState}` }),
        Object.freeze({ label: "推进方向", value: direction }),
        Object.freeze({ label: "覆盖变化", value: complete ? "连续可见" : "变化不足" }),
        Object.freeze({ label: "起终状态", value: `${startState} → ${endState}` })
      ]),
      observedFacts: Object.freeze({
        visible_path_progression: Object.freeze(["起态", "路径中段", "终态"]),
        direction,
        coverage_change: complete ? "连续" : "不足",
        stroke_continuity: selected.every((frame) => frame.horizontalSpread > 0 || frame.verticalSpread > 0) ? "连续可见" : "部分缺失",
        start_state: startState,
        end_state: endState,
        complete
      }),
      issues: complete ? Object.freeze([]) : Object.freeze(["路径修剪没有在最终视频中形成连续完整的起点、过程和终点。"])
    });
  }
};

export async function runPathTrimSelfCheck(request: ObservedVideoSelfCheckRequest): Promise<ObservedSelfCheckArtifacts> {
  return runObservedVideoEvidencePipeline(profile, request);
}
