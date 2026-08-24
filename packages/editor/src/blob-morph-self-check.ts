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

export const BLOB_MORPH_RULE_IDS = Object.freeze([
  "BM_MEDIA_INTEGRITY",
  "BM_SHAPE_PRESENCE",
  "BM_ORGANIC_DEFORMATION",
  "BM_CONTOUR_CONTINUITY",
  "BM_FRAME_SAFETY",
  "BM_USER_INTENT"
] as const);

const PROFILE = Object.freeze<DedicatedSelfCheckProfile>({
  toolName: "blob_morph",
  displayName: "有机液态形状变形",
  ruleIds: BLOB_MORPH_RULE_IDS,
  roleLabels: Object.freeze({
    shape_start: "初始形态",
    contour_change: "轮廓变化",
    deformation_peak: "显著变形",
    recovery_shape: "形态回转",
    shape_end: "结束形态",
    static_shape: "稳定形态"
  }),
  candidates: ({ durationSeconds, fps, params }) => {
    const speed = Math.abs(finite(params.speed));
    const count = speed <= Number.EPSILON ? 3 : Math.max(6, Math.min(12, Math.ceil(durationSeconds * speed * 1.5) + 4));
    return makeSamplingCandidates(durationSeconds, fps, Array.from({ length: count }, (_, index) => ({
      role: speed <= Number.EPSILON ? "static_shape"
        : index === 0 ? "shape_start" : index === count - 1 ? "shape_end"
          : index % 3 === 1 ? "contour_change" : index % 3 === 2 ? "deformation_peak" : "recovery_shape",
      fraction: count <= 1 ? 0.5 : 0.04 + index / (count - 1) * 0.92
    })));
  },
  analyze: (context) => {
    const selectedSamples = selectEvidenceByActualChange(context.samples, context.width, context.height,
      { minimum: 3, maximum: 7, changeFloor: 0.75 });
    const first = context.samples[0]!;
    const last = context.samples.at(-1)!;
    const change = frameDifference(first.pixels, last.pixels, context.width, context.height, 20);
    const temporal = temporalChange(context.samples, context.width, context.height);
    const deformation = temporal.maximumDifference < 1 ? "形态基本稳定"
      : temporal.maximumDifference < 6 ? "轮廓轻柔流动" : "轮廓有明显液态变形";
    const edge = context.samples.reduce((sum, sample) => sum + sample.stats.edgePixelRatio, 0) / context.samples.length;
    const contour = edge < 0.02 ? "轮廓较简洁" : edge < 0.1 ? "轮廓连续清晰" : "轮廓细节丰富";
    const touchesEdge = change.bounds !== undefined && (change.bounds.left <= 0.01 || change.bounds.top <= 0.01
      || change.bounds.right >= 0.99 || change.bounds.bottom >= 0.99);
    return Object.freeze({
      description: `最终视频中的有机形状${deformation}，变化集中在${changeRegion(change.bounds)}，${contour}。`,
      keyInformation: Object.freeze([
        Object.freeze({ label: "特效类型", value: "有机液态形状变形" }),
        Object.freeze({ label: "形态变化", value: deformation }),
        Object.freeze({ label: "变化范围", value: `${changeRegion(change.bounds)}，约占画面 ${percent(change.changedPixelRatio)}` }),
        Object.freeze({ label: "轮廓表现", value: contour }),
        Object.freeze({ label: "运动状态", value: temporal.state === "stable" ? "保持稳定" : "连续流动" }),
        Object.freeze({ label: "边缘安全", value: touchesEdge ? "变化触及画面边缘" : "主要形态未触及画面边缘" })
      ]),
      missingInformation: Object.freeze([]),
      selectedSamples,
      expectsVisibleMotion: Math.abs(finite(context.params.speed)) > Number.EPSILON,
      visibleMotionFloor: 0.75
    });
  }
});

export const blobMorphSamplingPlan = PROFILE.candidates;

export async function runBlobMorphSelfCheck(request: DedicatedSelfCheckRequest) {
  return runDedicatedEffectSelfCheck(PROFILE, request);
}
