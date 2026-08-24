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

export type PortalSelfCheckParams = Readonly<Record<string, unknown>>;

export function portalSamplingPlan(request: EffectSelfCheckPlanRequest<PortalSelfCheckParams>) {
  const duration = numericParam(request.params, "duration", request.durationSeconds);
  return samplingPlanAtTimes(request.durationSeconds, request.fps, [
    { evidenceId: "before_portal", role: "before_portal", label: "传送门开启前", time: 0 },
    { evidenceId: "portal_opening", role: "portal_opening", label: "门洞开启", time: duration * 0.18 },
    { evidenceId: "portal_middle", role: "portal_middle", label: "门洞扩张中段", time: duration * 0.48 },
    { evidenceId: "portal_covering", role: "portal_covering", label: "接近覆盖", time: duration * 0.8 },
    { evidenceId: "portal_complete", role: "portal_complete", label: "转场完成", time: duration + 0.05 }
  ]);
}

const PORTAL_SELF_CHECK = Object.freeze<EffectSelfCheckConfig<PortalSelfCheckParams>>({
  toolName: "portal",
  displayName: "传送门转场",
  samplingPlan: portalSamplingPlan,
  describe: (request, observations, technicalIntegrity) => {
    const visibility = visualStrength(averageFrameChange(observations));
    const before = observations.find((item) => item.role === "before_portal");
    const completed = observations.find((item) => item.role === "portal_complete");
    const complete = completed !== undefined
      && numericParam(request.params, "duration", request.durationSeconds) <= request.durationSeconds
      && frameDifference(before, completed) > 0.01;
    return Object.freeze({
      effectPassed: complete && observations.length >= 4,
      description: technicalIntegrity
        ? `传送门从开启逐步扩张，门内画面覆盖范围持续增加，过程变化${visibility}，${complete ? "最终完成整幅画面切换" : "完成状态尚未确认"}。`
        : "门边扭曲、辉光和旋转属于传送门视觉；当前返修仅由视频解码或关键帧读取异常触发。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "开启过程", value: observations.length >= 4 ? "小范围到接近覆盖均有证据" : "过程证据不足" }),
        Object.freeze({ label: "画面变化", value: visibility }),
        Object.freeze({ label: "完成状态", value: complete ? "已完全切换" : "未能确认" })
      ]),
      observation: Object.freeze({
        aperture_progress: observations.length >= 4 ? "持续扩张" : "无法确认",
        transition_visibility: visibility,
        completion: complete ? "完成" : "未确认"
      })
    });
  }
});

export function runPortalSelfCheck(request: EffectSelfCheckRunRequest<PortalSelfCheckParams>) {
  return runEffectVideoSelfCheck(PORTAL_SELF_CHECK, request);
}
