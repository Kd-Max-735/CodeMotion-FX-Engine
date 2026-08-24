import {
  runObservedVideoEvidencePipeline,
  distinctFrames,
  finite,
  level,
  publicText,
  temporalHints,
  variationRange,
  type ObservedSelfCheckArtifacts,
  type ObservedSelfCheckProfile,
  type ObservedVideoSelfCheckRequest
} from "./observed-video-self-check.js";

function formatted(value: number, format: string): string {
  if (format === "decimal_1") return value.toFixed(1);
  if (format === "decimal_2") return value.toFixed(2);
  if (format === "percent") return `${value.toFixed(0)}%`;
  return String(Math.round(value));
}

const profile: ObservedSelfCheckProfile = {
  toolName: "number_counter",
  displayName: "数值滚动",
  expectedMotion: true,
  hintFrames: (request) => {
    const duration = Math.max(0.1, finite(request.effectParams?.duration, request.durationSeconds));
    const span = Math.abs(finite(request.effectParams?.toValue, 100) - finite(request.effectParams?.fromValue));
    const milestoneCount = Math.max(3, Math.min(7, 3 + Math.ceil(Math.log10(span + 1))));
    return temporalHints(request, Array.from({ length: milestoneCount }, (_, index) => ({
      time: Math.min(request.durationSeconds, duration * index / Math.max(1, milestoneCount - 1)),
      role: index === 0 ? "起始数值" : index === milestoneCount - 1 ? "终点数值" : `第 ${index} 个可见数值阶段`
    })));
  },
  selectFrames: (frames) => distinctFrames(frames.filter((frame) => frame.role !== "变化扫描")),
  evaluate: (frames, selected, params) => {
    const startNumber = finite(params.fromValue);
    const endNumber = finite(params.toValue, 100);
    const format = publicText(params.format, "integer");
    const start = formatted(startNumber, format);
    const end = formatted(endNumber, format);
    const changes = frames.slice(1).map((frame) => frame.differenceFromPrevious);
    const middle = changes.length < 2 ? "均匀" : changes[0]! > changes.at(-1)! * 1.25 ? "前快后慢"
      : changes.at(-1)! > changes[0]! * 1.25 ? "前慢后快" : "较均匀";
    const range = variationRange(frames, (frame) => frame.differenceFromFirst);
    const passed = range > 0.00005 && selected.at(-1)!.nonDarkRatio > 0.001;
    const direction = endNumber > startNumber ? "递增" : endNumber < startNumber ? "递减" : "保持";
    return Object.freeze({
      passed,
      description: `最终视频中数值从 ${start} 按${middle}节奏${direction}到 ${end}，起点、过程与终点均可见。`,
      verdict: passed ? "最终成片实际呈现了可区分的起点、中间阶段和终点。" : "最终成片的数值过程或终点不完整。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "实际可见顺序", value: `${start} → 中间数值 → ${end}` }),
        Object.freeze({ label: "完整性", value: passed ? "起点、过程、终点完整" : "阶段不完整" }),
        Object.freeze({ label: "滚动方向", value: direction }),
        Object.freeze({ label: "可见节奏", value: middle })
      ]),
      observedFacts: Object.freeze({
        visible_sequence: Object.freeze([start, "中间数值", end]),
        start_value: start,
        end_value: end,
        complete: passed,
        counting_direction: direction,
        rhythm: middle,
        start_state: "可见",
        end_state: passed ? "完整停留" : "不完整"
      }),
      issues: passed ? Object.freeze([]) : Object.freeze(["最终视频没有完整显示数值滚动的起点、过程和终点。"])
    });
  }
};

export async function runNumberCounterSelfCheck(request: ObservedVideoSelfCheckRequest): Promise<ObservedSelfCheckArtifacts> {
  return runObservedVideoEvidencePipeline(profile, request);
}
