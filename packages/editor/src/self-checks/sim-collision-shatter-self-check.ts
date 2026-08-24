import type { EffectRenderResult } from "@codemotion/effect-functions";
import {
  amountFeeling, assignRole, closestTo, directionLabel, maximumBy, orderedUnique, runObservableSelfCheck,
  selectedFrames, semanticLevel, simulationObservation, type ObservableFrameObservation,
  type ObservableSelfCheckDefinition, type ObservableSelfCheckRequest, type SelectedObservableFrame
} from "./observable-self-check.js";

export function captureCollisionShatterObservation(result: EffectRenderResult | undefined, frame: number,
  time: number): ObservableFrameObservation | undefined {
  return simulationObservation(result, "fragments", frame, time);
}

export function selectCollisionShatterKeyframes(observations: readonly ObservableFrameObservation[]): readonly SelectedObservableFrame[] {
  const ordered = [...observations].sort((a, b) => a.frame - b.frame);
  const maximumDisplacement = maximumBy(ordered, (item) => item.displacement ?? 0);
  const firstSeparation = maximumDisplacement === undefined ? undefined
    : closestTo(ordered, (maximumDisplacement.displacement ?? 0) * 0.2, (item) => item.displacement ?? 0);
  const burst = maximumBy(ordered, (item) => item.speed);
  const firstImpact = ordered.find((item, index) => (item.impacts ?? 0) > (ordered[index - 1]?.impacts ?? 0));
  const spin = maximumBy(ordered, (item) => item.rotation ?? 0);
  const picked = orderedUnique([ordered[0]], [firstSeparation], [burst], [firstImpact], [spin],
    [maximumDisplacement], [ordered.at(-1)]);
  const roles = new Map<number, string>();
  if (ordered[0]) assignRole(roles, ordered[0].frame, "碰撞前形态");
  if (firstSeparation) assignRole(roles, firstSeparation.frame, "碎片开始分离");
  if (burst) assignRole(roles, burst.frame, "爆裂速度峰值");
  if (firstImpact) assignRole(roles, firstImpact.frame, "碎片首次落地");
  if (spin) assignRole(roles, spin.frame, "旋转最明显");
  if (maximumDisplacement) assignRole(roles, maximumDisplacement.frame, "碎片散布最广");
  if (ordered.at(-1)) assignRole(roles, ordered.at(-1)!.frame, "碎裂后状态");
  return selectedFrames(picked, roles);
}

function summarize(selected: readonly SelectedObservableFrame[], all: readonly ObservableFrameObservation[]) {
  const burst = maximumBy(all, (item) => item.speed) ?? selected[0]!;
  const spread = maximumBy(all, (item) => item.displacement ?? 0) ?? selected.at(-1)!;
  const force = semanticLevel(burst.speed, 1.5, 5, ["轻微", "明显", "强烈"]);
  const range = semanticLevel(spread.displacement ?? 0, 0.25, 0.9, ["局部", "中等", "广泛"]);
  return {
    description: `主体碰撞后发生${force}碎裂，碎片向${directionLabel(burst.directionX, burst.directionY)}为主的${range}范围飞散，并出现旋转或落地过程。`,
    keyInformation: [
      { label: "特效类型", value: "碰撞碎裂" },
      { label: "碎片数量感", value: amountFeeling(spread.activity, spread.coverage) },
      { label: "碎裂力度", value: force },
      { label: "飞散范围", value: range },
      { label: "主要运动方向", value: directionLabel(burst.directionX, burst.directionY) },
      { label: "后续运动", value: (spread.impacts ?? 0) > 0 ? "可见落地或回弹" : (spread.rotation ?? 0) > 0.1 ? "可见旋转飞散" : "碎片持续分离" }
    ]
  };
}

export const SIM_COLLISION_SHATTER_SELF_CHECK: ObservableSelfCheckDefinition = Object.freeze({
  toolName: "sim_collision_shatter", displayName: "碰撞碎裂", ruleFileName: "sim_collision_shatter.md",
  capture: captureCollisionShatterObservation, select: selectCollisionShatterKeyframes, summarize
});

export async function runSimCollisionShatterSelfCheck(request: ObservableSelfCheckRequest) {
  return runObservableSelfCheck(SIM_COLLISION_SHATTER_SELF_CHECK, request);
}
