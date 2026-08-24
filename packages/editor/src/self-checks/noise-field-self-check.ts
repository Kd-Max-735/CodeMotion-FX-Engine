import type { EffectRenderResult } from "@codemotion/effect-functions";
import {
  assignRole, maximumBy, noiseFieldObservation, orderedUnique, runObservableSelfCheck, selectedFrames,
  semanticLevel, signatureChange, type ObservableFrameObservation, type ObservableSelfCheckDefinition,
  type ObservableSelfCheckRequest, type SelectedObservableFrame
} from "./observable-self-check.js";

export function captureNoiseFieldObservation(result: EffectRenderResult | undefined, frame: number,
  time: number): ObservableFrameObservation | undefined {
  return noiseFieldObservation(result, frame, time);
}

export function selectNoiseFieldKeyframes(observations: readonly ObservableFrameObservation[]): readonly SelectedObservableFrame[] {
  const ordered = [...observations].sort((a, b) => a.frame - b.frame);
  const changes = ordered.slice(1).map((item, index) => ({ item, change: signatureChange(ordered[index], item) }))
    .sort((a, b) => b.change - a.change);
  const meaningful = changes.filter((entry) => entry.change > 0.002).slice(0, 3).map((entry) => entry.item);
  const contrast = maximumBy(ordered, (item) => item.contrast ?? 0);
  const detail = maximumBy(ordered, (item) => item.detail ?? 0);
  const picked = orderedUnique([ordered[0]], meaningful, [contrast], [detail], [ordered.at(-1)]);
  const roles = new Map<number, string>();
  if (ordered[0]) assignRole(roles, ordered[0].frame, "纹理起始");
  meaningful.forEach((item, index) => assignRole(roles, item.frame, `第 ${index + 1} 个明显演变`));
  if (contrast) assignRole(roles, contrast.frame, "层次最分明");
  if (detail) assignRole(roles, detail.frame, "细节代表");
  if (ordered.at(-1)) assignRole(roles, ordered.at(-1)!.frame, "纹理后段");
  return selectedFrames(picked, roles);
}

function summarize(selected: readonly SelectedObservableFrame[], all: readonly ObservableFrameObservation[]) {
  const representative = maximumBy(all, (item) => (item.contrast ?? 0) + (item.detail ?? 0)) ?? selected[0]!;
  const contrast = semanticLevel(representative.contrast ?? 0, 0.08, 0.18, ["柔和", "清晰", "强烈"]);
  const detail = semanticLevel(representative.detail ?? 0, 0.04, 0.13, ["大块舒展", "层次均衡", "细密丰富"]);
  const totalChange = signatureChange(all[0], all.at(-1));
  const motion = totalChange < 0.002 ? "纹理基本静止" : totalChange < 0.04 ? "纹理缓慢演变" : "纹理持续流动演变";
  return {
    description: `画面形成${detail}的噪声纹理，明暗层次${contrast}，${motion}。`,
    keyInformation: [
      { label: "特效类型", value: "噪声场" },
      { label: "纹理尺度", value: detail },
      { label: "明暗层次", value: contrast },
      { label: "空间分布", value: "连续铺满画面，无规则重复块" },
      { label: "时间变化", value: motion },
      { label: "稳定性", value: all.every((item) => item.finite) ? "纹理连续可观察" : "存在无效纹理帧" }
    ]
  };
}

export const NOISE_FIELD_SELF_CHECK: ObservableSelfCheckDefinition = Object.freeze({
  toolName: "noise_field", displayName: "噪声场", ruleFileName: "noise_field.md",
  capture: captureNoiseFieldObservation, select: selectNoiseFieldKeyframes, summarize
});

export async function runNoiseFieldSelfCheck(request: ObservableSelfCheckRequest) {
  return runObservableSelfCheck(NOISE_FIELD_SELF_CHECK, request);
}
