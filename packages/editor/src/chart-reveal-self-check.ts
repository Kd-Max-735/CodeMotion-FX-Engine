import {
  changeRegion,
  finite,
  frameDifference,
  makeSamplingCandidates,
  percent,
  runDedicatedEffectSelfCheck,
  selectEvidenceByActualChange,
  temporalChange,
  type DedicatedSelfCheckProfile,
  type DedicatedSelfCheckRequest,
  type DedicatedVisualSample
} from "./dedicated-effect-self-check-common.js";

export const CHART_REVEAL_RULE_IDS = Object.freeze([
  "CR_MEDIA_INTEGRITY",
  "CR_CHART_VISIBILITY",
  "CR_REVEAL_ORDER",
  "CR_DATA_GROUP_COMPLETENESS",
  "CR_COMPLETION_HOLD",
  "CR_USER_INTENT"
] as const);

function visibleVerticalGroups(first: DedicatedVisualSample, last: DedicatedVisualSample, width: number, height: number): number {
  const active = new Array<boolean>(width).fill(false);
  for (let x = 0; x < width; x += 1) {
    let changed = 0;
    for (let y = 0; y < height; y += 2) {
      const offset = (y * width + x) * 4;
      const difference = (Math.abs(first.pixels[offset]! - last.pixels[offset]!)
        + Math.abs(first.pixels[offset + 1]! - last.pixels[offset + 1]!)
        + Math.abs(first.pixels[offset + 2]! - last.pixels[offset + 2]!)) / 3;
      if (difference > 24) changed += 1;
    }
    active[x] = changed >= Math.max(2, Math.round(height / 40));
  }
  let groups = 0;
  let inside = false;
  for (const value of active) {
    if (value && !inside) groups += 1;
    inside = value;
  }
  return groups;
}

const PROFILE = Object.freeze<DedicatedSelfCheckProfile>({
  toolName: "chart_reveal",
  displayName: "图表揭示",
  ruleIds: CHART_REVEAL_RULE_IDS,
  roleLabels: Object.freeze({
    chart_start: "图表开始帧",
    data_group_reveal: "数据组显现",
    chart_middle: "图表中段",
    chart_complete: "图表完成帧",
    completion_hold: "完成保持帧"
  }),
  candidates: ({ durationSeconds, fps, params }) => {
    const labels = Array.isArray(params.labels) ? params.labels : [];
    const duration = Math.max(0.05, finite(params.duration, durationSeconds * 0.5));
    const stagger = Math.max(0, finite(params.stagger));
    const total = Math.min(durationSeconds * 0.92, duration + stagger * Math.max(0, labels.length - 1));
    const moments: { role: string; time?: number; fraction?: number }[] = [{ role: "chart_start", time: 0 }];
    const groupCount = Math.max(2, Math.min(12, labels.length || 3));
    for (let index = 0; index < groupCount; index += 1) {
      moments.push({
        role: index === Math.floor(groupCount / 2) ? "chart_middle" : "data_group_reveal",
        time: Math.min(total, stagger * index + duration * 0.55)
      });
    }
    moments.push({ role: "chart_complete", time: total });
    moments.push({ role: "completion_hold", fraction: 0.96 });
    return makeSamplingCandidates(durationSeconds, fps, moments);
  },
  analyze: (context) => {
    const selectedSamples = selectEvidenceByActualChange(context.samples, context.width, context.height,
      { minimum: 3, maximum: 7, changeFloor: 1.8 });
    const first = context.samples[0]!;
    const last = context.samples.at(-1)!;
    const finalChange = frameDifference(first.pixels, last.pixels, context.width, context.height, 22);
    const groups = visibleVerticalGroups(first, last, context.width, context.height);
    const temporal = temporalChange(context.samples, context.width, context.height);
    const beforeHold = context.samples.at(-2) ?? first;
    const holdDifference = frameDifference(beforeHold.pixels, last.pixels, context.width, context.height).meanRgbDifference;
    const holdState = holdDifference < 1.2 ? "完成后保持稳定" : "收尾阶段仍有可见变化";
    const groupText = groups === 0 ? "未分辨出独立数据图形" : `完成帧可见 ${groups} 组主要图形`;
    return Object.freeze({
      description: `最终视频中的图表按时间揭示，${groupText}，${holdState}。`,
      keyInformation: Object.freeze([
        Object.freeze({ label: "特效类型", value: "图表揭示" }),
        Object.freeze({ label: "图表呈现", value: groupText }),
        Object.freeze({ label: "揭示范围", value: `${changeRegion(finalChange.bounds)}，约占画面 ${percent(finalChange.changedPixelRatio)}` }),
        Object.freeze({ label: "揭示过程", value: temporal.state === "stable" ? "图表从抽检起保持不变" : "图形按时间逐步增加" }),
        Object.freeze({ label: "完成状态", value: holdState }),
        Object.freeze({ label: "画面清晰度", value: last.stats.edgePixelRatio < 0.015 ? "图形边界偏弱" : "图形边界清晰可辨" })
      ]),
      missingInformation: Object.freeze(groups === 0 ? ["可见数据组"] : []),
      selectedSamples,
      expectsVisibleMotion: finite(context.params.duration, 0) > 0,
      visibleMotionFloor: 1.8
    });
  }
});

export const chartRevealSamplingPlan = PROFILE.candidates;

export async function runChartRevealSelfCheck(request: DedicatedSelfCheckRequest) {
  return runDedicatedEffectSelfCheck(PROFILE, request);
}
