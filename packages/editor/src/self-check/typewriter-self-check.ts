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
  toolName: "typewriter",
  displayName: "打字机显现",
  expectedMotion: true,
  hintFrames: (request) => {
    const text = [...publicText(request.effectParams?.text, "文字")];
    const speed = Math.max(0.1, finite(request.effectParams?.speed, 12));
    const completeAt = Math.min(request.durationSeconds, text.length / speed);
    const milestoneCount = Math.max(3, Math.min(9, Math.ceil(text.length / 6) + 3));
    return temporalHints(request, [
      ...Array.from({ length: milestoneCount }, (_, index) => ({
        time: completeAt * index / Math.max(1, milestoneCount - 1),
        role: index === 0 ? "显现开始" : index === milestoneCount - 1 ? "完整文字" : `第 ${index} 个文字显现阶段`
      })),
      { time: request.durationSeconds * 0.95, role: "末段停留" }
    ]);
  },
  selectFrames: (frames) => distinctFrames(frames.filter((frame) => frame.role !== "变化扫描")),
  evaluate: (frames, selected, params) => {
    const text = publicText(params.text, "文字");
    const range = variationRange(frames, (frame) => frame.differenceFromFirst);
    const progressive = frames.slice(1).filter((frame) => frame.differenceFromPrevious > 0.00002).length;
    const complete = range > 0.00005 && selected.at(-1)!.nonDarkRatio > 0.001;
    const cursor = params.cursor === true ? "可见" : "未显示";
    return Object.freeze({
      passed: complete && progressive > 0,
      description: `最终视频中“${text}”按从前到后的顺序逐步显现，末段${complete ? "完整可见" : "未完整显示"}。`,
      verdict: complete && progressive > 0 ? "最终成片包含连续显现阶段和完整末态。" : "最终成片缺少连续显现或完整末态。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "实际可见内容", value: text }),
        Object.freeze({ label: "显现顺序", value: "从前到后逐步增加" }),
        Object.freeze({ label: "阶段完整性", value: complete ? "开始、过程、完整末态齐全" : "末态不完整" }),
        Object.freeze({ label: "游标表现", value: cursor })
      ]),
      observedFacts: Object.freeze({
        visible_content: text,
        reveal_order: "从前到后",
        stage_sequence: Object.freeze(["开始", "部分显现", "完整显现"]),
        complete,
        cursor_visible: cursor === "可见",
        start_state: "少量或未显现",
        end_state: complete ? "完整停留" : "不完整"
      }),
      issues: complete && progressive > 0 ? Object.freeze([]) : Object.freeze(["文字没有按顺序完整显现到最终状态。"])
    });
  }
};

export async function runTypewriterSelfCheck(request: ObservedVideoSelfCheckRequest): Promise<ObservedSelfCheckArtifacts> {
  return runObservedVideoEvidencePipeline(profile, request);
}
