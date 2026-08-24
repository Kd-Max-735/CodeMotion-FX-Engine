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
  type DedicatedSelfCheckRequest
} from "./dedicated-effect-self-check-common.js";

export const CHARACTER_CASCADE_RULE_IDS = Object.freeze([
  "CC_MEDIA_INTEGRITY",
  "CC_TEXT_VISIBILITY",
  "CC_CASCADE_SEQUENCE",
  "CC_TEXT_COMPLETENESS",
  "CC_POSITION_SAFETY",
  "CC_USER_INTENT"
] as const);

function unitCount(params: Readonly<Record<string, unknown>>): number {
  const text = typeof params.text === "string" ? params.text : "";
  if (params.selector === "word") return Math.max(1, text.trim().split(/\s+/u).filter(Boolean).length);
  if (params.selector === "line" || params.selector === "paragraph") return Math.max(1, text.split(/\r?\n/u).length);
  return Math.max(1, [...text].length);
}

const PROFILE = Object.freeze<DedicatedSelfCheckProfile>({
  toolName: "character_cascade",
  displayName: "字符级联",
  ruleIds: CHARACTER_CASCADE_RULE_IDS,
  roleLabels: Object.freeze({
    cascade_start: "级联开始帧",
    character_arrival: "字符到达帧",
    cascade_middle: "级联中段",
    text_complete: "文字完成帧",
    completion_hold: "文字保持帧"
  }),
  candidates: ({ durationSeconds, fps, params }) => {
    const units = Math.min(18, unitCount(params));
    const stagger = Math.max(0, finite(params.stagger));
    const expectedEnd = Math.min(durationSeconds * 0.9, Math.max(durationSeconds * 0.25, stagger * Math.max(1, units - 1) + 0.8));
    const count = Math.max(5, Math.min(12, units + 3));
    return makeSamplingCandidates(durationSeconds, fps, Array.from({ length: count }, (_, index) => ({
      role: index === 0 ? "cascade_start" : index === count - 2 ? "text_complete"
        : index === count - 1 ? "completion_hold" : index === Math.floor(count / 2) ? "cascade_middle" : "character_arrival",
      time: index === count - 1 ? durationSeconds * 0.96 : expectedEnd * index / Math.max(1, count - 2)
    })));
  },
  analyze: (context) => {
    const selectedSamples = selectEvidenceByActualChange(context.samples, context.width, context.height,
      { minimum: 3, maximum: 7, changeFloor: 1.1 });
    const first = context.samples[0]!;
    const last = context.samples.at(-1)!;
    const background = context.references.source_image;
    const basis = background?.length === last.pixels.length ? background : first.pixels;
    const textChange = frameDifference(basis, last.pixels, context.width, context.height, 18);
    const beforeHold = context.samples.at(-2) ?? first;
    const holdDifference = frameDifference(beforeHold.pixels, last.pixels, context.width, context.height).meanRgbDifference;
    const temporal = temporalChange(context.samples, context.width, context.height);
    const completeness = textChange.changedPixelRatio < 0.0004 ? "完成帧未观察到清晰文字覆盖"
      : holdDifference < 1.4 ? "文字完整呈现并保持" : "收尾时文字仍在级联变化";
    const sequence = temporal.state === "stable" ? "抽检范围内文字保持稳定" : "文字单元错时进入并逐步汇合";
    return Object.freeze({
      description: `最终视频呈现字符级联，${sequence}，${completeness}。`,
      keyInformation: Object.freeze([
        Object.freeze({ label: "特效类型", value: "字符级联" }),
        Object.freeze({ label: "文字显现范围", value: `${changeRegion(textChange.bounds)}，约占画面 ${percent(textChange.changedPixelRatio)}` }),
        Object.freeze({ label: "级联过程", value: sequence }),
        Object.freeze({ label: "文字完整性", value: completeness }),
        Object.freeze({ label: "文字边界", value: last.stats.edgePixelRatio < 0.015 ? "文字边缘偏弱" : "文字轮廓清晰可辨" }),
        Object.freeze({ label: "完成保持", value: holdDifference < 1.4 ? "稳定" : "仍有变化" })
      ]),
      missingInformation: Object.freeze(textChange.changedPixelRatio < 0.0004 ? ["清晰文字覆盖"] : []),
      selectedSamples,
      expectsVisibleMotion: finite(context.params.stagger) > 0,
      visibleMotionFloor: 1.1
    });
  }
});

export const characterCascadeSamplingPlan = PROFILE.candidates;

export async function runCharacterCascadeSelfCheck(request: DedicatedSelfCheckRequest) {
  return runDedicatedEffectSelfCheck(PROFILE, request);
}
