import type { EffectRenderResult } from "@codemotion/effect-functions";
import {
  amountFeeling, assignRole, maximumBy, orderedUnique, runObservableSelfCheck, selectedFrames, semanticLevel,
  simulationObservation, type ObservableFrameObservation, type ObservableSelfCheckDefinition,
  type ObservableSelfCheckRequest, type SelectedObservableFrame
} from "./observable-self-check.js";

export function captureParticleOrbitFieldObservation(result: EffectRenderResult | undefined, frame: number,
  time: number): ObservableFrameObservation | undefined {
  return simulationObservation(result, "particles", frame, time);
}

export function selectParticleOrbitFieldKeyframes(observations: readonly ObservableFrameObservation[]): readonly SelectedObservableFrame[] {
  const ordered = [...observations].sort((a, b) => a.frame - b.frame);
  let accumulated = 0;
  const rotations = ordered.map((item, index) => {
    if (index > 0) accumulated += Math.abs(item.angularMotion) * (item.time - ordered[index - 1]!.time);
    return { item, accumulated };
  });
  const total = rotations.at(-1)?.accumulated ?? 0;
  const milestones = [0.25, 0.5, 0.75].flatMap((fraction) => total <= 0 ? [] : [rotations.reduce((best, entry) =>
    Math.abs(entry.accumulated - total * fraction) < Math.abs(best.accumulated - total * fraction) ? entry : best).item]);
  const picked = orderedUnique([ordered[0]], milestones, [maximumBy(ordered, (item) => Math.abs(item.angularMotion))],
    [maximumBy(ordered, (item) => item.spread)], [ordered.at(-1)]);
  const roles = new Map<number, string>();
  if (ordered[0]) assignRole(roles, ordered[0].frame, "轨道形成");
  milestones.forEach((item, index) => assignRole(roles, item.frame, ["首段环绕", "半程环绕", "后段环绕"][index]!));
  const peak = maximumBy(ordered, (item) => Math.abs(item.angularMotion)); if (peak) assignRole(roles, peak.frame, "环绕最明显");
  if (ordered.at(-1)) assignRole(roles, ordered.at(-1)!.frame, "轨道后段");
  return selectedFrames(picked, roles);
}

function summarize(selected: readonly SelectedObservableFrame[], all: readonly ObservableFrameObservation[]) {
  const representative = maximumBy(all, (item) => Math.abs(item.angularMotion)) ?? selected[0]!;
  const direction = representative.angularMotion > 0 ? "顺时针" : representative.angularMotion < 0 ? "逆时针" : "环绕不明显";
  const radius = semanticLevel(representative.spread, 0.24, 0.52, ["紧凑", "适中", "宽阔"]);
  const speed = semanticLevel(Math.abs(representative.angularMotion), 0.35, 1.2, ["缓慢", "流畅", "快速"]);
  return {
    description: `粒子围绕中心形成${radius}轨道，主要按${direction}${speed}环绕。`,
    keyInformation: [
      { label: "特效类型", value: "粒子轨道场" },
      { label: "粒子数量感", value: amountFeeling(representative.activity, representative.coverage) },
      { label: "轨道范围", value: radius },
      { label: "环绕方向", value: direction },
      { label: "环绕速度", value: speed },
      { label: "轨道稳定性", value: all.some((item) => item.spread > representative.spread * 1.8) ? "半径变化明显" : "整体保持成环" }
    ]
  };
}

export const PARTICLE_ORBIT_FIELD_SELF_CHECK: ObservableSelfCheckDefinition = Object.freeze({
  toolName: "particle_orbit_field", displayName: "粒子轨道场", ruleFileName: "particle_orbit_field.md",
  capture: captureParticleOrbitFieldObservation, select: selectParticleOrbitFieldKeyframes, summarize
});

export async function runParticleOrbitFieldSelfCheck(request: ObservableSelfCheckRequest) {
  return runObservableSelfCheck(PARTICLE_ORBIT_FIELD_SELF_CHECK, request);
}
