import { finite, runFinalVideoSelfCheck, type FinalFrameObservation, type FinalVideoSelfCheckRequest, type FinalVideoSelfCheckSpec, type SelfCheckSummary } from "./final-video-self-check.js";
import { centroidTravel, effectCheck, observationSummary, sharedQuality, stablePlan, staticEvidence, strongest } from "./final-video-self-check-helpers.js";

export const lensFlareSamplingPlan = stablePlan;

function summarizeLensFlare(context: Parameters<FinalVideoSelfCheckSpec["summarize"]>[0]): SelfCheckSummary {
  const representative = strongest(context.observations);
  const facts = observationSummary(representative);
  const stable = centroidTravel(context.observations) < 0.08;
  const ghosts = Math.max(...context.observations.map((item) => item.componentCount));
  return Object.freeze({
    description: `镜头光晕的主光源位于${facts.location}，呈${facts.brightness}的${facts.color}高光，并带有${ghosts > 1 ? "分离的镜片鬼影与" : "克制的"}水平光条。`,
    keyInformation: Object.freeze([
      { label: "光源位置", value: facts.location }, { label: "实际亮度", value: facts.brightness },
      { label: "主要颜色", value: facts.color },
      { label: "鬼影表现", value: ghosts > 1 ? "可见多个分离光斑，沿主光源方向排列" : "鬼影较少或不明显" },
      { label: "镜头条纹", value: "以水平散射为主" }, { label: "覆盖范围", value: facts.coverage },
      { label: "稳定性", value: stable ? "主光源和鬼影位置稳定" : "光斑位置发生异常漂移" }
    ]),
    quality: sharedQuality(context, "主光源中心的高亮属于镜头光晕表现，不因局部明亮直接判为过曝故障",
      stable ? "光学元素位置稳定" : "光学元素位置不稳定"),
    checks: Object.freeze([
      effectCheck("LENS_FLARE_SOURCE_STABILITY", stable,
        "主光源、鬼影和条纹在前中后段保持稳定。", "镜头光晕的主光源或鬼影在静态画面中发生明显漂移。", "FLARE_POSITION_DRIFT"),
      effectCheck("LENS_FLARE_OPTICAL_STRUCTURE", representative.changedAreaRatio < 0.82,
        "局部高亮、光斑和条纹仍保留可辨认的镜头层次。", "光晕覆盖接近全画面，镜头层次和底图均难以辨认。", "FLARE_GLOBAL_WASH")
    ])
  });
}

const SPEC: FinalVideoSelfCheckSpec = Object.freeze({
  toolName: "lens_flare",
  displayName: "镜头光晕",
  isNeutral: (params: Readonly<Record<string, unknown>>) => finite(params.ghosts) <= 0 && finite(params.streak) <= 0 && finite(params.chromatic) <= 0,
  samplingPlan: lensFlareSamplingPlan,
  selectEvidence: (observations: readonly FinalFrameObservation[]) => staticEvidence(observations),
  summarize: summarizeLensFlare
});

export function runLensFlareSelfCheck(request: FinalVideoSelfCheckRequest) {
  return runFinalVideoSelfCheck(SPEC, request);
}
