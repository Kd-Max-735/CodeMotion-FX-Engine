import type { EffectRenderResult } from "@codemotion/effect-functions";
import {
  amountFeeling, assignRole, closestTo, directionLabel, firstActive, lastActive, maximumBy, orderedUnique,
  particleTextureObservation, runObservableSelfCheck, selectedFrames, semanticLevel,
  type ObservableFrameObservation, type ObservableSelfCheckDefinition,
  type ObservableSelfCheckRequest, type SelectedObservableFrame
} from "./observable-self-check.js";

export function captureParticleEmitterObservation(result: EffectRenderResult | undefined, frame: number,
  time: number, width: number, height: number): ObservableFrameObservation | undefined {
  return particleTextureObservation(result, frame, time, width, height);
}

export function selectParticleEmitterKeyframes(observations: readonly ObservableFrameObservation[]): readonly SelectedObservableFrame[] {
  const ordered = [...observations].sort((a, b) => a.frame - b.frame);
  const peak = maximumBy(ordered, (item) => item.activity);
  const picked = orderedUnique(
    [ordered[0]], [firstActive(ordered)],
    [peak === undefined ? undefined : closestTo(ordered, peak.activity * 0.35, (item) => item.activity)],
    [peak], [peak === undefined ? undefined : closestTo(ordered.slice(ordered.indexOf(peak)), peak.activity * 0.55, (item) => item.activity)],
    [lastActive(ordered)], [ordered.at(-1)]
  );
  const roles = new Map<number, string>();
  if (ordered[0]) assignRole(roles, ordered[0].frame, "发射前状态");
  const onset = firstActive(ordered); if (onset) assignRole(roles, onset.frame, "开始发射");
  if (peak) assignRole(roles, peak.frame, "粒子数量峰值");
  const tail = lastActive(ordered); if (tail) assignRole(roles, tail.frame, "发射尾段");
  if (ordered.at(-1)) assignRole(roles, ordered.at(-1)!.frame, "最终状态");
  return selectedFrames(picked, roles);
}

function summarize(selected: readonly SelectedObservableFrame[], all: readonly ObservableFrameObservation[]) {
  const peak = maximumBy(all, (item) => item.activity) ?? selected[0]!;
  const speed = semanticLevel(peak.speed, 0.12, 0.65, ["柔和", "清晰", "强劲"]);
  return {
    description: `粒子从局部发射区域持续生成，主要${directionLabel(peak.directionX, peak.directionY)}运动，发射表现${speed}。`,
    keyInformation: [
      { label: "特效类型", value: "粒子发射器" },
      { label: "粒子数量感", value: amountFeeling(peak.activity, peak.coverage) },
      { label: "发射位置感", value: peak.coverage < 0.25 ? "发射源集中" : "发射源及扩散区域清晰" },
      { label: "发射方向", value: directionLabel(peak.directionX, peak.directionY) },
      { label: "发射力度", value: speed },
      { label: "生命周期", value: all.at(-1)!.activity < peak.activity * 0.2 ? "发射后自然退场" : "尾段仍持续可见" }
    ]
  };
}

export const PARTICLE_EMITTER_SELF_CHECK: ObservableSelfCheckDefinition = Object.freeze({
  toolName: "particle_emitter", displayName: "粒子发射器", ruleFileName: "particle_emitter.md",
  capture: captureParticleEmitterObservation, select: selectParticleEmitterKeyframes, summarize
});

export async function runParticleEmitterSelfCheck(request: ObservableSelfCheckRequest) {
  return runObservableSelfCheck(PARTICLE_EMITTER_SELF_CHECK, request);
}
