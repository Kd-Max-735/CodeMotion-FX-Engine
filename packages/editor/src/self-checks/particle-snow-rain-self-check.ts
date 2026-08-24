import type { EffectRenderResult } from "@codemotion/effect-functions";
import {
  amountFeeling, assignRole, directionLabel, maximumBy, orderedUnique, particleTextureObservation,
  runObservableSelfCheck, selectedFrames, semanticLevel, type ObservableFrameObservation,
  type ObservableSelfCheckDefinition, type ObservableSelfCheckRequest, type SelectedObservableFrame
} from "./observable-self-check.js";

export function captureParticleSnowRainObservation(result: EffectRenderResult | undefined, frame: number,
  time: number, width: number, height: number): ObservableFrameObservation | undefined {
  const observation = particleTextureObservation(result, frame, time, width, height);
  if (observation === undefined) return undefined;
  const output = result !== undefined && typeof result.output === "object" && result.output !== null
    ? result.output as Record<string, unknown> : {};
  return Object.freeze({ ...observation, detail: output.primitive === "streak" ? 1 : 0 });
}

export function selectParticleSnowRainKeyframes(observations: readonly ObservableFrameObservation[]): readonly SelectedObservableFrame[] {
  const ordered = [...observations].sort((a, b) => a.frame - b.frame);
  const coverage = maximumBy(ordered, (item) => item.coverage);
  const wind = maximumBy(ordered, (item) => Math.abs(item.directionX));
  const speed = maximumBy(ordered, (item) => item.speed);
  const picked = orderedUnique([ordered[0]], [coverage], [wind], [speed], [ordered.at(-1)]);
  const roles = new Map<number, string>();
  if (ordered[0]) assignRole(roles, ordered[0].frame, "降水开始");
  if (coverage) assignRole(roles, coverage.frame, "分布最充分");
  if (wind) assignRole(roles, wind.frame, "风向表现");
  if (speed) assignRole(roles, speed.frame, "下落运动代表");
  if (ordered.at(-1)) assignRole(roles, ordered.at(-1)!.frame, "持续降水");
  return selectedFrames(picked, roles);
}

function summarize(selected: readonly SelectedObservableFrame[], all: readonly ObservableFrameObservation[]) {
  const representative = maximumBy(all, (item) => item.coverage) ?? selected[0]!;
  const mode = representative.detail === 1 ? "雨" : "雪";
  const speed = semanticLevel(representative.speed, 0.15, 0.7, ["缓慢", "自然", "快速"]);
  const wind = Math.abs(representative.directionX) < Math.abs(representative.directionY) * 0.12 ? "近乎垂直"
    : representative.directionX > 0 ? "向右倾斜" : "向左倾斜";
  return {
    description: `最终视频呈现${mode}粒子，数量感${amountFeeling(representative.activity, representative.coverage)}，以${directionLabel(representative.directionX, representative.directionY)}的${speed}节奏持续下落。`,
    keyInformation: [
      { label: "特效类型", value: `${mode}粒子` },
      { label: "粒子数量感", value: amountFeeling(representative.activity, representative.coverage) },
      { label: "分布", value: representative.coverage < 0.35 ? "自然稀疏" : representative.coverage < 0.7 ? "画面分布均衡" : "覆盖较密" },
      { label: "下落方向", value: directionLabel(representative.directionX, representative.directionY) },
      { label: "风向表现", value: wind },
      { label: "下落速度", value: speed }
    ]
  };
}

export const PARTICLE_SNOW_RAIN_SELF_CHECK: ObservableSelfCheckDefinition = Object.freeze({
  toolName: "particle_snow_rain", displayName: "雨雪粒子", ruleFileName: "particle_snow_rain.md",
  capture: captureParticleSnowRainObservation, select: selectParticleSnowRainKeyframes, summarize
});

export async function runParticleSnowRainSelfCheck(request: ObservableSelfCheckRequest) {
  return runObservableSelfCheck(PARTICLE_SNOW_RAIN_SELF_CHECK, request);
}
