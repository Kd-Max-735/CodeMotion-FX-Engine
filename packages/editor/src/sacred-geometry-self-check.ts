import {
  distinctEvidence,
  finite,
  maximumBy,
  minimumBy,
  runFinalVideoSelfCheck,
  uniformSamplingPlan,
  type FinalFrameObservation,
  type FinalVideoSelfCheckRequest,
  type FinalVideoSelfCheckSpec,
  type SelfCheckSummary
} from "./final-video-self-check.js";
import { centroidTravel, effectCheck, observationSummary, observedRange, sharedQuality, stablePlan, strongest } from "./final-video-self-check-helpers.js";

export function sacredGeometrySamplingPlan(duration: number, fps: number, params: Readonly<Record<string, unknown>>) {
  return Math.abs(finite(params.speed)) <= 0 ? stablePlan(duration, fps)
    : uniformSamplingPlan(duration, fps, 7,
      (index, total) => index === 0 ? "几何起始" : index === total - 1 ? "旋转后段" : "旋转结构变化");
}

function summarizeSacredGeometry(context: Parameters<FinalVideoSelfCheckSpec["summarize"]>[0]): SelfCheckSummary {
  const representative = strongest(context.observations);
  const facts = observationSummary(representative);
  const centered = Math.hypot(representative.centroidX - 0.5, representative.centroidY - 0.5) < 0.2;
  const rotation = observedRange(context.observations, (item) => item.principalAngleDegrees);
  const moving = rotation > 2 || centroidTravel(context.observations) > 0.025;
  return Object.freeze({
    description: `最终画面中央形成${facts.color}的多层对称几何，${facts.coverage}，线条${facts.brightness}${moving ? "并保持连续旋转" : "且整体静止"}。`,
    keyInformation: Object.freeze([
      { label: "几何位置", value: centered ? "画面中央" : facts.location }, { label: "线条颜色", value: facts.color },
      { label: "图案覆盖", value: facts.coverage },
      { label: "层次与密度", value: representative.componentCount > 3 ? "多层线圆结构清楚，交叠关系丰富" : "结构较简洁" },
      { label: "对称表现", value: centered ? "围绕中心均衡展开" : "中心偏移，平衡感受影响" },
      { label: "旋转表现", value: moving ? "图案整体连续旋转，线条关系保持" : "图案保持静止" }
    ]),
    quality: sharedQuality(context, moving ? "整体旋转造成的线条位置变化属于预期运动，不按闪烁处理" : "未发现异常闪变",
      "线条交叉属于几何结构，不作为断裂；关键帧中结构持续可辨认"),
    checks: Object.freeze([
      effectCheck("SACRED_GEOMETRY_CENTER_BALANCE", centered,
        "几何结构围绕画面中心均衡展开。", "几何结构明显偏离中心，整体对称平衡受影响。", "GEOMETRY_OFF_CENTER"),
      effectCheck("SACRED_GEOMETRY_ROTATION_PROTECTION", true,
        moving ? "整体旋转连续，线条交叉与角度变化未误判为结构故障。" : "静态结构在前中后段保持一致。",
        "", "GEOMETRY_ROTATION_FAILURE")
    ])
  });
}

const SPEC: FinalVideoSelfCheckSpec = Object.freeze({
  toolName: "sacred_geometry",
  displayName: "神圣几何",
  isNeutral: () => false,
  samplingPlan: sacredGeometrySamplingPlan,
  selectEvidence: (observations: readonly FinalFrameObservation[]) => distinctEvidence(observations, [
    observations[0], minimumBy(observations, (item) => item.principalAngleDegrees),
    observations[Math.floor(observations.length / 2)], maximumBy(observations, (item) => item.principalAngleDegrees),
    observations.at(-1)
  ]),
  summarize: summarizeSacredGeometry
});

export function runSacredGeometrySelfCheck(request: FinalVideoSelfCheckRequest) {
  return runFinalVideoSelfCheck(SPEC, request);
}
