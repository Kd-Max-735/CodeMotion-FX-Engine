import {
  averageFrameChange,
  frameDifference,
  numericParam,
  runEffectVideoSelfCheck,
  samplingPlanAtTimes,
  visualStrength,
  type EffectSelfCheckConfig,
  type EffectSelfCheckPlanRequest,
  type EffectSelfCheckRunRequest
} from "./effect-video-self-check.js";

export type PixelDissolveSelfCheckParams = Readonly<Record<string, unknown>>;

export function pixelDissolveSamplingPlan(request: EffectSelfCheckPlanRequest<PixelDissolveSelfCheckParams>) {
  const transitionDuration = Math.min(request.durationSeconds,
    numericParam(request.params, "duration", request.durationSeconds));
  const last = Math.max(0, request.durationSeconds - 1 / Math.max(1, request.fps));
  return samplingPlanAtTimes(request.durationSeconds, request.fps, [
    { evidenceId: "before_dissolve", role: "before_dissolve", label: "转场前", time: 0 },
    { evidenceId: "dissolve_early", role: "dissolve_early", label: "像素开始替换", time: transitionDuration * 0.2 },
    { evidenceId: "dissolve_middle", role: "dissolve_middle", label: "像素替换中段", time: transitionDuration * 0.5 },
    { evidenceId: "dissolve_late", role: "dissolve_late", label: "像素接近完成", time: transitionDuration * 0.82 },
    { evidenceId: "dissolve_complete", role: "dissolve_complete", label: "转场完成", time: transitionDuration },
    { evidenceId: "after_dissolve", role: "after_dissolve", label: "完成后画面", time: Math.min(last, transitionDuration + 0.25) }
  ]);
}

const PIXEL_DISSOLVE_SELF_CHECK = Object.freeze<EffectSelfCheckConfig<PixelDissolveSelfCheckParams>>({
  toolName: "pixel_dissolve",
  displayName: "像素溶解",
  samplingPlan: pixelDissolveSamplingPlan,
  describe: (request, observations, technicalIntegrity) => {
    const change = visualStrength(averageFrameChange(observations));
    const before = observations.find((item) => item.role === "before_dissolve");
    const completed = observations.find((item) => item.role === "after_dissolve")
      ?? observations.find((item) => item.role === "dissolve_complete");
    const transitionDuration = numericParam(request.params, "duration", request.durationSeconds);
    const hasCompletion = completed !== undefined && transitionDuration <= request.durationSeconds
      && frameDifference(before, completed) > 0.01;
    return Object.freeze({
      effectPassed: hasCompletion && observations.length >= 4,
      description: technicalIntegrity
        ? `画面由初始状态经过${change}的像素块替换，关键帧覆盖开始、中段、接近完成和完成状态；像素缺口与块状变化属于溶解过程。`
        : "像素块变化本身属于正常溶解，当前返修原因仅来自最终视频解码或关键帧读取异常。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "像素变化", value: `${change}的块状替换` }),
        Object.freeze({ label: "转场进度", value: observations.length >= 4 ? "开始、中段、尾段均有证据" : "过程证据不足" }),
        Object.freeze({ label: "完成状态", value: hasCompletion ? "已到达完成画面" : "未能确认" })
      ]),
      observation: Object.freeze({
        pixel_replacement: change,
        progress_coverage: observations.length >= 4 ? "完整" : "不完整",
        completion: hasCompletion ? "完成" : "未确认"
      })
    });
  }
});

export function runPixelDissolveSelfCheck(request: EffectSelfCheckRunRequest<PixelDissolveSelfCheckParams>) {
  return runEffectVideoSelfCheck(PIXEL_DISSOLVE_SELF_CHECK, request);
}
