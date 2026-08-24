import type { EffectRenderResult } from "@codemotion/effect-functions";
import {
  amountFeeling, assignRole, directionLabel, firstActive, lastActive, maximumBy, orderedUnique,
  particleTextureObservation, runObservableSelfCheck, selectedFrames, semanticLevel,
  type ObservableFrameObservation, type ObservableSelfCheckDefinition,
  type ObservableSelfCheckRequest, type SelectedObservableFrame
} from "./observable-self-check.js";

export function captureParticleTrailObservation(result: EffectRenderResult | undefined, frame: number,
  time: number, width: number, height: number): ObservableFrameObservation | undefined {
  return particleTextureObservation(result, frame, time, width, height);
}

export function selectParticleTrailKeyframes(observations: readonly ObservableFrameObservation[]): readonly SelectedObservableFrame[] {
  const ordered = [...observations].sort((a, b) => a.frame - b.frame);
  const extent = maximumBy(ordered, (item) => item.spread);
  const bend = maximumBy(ordered, (item) => Math.abs(item.angularMotion));
  const density = maximumBy(ordered, (item) => item.activity * (item.opacity ?? 1));
  const picked = orderedUnique([ordered[0]], [firstActive(ordered)], [extent], [bend], [density],
    [lastActive(ordered)], [ordered.at(-1)]);
  const roles = new Map<number, string>();
  if (ordered[0]) assignRole(roles, ordered[0].frame, "拖尾起点");
  const onset = firstActive(ordered); if (onset) assignRole(roles, onset.frame, "拖尾生成");
  if (extent) assignRole(roles, extent.frame, "拖尾延展最明显");
  if (bend) assignRole(roles, bend.frame, "轨迹弯曲代表");
  if (density) assignRole(roles, density.frame, "拖尾主体最清晰");
  const tail = lastActive(ordered); if (tail) assignRole(roles, tail.frame, "拖尾衰减");
  if (ordered.at(-1)) assignRole(roles, ordered.at(-1)!.frame, "最终尾迹");
  return selectedFrames(picked, roles);
}

function summarize(selected: readonly SelectedObservableFrame[], all: readonly ObservableFrameObservation[]) {
  const extent = maximumBy(all, (item) => item.spread) ?? selected[0]!;
  const directionChanges = all.slice(1).filter((item, index) => {
    const before = all[index]!;
    return before.directionX * item.directionX + before.directionY * item.directionY < 0;
  }).length;
  const curve = Math.abs(extent.angularMotion) > 0.45 ? "环绕弧形" : directionChanges > 0 ? "波动曲线" : "较直轨迹";
  const length = semanticLevel(extent.spread, 0.16, 0.42, ["短", "适中", "长"]);
  return {
    description: `粒子沿${curve}形成${length}拖尾，主体${directionLabel(extent.directionX, extent.directionY)}移动，尾部逐渐变淡。`,
    keyInformation: [
      { label: "特效类型", value: "粒子拖尾" },
      { label: "粒子数量感", value: amountFeeling(extent.activity, extent.coverage) },
      { label: "拖尾长度感", value: length },
      { label: "轨迹形态", value: curve },
      { label: "运动方向", value: directionLabel(extent.directionX, extent.directionY) },
      { label: "衰减表现", value: all.at(-1)!.activity < extent.activity * 0.5 ? "尾部自然退去" : "尾迹持续保留" }
    ]
  };
}

export const PARTICLE_TRAIL_SELF_CHECK: ObservableSelfCheckDefinition = Object.freeze({
  toolName: "particle_trail", displayName: "粒子拖尾", ruleFileName: "particle_trail.md",
  capture: captureParticleTrailObservation, select: selectParticleTrailKeyframes, summarize
});

export async function runParticleTrailSelfCheck(request: ObservableSelfCheckRequest) {
  return runObservableSelfCheck(PARTICLE_TRAIL_SELF_CHECK, request);
}
