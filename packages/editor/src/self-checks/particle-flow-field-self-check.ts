import type { EffectRenderResult } from "@codemotion/effect-functions";
import {
  amountFeeling, assignRole, directionLabel, distributionLabel, maximumBy, orderedUnique, runObservableSelfCheck,
  selectedFrames, semanticLevel, simulationObservation, type ObservableFrameObservation,
  type ObservableSelfCheckDefinition, type ObservableSelfCheckRequest, type SelectedObservableFrame
} from "./observable-self-check.js";

export function captureParticleFlowFieldObservation(result: EffectRenderResult | undefined, frame: number,
  time: number): ObservableFrameObservation | undefined {
  return simulationObservation(result, "particles", frame, time);
}

export function selectParticleFlowFieldKeyframes(observations: readonly ObservableFrameObservation[]): readonly SelectedObservableFrame[] {
  const ordered = [...observations].sort((a, b) => a.frame - b.frame);
  const turn = maximumBy(ordered.slice(1), (item) => {
    const before = ordered[Math.max(0, ordered.indexOf(item) - 1)]!;
    const dot = before.directionX * item.directionX + before.directionY * item.directionY;
    return Math.max(0, -dot) + Math.abs(item.angularMotion - before.angularMotion);
  });
  const speedPeak = maximumBy(ordered, (item) => item.speed);
  const coveragePeak = maximumBy(ordered, (item) => item.coverage);
  const picked = orderedUnique([ordered[0]], [turn], [speedPeak], [coveragePeak], [ordered.at(-1)]);
  const roles = new Map<number, string>();
  if (ordered[0]) assignRole(roles, ordered[0].frame, "流场建立");
  if (turn) assignRole(roles, turn.frame, "流向转折");
  if (speedPeak) assignRole(roles, speedPeak.frame, "流动峰值");
  if (coveragePeak) assignRole(roles, coveragePeak.frame, "分布最充分");
  if (ordered.at(-1)) assignRole(roles, ordered.at(-1)!.frame, "流场后段");
  return selectedFrames(picked, roles);
}

function summarize(selected: readonly SelectedObservableFrame[], all: readonly ObservableFrameObservation[]) {
  const representative = maximumBy(all, (item) => item.speed * (0.5 + item.coverage)) ?? selected[0]!;
  const speed = semanticLevel(representative.speed, 0.08, 0.35, ["缓慢", "流畅", "快速"]);
  const flow = representative.coherence < 0.25 ? "多向湍动" : representative.coherence < 0.6 ? "弯曲流动" : "主流向清晰";
  return {
    description: `粒子在画面中形成${flow}的流场，整体${directionLabel(representative.directionX, representative.directionY)}，流动节奏${speed}。`,
    keyInformation: [
      { label: "特效类型", value: "粒子流场" },
      { label: "粒子数量感", value: amountFeeling(representative.activity, representative.coverage) },
      { label: "流场形态", value: flow },
      { label: "主运动方向", value: directionLabel(representative.directionX, representative.directionY) },
      { label: "流动速度", value: speed },
      { label: "空间分布", value: distributionLabel(representative) }
    ]
  };
}

export const PARTICLE_FLOW_FIELD_SELF_CHECK: ObservableSelfCheckDefinition = Object.freeze({
  toolName: "particle_flow_field", displayName: "粒子流场", ruleFileName: "particle_flow_field.md",
  capture: captureParticleFlowFieldObservation, select: selectParticleFlowFieldKeyframes, summarize
});

export async function runParticleFlowFieldSelfCheck(request: ObservableSelfCheckRequest) {
  return runObservableSelfCheck(PARTICLE_FLOW_FIELD_SELF_CHECK, request);
}
