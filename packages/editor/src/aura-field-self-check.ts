import {
  distinctEvidence,
  finite,
  maximumBy,
  minimumBy,
  runFinalVideoSelfCheck,
  speedName,
  uniformSamplingPlan,
  type FinalFrameObservation,
  type FinalVideoSelfCheckRequest,
  type FinalVideoSelfCheckSpec,
  type SelfCheckSummary
} from "./final-video-self-check.js";
import {
  centroidTravel,
  clampCount,
  effectCheck,
  farthestFrom,
  observationSummary,
  observedRange,
  sharedQuality,
  stablePlan
} from "./final-video-self-check-helpers.js";

interface RequestedAuraLocation {
  readonly actualName: string;
  readonly requestName: string;
}

function requestedAuraLocation(userRequest: string): RequestedAuraLocation | undefined {
  const request = userRequest.replace(/\s+/gu, "");
  const locations: readonly Readonly<{
    pattern: RegExp;
    actualName: string;
    requestName: string;
  }>[] = [
    { pattern: /右上(?:角|方|部)?|右侧上(?:方|部)|上方右侧/u, actualName: "右侧上部", requestName: "右上角" },
    { pattern: /左上(?:角|方|部)?|左侧上(?:方|部)|上方左侧/u, actualName: "左侧上部", requestName: "左上角" },
    { pattern: /右下(?:角|方|部)?|右侧下(?:方|部)|下方右侧/u, actualName: "右侧下部", requestName: "右下角" },
    { pattern: /左下(?:角|方|部)?|左侧下(?:方|部)|下方左侧/u, actualName: "左侧下部", requestName: "左下角" },
    { pattern: /(?:位于|放在|处于|位置(?:在|为)|集中在|设在)(?:画面)?(?:中央|中心|正中)/u,
      actualName: "中央中部", requestName: "画面中央" },
    { pattern: /(?:位于|放在|处于|位置(?:在|为)|集中在|设在)(?:画面)?(?:上方|顶部|上部)/u,
      actualName: "中央上部", requestName: "画面上方" },
    { pattern: /(?:位于|放在|处于|位置(?:在|为)|集中在|设在)(?:画面)?(?:下方|底部|下部)/u,
      actualName: "中央下部", requestName: "画面下方" },
    { pattern: /(?:位于|放在|处于|位置(?:在|为)|集中在|设在)(?:画面)?(?:左侧|左边)/u,
      actualName: "左侧中部", requestName: "画面左侧" },
    { pattern: /(?:位于|放在|处于|位置(?:在|为)|集中在|设在)(?:画面)?(?:右侧|右边)/u,
      actualName: "右侧中部", requestName: "画面右侧" }
  ];
  const matched = locations.find((location) => location.pattern.test(request));
  return matched === undefined
    ? undefined
    : Object.freeze({ actualName: matched.actualName, requestName: matched.requestName });
}

export function auraFieldSamplingPlan(duration: number, fps: number, params: Readonly<Record<string, unknown>>) {
  return finite(params.pulseRate) <= 0 ? stablePlan(duration, fps)
    : uniformSamplingPlan(duration, fps, clampCount(duration * Math.abs(finite(params.pulseRate)) * 4 + 3, 7, 19),
      (index, total) => index === 0 ? "呼吸开始" : index === total - 1 ? "循环后段" : "呼吸变化探针");
}

function summarizeAuraField(context: Parameters<FinalVideoSelfCheckSpec["summarize"]>[0]): SelfCheckSummary {
  const peak = maximumBy(context.observations, (item) => item.brightnessGain) ?? context.observations[0]!;
  const facts = observationSummary(peak);
  const travel = centroidTravel(context.observations);
  const elapsed = Math.max(0.001, context.observations.at(-1)!.item.time - context.observations[0]!.item.time);
  const breathing = observedRange(context.observations, (item) => item.brightnessGain);
  const dynamic = breathing > 0.008 || travel > 0.04;
  const visible = peak.colorDifference >= 0.0035;
  const coherentField = peak.changedAreaRatio >= 0.035 && peak.componentCount <= 12;
  const requestedLocation = requestedAuraLocation(context.request.userRequest);
  const locationMatches = requestedLocation === undefined || requestedLocation.actualName === facts.location;
  return Object.freeze({
    description: `成片在${facts.location}形成${facts.brightness}的${facts.color}氛围光，${facts.coverage}，${dynamic ? "可见连贯的呼吸与轻微漂移" : "整体保持稳定"}。`,
    keyInformation: Object.freeze([
      { label: "实际亮度", value: facts.brightness },
      { label: "主要颜色", value: facts.color },
      ...(requestedLocation === undefined ? [] : [{ label: "用户要求位置", value: requestedLocation.requestName }]),
      { label: "实际光场位置", value: facts.location },
      ...(requestedLocation === undefined ? [] : [{
        label: "位置要求匹配",
        value: locationMatches ? "与用户要求一致" : `不一致：要求${requestedLocation.requestName}，实际为${facts.location}`
      }]),
      { label: "覆盖范围", value: facts.coverage },
      { label: "呼吸表现", value: dynamic ? "亮度起伏平滑，光场中心有轻微连续漂移" : "亮度和中心位置稳定" },
      { label: "运动速度", value: speedName(travel, elapsed) }
    ]),
    quality: sharedQuality(context, dynamic ? "呼吸和漂移属于连续光场表现，未按闪烁故障处理" : "未发现异常闪变",
      coherentField || !visible ? "光场连续" : "光场出现不自然碎裂"),
    checks: Object.freeze([
      effectCheck("AURA_FIELD_SPATIAL_COHERENCE", !visible || coherentField,
        "氛围光形成连续光场，中心与覆盖范围可辨认。", "氛围光呈现为零散亮块，未形成连续光场。", "AURA_FIELD_FRAGMENTED"),
      effectCheck("AURA_FIELD_REQUESTED_LOCATION", locationMatches,
        requestedLocation === undefined ? "用户未明确指定光场位置，不增加位置限制。" : `实际光场位于${facts.location}，符合用户要求。`,
        `用户要求光场位于${requestedLocation?.requestName ?? "指定位置"}，最终成片实际位于${facts.location}。`,
        "AURA_FIELD_LOCATION_MISMATCH"),
      effectCheck("AURA_FIELD_TEMPORAL_BEHAVIOR", true,
        dynamic ? "实际呼吸和中心漂移连续，未误判为故障闪烁。" : "静态光场在前中后段保持稳定。",
        "", "AURA_FIELD_TEMPORAL_FAILURE")
    ])
  });
}

const SPEC: FinalVideoSelfCheckSpec = Object.freeze({
  toolName: "aura_field",
  displayName: "氛围光场",
  isNeutral: (params: Readonly<Record<string, unknown>>) => finite(params.intensity) <= 0,
  samplingPlan: auraFieldSamplingPlan,
  selectEvidence: (observations: readonly FinalFrameObservation[]) => distinctEvidence(observations, [
    observations[0], minimumBy(observations, (item) => item.brightnessGain),
    maximumBy(observations, (item) => item.brightnessGain), farthestFrom(observations, observations[0]),
    observations.at(-1)
  ]),
  summarize: summarizeAuraField
});

export function runAuraFieldSelfCheck(request: FinalVideoSelfCheckRequest) {
  return runFinalVideoSelfCheck(SPEC, request);
}
