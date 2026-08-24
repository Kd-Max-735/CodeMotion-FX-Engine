import type { EffectRenderResult } from "@codemotion/effect-functions";
import {
  amountFeeling, assignRole, closestTo, directionLabel, firstActive, lastActive, maximumBy, orderedUnique,
  particleTextureObservation, runObservableSelfCheck, selectedFrames,
  type ObservableFrameObservation, type ObservableSelfCheckDefinition,
  type ObservableSelfCheckRequest, type SelectedObservableFrame
} from "./observable-self-check.js";

export function captureParticleDissolveObservation(result: EffectRenderResult | undefined, frame: number,
  time: number, width: number, height: number): ObservableFrameObservation | undefined {
  return particleTextureObservation(result, frame, time, width, height);
}

export function selectParticleDissolveKeyframes(observations: readonly ObservableFrameObservation[]): readonly SelectedObservableFrame[] {
  const ordered = [...observations].sort((a, b) => a.frame - b.frame);
  const withCoverage = ordered.filter((item) => item.sourceRemaining !== undefined);
  const picked = orderedUnique(
    [ordered[0]], [firstActive(ordered)],
    [closestTo(withCoverage, 0.5, (item) => item.sourceRemaining!)],
    [maximumBy(ordered, (item) => item.activity)], [lastActive(ordered)], [ordered.at(-1)]
  );
  const roles = new Map<number, string>();
  if (ordered[0]) assignRole(roles, ordered[0].frame, "溶解前状态");
  const onset = firstActive(ordered); if (onset) assignRole(roles, onset.frame, "开始消散");
  const middle = closestTo(withCoverage, 0.5, (item) => item.sourceRemaining!); if (middle) assignRole(roles, middle.frame, "主体半溶解");
  const peak = maximumBy(ordered, (item) => item.activity); if (peak) assignRole(roles, peak.frame, "粒子活动峰值");
  const tail = lastActive(ordered); if (tail) assignRole(roles, tail.frame, "消散尾段");
  if (ordered.at(-1)) assignRole(roles, ordered.at(-1)!.frame, "最终消散状态");
  return selectedFrames(picked, roles);
}

function summarize(selected: readonly SelectedObservableFrame[], all: readonly ObservableFrameObservation[]) {
  const peak = maximumBy(all, (item) => item.activity) ?? selected[0]!;
  const startRemaining = all[0]?.sourceRemaining;
  const endRemaining = all.at(-1)?.sourceRemaining;
  const change = startRemaining === undefined || endRemaining === undefined ? "可见溶解过程"
    : endRemaining < startRemaining * 0.2 ? "主体大幅消散" : endRemaining < startRemaining * 0.75 ? "主体部分消散" : "主体变化较轻";
  return {
    description: `最终视频呈现${change}，颗粒主要${directionLabel(peak.directionX, peak.directionY)}扩散，并保留了从生成到消散尾段的过程证据。`,
    keyInformation: [
      { label: "特效类型", value: "粒子溶解" },
      { label: "粒子数量感", value: amountFeeling(peak.activity, peak.coverage) },
      { label: "溶解程度", value: change },
      { label: "消散方向", value: directionLabel(peak.directionX, peak.directionY) },
      { label: "分布变化", value: `峰值阶段${peak.coverage < 0.3 ? "较集中" : peak.coverage < 0.65 ? "逐步铺开" : "广泛扩散"}` },
      { label: "过程完整性", value: selected.length >= 4 ? "开始、峰值与尾段均有证据" : "短时过程已覆盖可观察阶段" }
    ]
  };
}

export const PARTICLE_DISSOLVE_SELF_CHECK: ObservableSelfCheckDefinition = Object.freeze({
  toolName: "particle_dissolve", displayName: "粒子溶解", ruleFileName: "particle_dissolve.md",
  capture: captureParticleDissolveObservation, select: selectParticleDissolveKeyframes, summarize
});

export async function runParticleDissolveSelfCheck(request: ObservableSelfCheckRequest) {
  return runObservableSelfCheck(PARTICLE_DISSOLVE_SELF_CHECK, request);
}
