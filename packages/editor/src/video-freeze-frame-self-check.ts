import {
  frameDifference,
  numericParam,
  runEffectVideoSelfCheck,
  samplingPlanAtTimes,
  type EffectSelfCheckConfig,
  type EffectSelfCheckPlanRequest,
  type EffectSelfCheckRunRequest
} from "./effect-video-self-check.js";

export type VideoFreezeFrameSelfCheckParams = Readonly<Record<string, unknown>>;

export function videoFreezeFrameSamplingPlan(
  request: EffectSelfCheckPlanRequest<VideoFreezeFrameSelfCheckParams>
) {
  const start = numericParam(request.params, "freezeAt", request.durationSeconds * 0.35);
  const freezeDuration = numericParam(request.params, "freezeDuration", request.durationSeconds * 0.25);
  const end = start + freezeDuration;
  const frameStep = 1 / Math.max(1, request.fps);
  return samplingPlanAtTimes(request.durationSeconds, request.fps, [
    { evidenceId: "before_freeze", role: "before_freeze", label: "定格前", time: Math.max(0, start - 0.25) },
    { evidenceId: "freeze_start", role: "freeze_start", label: "定格开始", time: start + frameStep },
    { evidenceId: "freeze_middle", role: "freeze_middle", label: "定格中段", time: start + freezeDuration * 0.5 },
    { evidenceId: "freeze_end", role: "freeze_end", label: "定格结束前", time: Math.max(start, end - frameStep) },
    { evidenceId: "motion_resume", role: "motion_resume", label: "运动恢复", time: end + 0.2 },
    { evidenceId: "after_resume", role: "after_resume", label: "恢复后", time: end + 0.55 }
  ]);
}

const VIDEO_FREEZE_FRAME_SELF_CHECK = Object.freeze<EffectSelfCheckConfig<VideoFreezeFrameSelfCheckParams>>({
  toolName: "video_freeze_frame",
  displayName: "视频定格",
  samplingPlan: videoFreezeFrameSamplingPlan,
  describe: (_request, observations, technicalIntegrity) => {
    const frozen = observations.filter((item) => item.role.startsWith("freeze_"));
    const freezeDifferences = frozen.slice(1).map((item, index) => frameDifference(frozen[index], item));
    const stable = frozen.length >= 2 && freezeDifferences.every((value) => value <= 0.01);
    const freezeEnd = frozen.at(-1);
    const resumedFrame = observations.find((item) => item.role === "after_resume")
      ?? observations.find((item) => item.role === "motion_resume");
    const resumed = resumedFrame !== undefined && frameDifference(freezeEnd, resumedFrame) > 0.01;
    return Object.freeze({
      effectPassed: stable && resumed,
      description: technicalIntegrity
        ? `画面在定格开始至结束前保持${stable ? "一致" : "存在可见变化"}，随后${resumed ? "恢复运动画面" : "缺少恢复证据"}；定格区间的静止是用户要求，不作为卡死。`
        : "定格画面不会被当作卡死；当前返修仅因为最终视频未通过完整解码或关键帧读取。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "冻结区间", value: stable ? "画面保持一致" : "存在变化，需要核对" }),
        Object.freeze({ label: "冻结边界", value: frozen.length >= 3 ? "开始、中段、结束均已覆盖" : "覆盖不足" }),
        Object.freeze({ label: "恢复状态", value: resumed ? "定格后已恢复" : "未能确认" })
      ]),
      observation: Object.freeze({
        freeze_interval_stable: stable,
        freeze_boundaries: frozen.length >= 3 ? "完整" : "不完整",
        motion_after_freeze: resumed ? "已取证" : "未取证",
        completion: stable && resumed ? "完成" : "需要核对"
      })
    });
  }
});

export function runVideoFreezeFrameSelfCheck(
  request: EffectSelfCheckRunRequest<VideoFreezeFrameSelfCheckParams>
) {
  return runEffectVideoSelfCheck(VIDEO_FREEZE_FRAME_SELF_CHECK, request);
}
