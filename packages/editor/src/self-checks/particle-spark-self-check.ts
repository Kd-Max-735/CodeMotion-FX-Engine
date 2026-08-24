import type { EffectRenderResult } from "@codemotion/effect-functions";
import {
  amountFeeling, assignRole, directionLabel, maximumBy, orderedUnique, particleTextureObservation,
  runObservableSelfCheck, selectedFrames, semanticLevel, type ObservableFrameObservation,
  type ObservableSelfCheckDefinition, type ObservableSelfCheckRequest, type SelectedObservableFrame
} from "./observable-self-check.js";

export function captureParticleSparkObservation(result: EffectRenderResult | undefined, frame: number,
  time: number, width: number, height: number): ObservableFrameObservation | undefined {
  return particleTextureObservation(result, frame, time, width, height);
}

export function selectParticleSparkKeyframes(observations: readonly ObservableFrameObservation[]): readonly SelectedObservableFrame[] {
  const ordered = [...observations].sort((a, b) => a.frame - b.frame);
  const peaks = ordered.filter((item, index) => item.activity > (ordered[index - 1]?.activity ?? -1)
    && item.activity >= (ordered[index + 1]?.activity ?? -1))
    .sort((a, b) => b.activity - a.activity)
    .slice(0, 4);
  const onset = ordered.find((item, index) => item.activity > 0 && (ordered[index - 1]?.activity ?? 0) === 0);
  const decay = ordered.find((item, index) => index > 0 && item.activity < ordered[index - 1]!.activity * 0.45);
  const picked = orderedUnique([ordered[0]], [onset], peaks, [decay], [ordered.at(-1)]);
  const roles = new Map<number, string>();
  if (ordered[0]) assignRole(roles, ordered[0].frame, "火花初始");
  if (onset) assignRole(roles, onset.frame, "爆发起点");
  peaks.forEach((item, index) => assignRole(roles, item.frame, index === 0 ? "最强爆发" : `第 ${index + 1} 次爆发`));
  if (decay) assignRole(roles, decay.frame, "火花衰减");
  if (ordered.at(-1)) assignRole(roles, ordered.at(-1)!.frame, "火花尾段");
  return selectedFrames(picked, roles);
}

function summarize(selected: readonly SelectedObservableFrame[], all: readonly ObservableFrameObservation[]) {
  const peak = maximumBy(all, (item) => item.activity * (item.opacity ?? 1)) ?? selected[0]!;
  const localPeaks = all.filter((item, index) => item.activity > (all[index - 1]?.activity ?? -1)
    && item.activity >= (all[index + 1]?.activity ?? -1)).length;
  const speed = semanticLevel(peak.speed, 0.2, 0.9, ["轻缓", "有力", "迅猛"]);
  return {
    description: `火花从爆发点向${directionLabel(peak.directionX, peak.directionY)}飞散，爆发感${speed}，随后可见自然衰减。`,
    keyInformation: [
      { label: "特效类型", value: "火花粒子" },
      { label: "火花数量感", value: amountFeeling(peak.activity, peak.coverage) },
      { label: "爆发次数感", value: localPeaks <= 1 ? "单次主要爆发" : `连续多次爆发` },
      { label: "飞散方向", value: directionLabel(peak.directionX, peak.directionY) },
      { label: "爆发力度", value: speed },
      { label: "衰减表现", value: all.at(-1)!.activity < peak.activity * 0.5 ? "尾段明显收弱" : "尾段仍有持续火花" }
    ]
  };
}

export const PARTICLE_SPARK_SELF_CHECK: ObservableSelfCheckDefinition = Object.freeze({
  toolName: "particle_spark", displayName: "火花粒子", ruleFileName: "particle_spark.md",
  capture: captureParticleSparkObservation, select: selectParticleSparkKeyframes, summarize
});

export async function runParticleSparkSelfCheck(request: ObservableSelfCheckRequest) {
  return runObservableSelfCheck(PARTICLE_SPARK_SELF_CHECK, request);
}
