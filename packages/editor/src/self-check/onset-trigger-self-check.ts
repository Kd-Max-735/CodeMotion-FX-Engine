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
  toolName: "onset_trigger",
  displayName: "起音触发",
  expectedMotion: true,
  hintFrames: () => Object.freeze([]),
  selectFrames: (frames) => {
    const triggers = extremaFrames(frames, (frame) => frame.differenceFromPrevious, 4);
    return distinctFrames(triggers.flatMap((trigger) => {
      const index = frames.indexOf(trigger);
      return [frames[Math.max(0, index - 1)]!, { ...trigger, role: "触发瞬间" },
        frames[Math.min(frames.length - 1, index + 1)]!];
    }));
  },
  evaluate: (frames) => {
    const changeRange = variationRange(frames, (frame) => frame.differenceFromPrevious);
    const triggers = extremaFrames(frames, (frame) => frame.differenceFromPrevious, 8)
      .filter((frame) => frame.differenceFromPrevious > 0.0001);
    const recovered = triggers.every((trigger) => {
      const index = frames.indexOf(trigger);
      return index === frames.length - 1 || frames[Math.min(frames.length - 1, index + 1)]!.differenceFromPrevious
        < trigger.differenceFromPrevious;
    });
    const sharpness = level(changeRange, 0.001, 0.01);
    const passed = triggers.length > 0 && changeRange > 0.0001;
    return Object.freeze({
      passed,
      description: `最终视频中观察到 ${triggers.length} 次${sharpness}起音触发，触发后${recovered ? "能回稳" : "回稳不足"}。`,
      verdict: passed ? "最终成片存在突发式可见变化，而非仅有输入触发记录。" : "最终成片未观察到起音对应的突发式变化。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "实际触发", value: triggers.length > 0 ? `${triggers.length} 次可见触发` : "未见触发" }),
        Object.freeze({ label: "触发锐度", value: sharpness }),
        Object.freeze({ label: "触发后状态", value: recovered ? "回稳" : "持续或粘连" })
      ]),
      observedFacts: Object.freeze({
        visible_trigger_count: triggers.length,
        trigger_sharpness: sharpness,
        post_trigger_recovery: recovered,
        observed_response: triggers.length > 0 ? "成片出现突发式可见响应" : "成片未出现突发式可见响应"
      }),
      issues: passed ? Object.freeze([]) : Object.freeze(["起音事件没有在最终视频中形成可见触发。"])
    });
  }
};

export async function runOnsetTriggerSelfCheck(request: ObservedVideoSelfCheckRequest): Promise<ObservedSelfCheckArtifacts> {
  return runObservedVideoEvidencePipeline(profile, request);
}
