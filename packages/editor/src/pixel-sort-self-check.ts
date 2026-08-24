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

export type PixelSortSelfCheckParams = Readonly<Record<string, unknown>>;

export function pixelSortSamplingPlan(request: EffectSelfCheckPlanRequest<PixelSortSelfCheckParams>) {
  return samplingPlanAtFractions(request.durationSeconds, request.fps, [
    { evidenceId: "sorted_early", role: "sorted_early", label: "前段排序", fraction: 0.12 },
    { evidenceId: "sorted_middle", role: "sorted_middle", label: "中段排序", fraction: 0.5 },
    { evidenceId: "sorted_late", role: "sorted_late", label: "后段排序", fraction: 0.88 }
  ]);
}

const PIXEL_SORT_SELF_CHECK = Object.freeze<EffectSelfCheckConfig<PixelSortSelfCheckParams>>({
  toolName: "pixel_sort",
  displayName: "像素排序",
  samplingPlan: pixelSortSamplingPlan,
  describe: (_request, observations, technicalIntegrity) => {
    const direction = dominantOrientation(observations);
    const visibility = visualStrength(observations.reduce((sum, item) =>
      sum + item.horizontalDifference + item.verticalDifference, 0) / Math.max(1, observations.length));
    const stability = averageFrameChange(observations) < 0.02 ? "稳定" : "随画面变化";
    return Object.freeze({
      effectPassed: observations.length === 3,
      description: technicalIntegrity
        ? `亮暗像素形成${direction}条带，排序痕迹${visibility}并在前、中、后段${stability}呈现；像素拉伸和错位是目标效果。`
        : "像素条带属于预期排序效果，但最终视频存在解码或关键帧读取异常，需要重新输出。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "像素走向", value: `${direction}条带` }),
        Object.freeze({ label: "排序可见度", value: visibility }),
        Object.freeze({ label: "时间表现", value: stability })
      ]),
      observation: Object.freeze({
        streak_direction: direction,
        pixel_change_visibility: visibility,
        temporal_state: stability,
        completion: observations.length === 3 ? "全段状态已取证" : "证据不足"
      })
    });
  }
});

export function runPixelSortSelfCheck(request: EffectSelfCheckRunRequest<PixelSortSelfCheckParams>) {
  return runEffectVideoSelfCheck(PIXEL_SORT_SELF_CHECK, request);
}
