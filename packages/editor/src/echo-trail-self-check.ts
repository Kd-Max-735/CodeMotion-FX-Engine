import {
  averageFrameChange,
  dominantOrientation,
  numericParam,
  runEffectVideoSelfCheck,
  samplingPlanAtTimes,
  visualStrength,
  type EffectSelfCheckConfig,
  type EffectSelfCheckPlanRequest,
  type EffectSelfCheckRunRequest
} from "./effect-video-self-check.js";

export type EchoTrailSelfCheckParams = Readonly<Record<string, unknown>>;

export function echoTrailSamplingPlan(request: EffectSelfCheckPlanRequest<EchoTrailSelfCheckParams>) {
  const historySpan = Math.max(0.1, numericParam(request.params, "spacing", 0.12)
    * numericParam(request.params, "trailCount", 10));
  const last = Math.max(0, request.durationSeconds - 1 / Math.max(1, request.fps));
  return samplingPlanAtTimes(request.durationSeconds, request.fps, [
    { evidenceId: "before_echo", role: "before_echo", label: "拖影形成前", time: 0 },
    { evidenceId: "echo_forming", role: "echo_forming", label: "拖影形成", time: historySpan * 0.3 },
    { evidenceId: "echo_layering", role: "echo_layering", label: "历史轮廓叠加", time: historySpan * 0.65 },
    { evidenceId: "echo_established", role: "echo_established", label: "拖影完整形成", time: historySpan },
    { evidenceId: "echo_late", role: "echo_late", label: "后段拖影状态", time: Math.max(historySpan, last * 0.82) }
  ]);
}

const ECHO_TRAIL_SELF_CHECK = Object.freeze<EffectSelfCheckConfig<EchoTrailSelfCheckParams>>({
  toolName: "echo_trail",
  displayName: "历史帧回声拖影",
  samplingPlan: echoTrailSamplingPlan,
  describe: (_request, observations, technicalIntegrity) => {
    const visibility = visualStrength(averageFrameChange(observations));
    const direction = dominantOrientation(observations);
    const formed = observations.some((item) => item.role === "echo_established")
      && averageFrameChange(observations) > 0.005;
    return Object.freeze({
      effectPassed: formed && observations.some((item) => item.role === "echo_late"),
      description: technicalIntegrity
        ? `运动轮廓从形成到叠加呈现${visibility}的历史帧拖影，整体延展以${direction}为主；重复轮廓和残影属于目标视觉，不作为重影故障。`
        : "重复轮廓属于预期拖影，当前返修原因仅来自最终视频解码或关键帧读取异常。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "拖影形成", value: formed ? "已形成并有过程证据" : "未能确认" }),
        Object.freeze({ label: "拖影可见度", value: visibility }),
        Object.freeze({ label: "延展趋势", value: direction })
      ]),
      observation: Object.freeze({
        trail_formation: formed ? "完成" : "未确认",
        trail_visibility: visibility,
        trail_orientation: direction,
        completion: observations.some((item) => item.role === "echo_late") ? "后段状态已取证" : "后段证据不足"
      })
    });
  }
});

export function runEchoTrailSelfCheck(request: EffectSelfCheckRunRequest<EchoTrailSelfCheckParams>) {
  return runEffectVideoSelfCheck(ECHO_TRAIL_SELF_CHECK, request);
}
