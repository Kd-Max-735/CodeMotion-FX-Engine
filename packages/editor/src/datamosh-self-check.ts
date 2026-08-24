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

export type DatamoshSelfCheckParams = Readonly<Record<string, unknown>>;

export function datamoshSamplingPlan(request: EffectSelfCheckPlanRequest<DatamoshSelfCheckParams>) {
  return samplingPlanAtFractions(request.durationSeconds, request.fps, [
    { evidenceId: "early_displacement", role: "early_displacement", label: "错帧初现", fraction: 0.06 },
    { evidenceId: "block_residue", role: "block_residue", label: "块状残帧形成", fraction: 0.24 },
    { evidenceId: "peak_mosh", role: "peak_mosh", label: "错帧主体", fraction: 0.5 },
    { evidenceId: "persistence", role: "persistence", label: "残帧延续", fraction: 0.76 },
    { evidenceId: "late_state", role: "late_state", label: "后段状态", fraction: 0.94 }
  ]);
}

const DATAMOSH_SELF_CHECK = Object.freeze<EffectSelfCheckConfig<DatamoshSelfCheckParams>>({
  toolName: "datamosh",
  displayName: "数据错帧",
  samplingPlan: datamoshSamplingPlan,
  describe: (_request, observations, technicalIntegrity) => {
    const change = averageFrameChange(observations);
    const strength = visualStrength(change);
    const orientation = dominantOrientation(observations);
    return Object.freeze({
      effectPassed: observations.length >= 4 && change > 0.003,
      description: technicalIntegrity
        ? `画面在多个时刻呈现${strength}的块状错帧与残帧延续，变化以${orientation}结构为主；最终视频可正常解码，这些故障外观属于特效表现。`
        : "画面中的块状错帧属于预期视觉，但最终视频未通过完整解码或关键帧读取，需要重新输出成片。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "错帧表现", value: `${strength}的块状画面携带` }),
        Object.freeze({ label: "延续状态", value: observations.length >= 4 ? "早、中、后段均可见" : "证据不足" }),
        Object.freeze({ label: "技术损坏", value: technicalIntegrity ? "未发现" : "发现解码或读取异常" })
      ]),
      observation: Object.freeze({
        displacement_visibility: strength,
        block_structure: orientation,
        persistence: observations.length >= 4 ? "持续可见" : "无法确认",
        completion: observations.length >= 5 ? "后段状态已取证" : "后段状态缺少证据"
      })
    });
  }
});

export function runDatamoshSelfCheck(request: EffectSelfCheckRunRequest<DatamoshSelfCheckParams>) {
  return runEffectVideoSelfCheck(DATAMOSH_SELF_CHECK, request);
}
