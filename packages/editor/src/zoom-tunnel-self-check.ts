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

export type ZoomTunnelSelfCheckParams = Readonly<Record<string, unknown>>;

export function zoomTunnelSamplingPlan(request: EffectSelfCheckPlanRequest<ZoomTunnelSelfCheckParams>) {
  const start = numericParam(request.params, "transitionStart", 0);
  const duration = numericParam(request.params, "duration", 1);
  const end = start + duration;
  return samplingPlanAtTimes(request.durationSeconds, request.fps, [
    { evidenceId: "before_tunnel", role: "before_tunnel", label: "转场前", time: Math.max(0, start - 0.2) },
    { evidenceId: "tunnel_onset", role: "tunnel_onset", label: "缩放开始", time: start + duration * 0.08 },
    { evidenceId: "tunnel_enter", role: "tunnel_enter", label: "进入隧道", time: start + duration * 0.3 },
    { evidenceId: "tunnel_middle", role: "tunnel_middle", label: "穿梭中段", time: start + duration * 0.55 },
    { evidenceId: "tunnel_exit", role: "tunnel_exit", label: "接近出口", time: start + duration * 0.82 },
    { evidenceId: "tunnel_complete", role: "tunnel_complete", label: "转场完成", time: end + 0.05 }
  ]);
}

const ZOOM_TUNNEL_SELF_CHECK = Object.freeze<EffectSelfCheckConfig<ZoomTunnelSelfCheckParams>>({
  toolName: "zoom_tunnel",
  displayName: "缩放隧道转场",
  samplingPlan: zoomTunnelSamplingPlan,
  describe: (request, observations, technicalIntegrity) => {
    const intensity = visualStrength(averageFrameChange(observations));
    const before = observations.find((item) => item.role === "before_tunnel");
    const completed = observations.find((item) => item.role === "tunnel_complete");
    const transitionEnd = numericParam(request.params, "transitionStart", 0)
      + numericParam(request.params, "duration", 1);
    const complete = completed !== undefined && transitionEnd <= request.durationSeconds
      && frameDifference(before, completed) > 0.01;
    return Object.freeze({
      effectPassed: complete && observations.length >= 5,
      description: technicalIntegrity
        ? `画面从转场前状态进入${intensity}的缩放穿梭，经过中段推进和出口阶段，${complete ? "最终到达后续画面" : "完成画面尚未确认"}。`
        : "缩放、拖影和快速画面变化属于隧道转场；当前返修仅由视频解码或关键帧读取异常触发。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "穿梭过程", value: observations.length >= 5 ? "起步、中段、出口均已覆盖" : "过程覆盖不足" }),
        Object.freeze({ label: "缩放变化", value: intensity }),
        Object.freeze({ label: "完成状态", value: complete ? "转场完成" : "未能确认" })
      ]),
      observation: Object.freeze({
        zoom_progress: observations.length >= 5 ? "完整" : "不完整",
        tunnel_visibility: intensity,
        completion: complete ? "完成" : "未确认"
      })
    });
  }
});

export function runZoomTunnelSelfCheck(request: EffectSelfCheckRunRequest<ZoomTunnelSelfCheckParams>) {
  return runEffectVideoSelfCheck(ZOOM_TUNNEL_SELF_CHECK, request);
}
