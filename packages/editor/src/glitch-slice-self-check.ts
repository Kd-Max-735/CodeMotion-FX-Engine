import {
  averageFrameChange,
  dominantOrientation,
  runEffectVideoSelfCheck,
  samplingPlanAtFractions,
  visualStrength,
  type EffectSelfCheckConfig,
  type EffectSelfCheckPlanRequest,
  type EffectSelfCheckRunRequest
} from "./effect-video-self-check.js";

export type GlitchSliceSelfCheckParams = Readonly<Record<string, unknown>>;

export function glitchSliceSamplingPlan(request: EffectSelfCheckPlanRequest<GlitchSliceSelfCheckParams>) {
  return samplingPlanAtFractions(request.durationSeconds, request.fps, [
    { evidenceId: "slice_onset", role: "slice_onset", label: "切片初现", fraction: 0.08 },
    { evidenceId: "slice_pattern", role: "slice_pattern", label: "切片结构", fraction: 0.35 },
    { evidenceId: "slice_variation", role: "slice_variation", label: "错位变化", fraction: 0.63 },
    { evidenceId: "slice_late", role: "slice_late", label: "后段切片", fraction: 0.92 }
  ]);
}

const GLITCH_SLICE_SELF_CHECK = Object.freeze<EffectSelfCheckConfig<GlitchSliceSelfCheckParams>>({
  toolName: "glitch_slice",
  displayName: "故障切片",
  samplingPlan: glitchSliceSamplingPlan,
  describe: (_request, observations, technicalIntegrity) => {
    const direction = dominantOrientation(observations);
    const change = averageFrameChange(observations);
    const strength = visualStrength(change);
    return Object.freeze({
      effectPassed: observations.length === 4 && change > 0.003,
      description: technicalIntegrity
        ? `画面呈现${strength}的${direction}切片错位，切片结构在不同时刻发生变化；红蓝边缘或画面撕裂按故障视觉处理，不属于编码损坏。`
        : "故障切片本身不算技术损坏，但最终视频的完整解码或关键帧读取失败，需要返修。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "切片方向", value: direction }),
        Object.freeze({ label: "错位程度", value: strength }),
        Object.freeze({ label: "完成状态", value: observations.length === 4 ? "后段画面完整" : "关键时刻不完整" })
      ]),
      observation: Object.freeze({
        slice_direction: direction,
        displacement_visibility: strength,
        slice_pattern_changes_over_time: change > 0.005,
        completion: observations.length === 4 ? "已完成取证" : "取证不完整"
      })
    });
  }
});

export function runGlitchSliceSelfCheck(request: EffectSelfCheckRunRequest<GlitchSliceSelfCheckParams>) {
  return runEffectVideoSelfCheck(GLITCH_SLICE_SELF_CHECK, request);
}
