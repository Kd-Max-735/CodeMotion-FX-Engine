import {
  averageFrameChange,
  frameDifference,
  numericParam,
  runEffectVideoSelfCheck,
  samplingPlanAtTimes,
  stringParam,
  visualStrength,
  type EffectSelfCheckConfig,
  type EffectSelfCheckPlanRequest,
  type EffectSelfCheckRunRequest
} from "./effect-video-self-check.js";

export type WipeSelfCheckParams = Readonly<Record<string, unknown>>;

const DIRECTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  left: "从左向右",
  right: "从右向左",
  up: "从上向下",
  down: "从下向上",
  left_top_to_right_bottom: "从左上向右下",
  left_bottom_to_right_top: "从左下向右上",
  right_top_to_left_bottom: "从右上向左下",
  right_bottom_to_left_top: "从右下向左上"
});

export function wipeSamplingPlan(request: EffectSelfCheckPlanRequest<WipeSelfCheckParams>) {
  const duration = numericParam(request.params, "duration", request.durationSeconds);
  return samplingPlanAtTimes(request.durationSeconds, request.fps, [
    { evidenceId: "before_wipe", role: "before_wipe", label: "擦除前", time: 0 },
    { evidenceId: "wipe_quarter", role: "wipe_quarter", label: "擦除四分之一", time: duration * 0.25 },
    { evidenceId: "wipe_middle", role: "wipe_middle", label: "擦除中段", time: duration * 0.5 },
    { evidenceId: "wipe_three_quarters", role: "wipe_three_quarters", label: "擦除四分之三", time: duration * 0.75 },
    { evidenceId: "wipe_complete", role: "wipe_complete", label: "擦除完成", time: duration + 0.05 }
  ]);
}

const WIPE_SELF_CHECK = Object.freeze<EffectSelfCheckConfig<WipeSelfCheckParams>>({
  toolName: "wipe",
  displayName: "线性擦除",
  samplingPlan: wipeSamplingPlan,
  describe: (request, observations, technicalIntegrity) => {
    const direction = DIRECTION_LABELS[stringParam(request.params, "direction", "left")] ?? "沿指定方向";
    const visibility = visualStrength(averageFrameChange(observations));
    const before = observations.find((item) => item.role === "before_wipe");
    const completed = observations.find((item) => item.role === "wipe_complete");
    const complete = completed !== undefined
      && numericParam(request.params, "duration", request.durationSeconds) <= request.durationSeconds
      && frameDifference(before, completed) > 0.01;
    return Object.freeze({
      effectPassed: complete && observations.length >= 4,
      description: technicalIntegrity
        ? `新画面${direction}持续推进，关键帧覆盖四分之一、中段、四分之三和完成状态，边界变化${visibility}，${complete ? "最终完成整幅替换" : "完成状态尚未确认"}。`
        : "擦除边界和跨帧大面积变化属于正常转场；当前返修仅由视频解码或关键帧读取异常触发。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "推进方向", value: direction }),
        Object.freeze({ label: "转场进度", value: observations.length >= 4 ? "主要阶段均已覆盖" : "阶段证据不足" }),
        Object.freeze({ label: "完成状态", value: complete ? "擦除完成" : "未能确认" })
      ]),
      observation: Object.freeze({
        wipe_direction: direction,
        progress_coverage: observations.length >= 4 ? "完整" : "不完整",
        boundary_visibility: visibility,
        completion: complete ? "完成" : "未确认"
      })
    });
  }
});

export function runWipeSelfCheck(request: EffectSelfCheckRunRequest<WipeSelfCheckParams>) {
  return runEffectVideoSelfCheck(WIPE_SELF_CHECK, request);
}
