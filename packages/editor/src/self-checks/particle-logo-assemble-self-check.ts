import type { EffectRenderResult } from "@codemotion/effect-functions";
import {
  amountFeeling, assignRole, closestTo, maximumBy, orderedUnique, particleTextureObservation,
  runObservableSelfCheck, selectedFrames, type ObservableFrameObservation,
  type ObservableSelfCheckDefinition, type ObservableSelfCheckRequest, type SelectedObservableFrame
} from "./observable-self-check.js";

export function captureParticleLogoAssembleObservation(result: EffectRenderResult | undefined, frame: number,
  time: number, width: number, height: number): ObservableFrameObservation | undefined {
  return particleTextureObservation(result, frame, time, width, height);
}

export function selectParticleLogoAssembleKeyframes(observations: readonly ObservableFrameObservation[]): readonly SelectedObservableFrame[] {
  const ordered = [...observations].sort((a, b) => a.frame - b.frame);
  const visible = ordered.filter((item) => (item.opacity ?? 0) > 0.01);
  const start = visible[0] ?? ordered[0];
  const widest = maximumBy(visible, (item) => item.spread);
  const tightest = maximumBy(visible, (item) => -item.spread);
  const middleSpread = widest === undefined || tightest === undefined ? undefined : (widest.spread + tightest.spread) / 2;
  const midpoint = middleSpread === undefined ? undefined : closestTo(visible, middleSpread, (item) => item.spread);
  const opacityPeak = maximumBy(visible, (item) => item.opacity ?? 0);
  const picked = orderedUnique([start], [widest], [midpoint], [opacityPeak], [tightest], [ordered.at(-1)]);
  const roles = new Map<number, string>();
  if (start) assignRole(roles, start.frame, "散布粒子出现");
  if (widest) assignRole(roles, widest.frame, "最分散状态");
  if (midpoint) assignRole(roles, midpoint.frame, "聚合中段");
  if (opacityPeak) assignRole(roles, opacityPeak.frame, "轮廓形成");
  if (tightest) assignRole(roles, tightest.frame, "聚合最紧密");
  if (ordered.at(-1)) assignRole(roles, ordered.at(-1)!.frame, "最终 Logo 状态");
  return selectedFrames(picked, roles);
}

function summarize(selected: readonly SelectedObservableFrame[], all: readonly ObservableFrameObservation[]) {
  const visible = all.filter((item) => (item.opacity ?? 0) > 0.01);
  const widest = maximumBy(visible, (item) => item.spread) ?? selected[0]!;
  const tightest = maximumBy(visible, (item) => -item.spread) ?? selected.at(-1)!;
  const reduction = widest.spread <= 0 ? 0 : 1 - tightest.spread / widest.spread;
  return {
    description: `粒子从${widest.coverage > 0.55 ? "宽范围" : "周边"}向目标区域聚合，${reduction > 0.65 ? "轮廓收拢明显" : reduction > 0.3 ? "聚合过程清晰" : "聚合幅度较轻"}，最终形成 Logo。`,
    keyInformation: [
      { label: "特效类型", value: "粒子 Logo 聚合" },
      { label: "粒子数量感", value: amountFeeling(widest.activity, widest.coverage) },
      { label: "初始分布", value: widest.coverage < 0.35 ? "目标周围集中" : "由周边散布区域汇入" },
      { label: "聚合程度", value: reduction > 0.65 ? "高度聚合" : reduction > 0.3 ? "明显聚合" : "轻度聚合" },
      { label: "聚合节奏", value: selected.length >= 4 ? "散布、中段、成形连续可见" : "短时聚合过程可见" },
      { label: "最终形态", value: tightest.spread < widest.spread ? "粒子收拢并形成目标轮廓" : "目标轮廓形成不明显" }
    ]
  };
}

export const PARTICLE_LOGO_ASSEMBLE_SELF_CHECK: ObservableSelfCheckDefinition = Object.freeze({
  toolName: "particle_logo_assemble", displayName: "粒子 Logo 聚合", ruleFileName: "particle_logo_assemble.md",
  capture: captureParticleLogoAssembleObservation, select: selectParticleLogoAssembleKeyframes, summarize
});

export async function runParticleLogoAssembleSelfCheck(request: ObservableSelfCheckRequest) {
  return runObservableSelfCheck(PARTICLE_LOGO_ASSEMBLE_SELF_CHECK, request);
}
