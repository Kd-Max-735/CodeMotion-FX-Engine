import {
  runObservedVideoEvidencePipeline,
  distinctFrames,
  extremaFrames,
  level,
  variationRange,
  type ObservedSelfCheckArtifacts,
  type ObservedSelfCheckProfile,
  type ObservedVideoSelfCheckRequest
} from "./observed-video-self-check.js";

interface RequestedPulseStrength {
  readonly actualLevel: "轻微" | "中等" | "明显";
  readonly requestName: string;
}

function requestedPulseStrength(userRequest: string): RequestedPulseStrength | undefined {
  const request = userRequest.replace(/\s+/gu, "");
  if (/(?:脉冲|强度|幅度|力度)[^，。；]{0,8}(?:不要太强|别太强|较弱|偏弱|弱一些|轻微|轻柔|柔和|克制|不明显)/u.test(request)) {
    return Object.freeze({ actualLevel: "轻微", requestName: "较弱" });
  }
  if (/(?:脉冲|强度|幅度|力度)[^，。；]{0,8}(?:中等|适中|不强不弱)/u.test(request)) {
    return Object.freeze({ actualLevel: "中等", requestName: "中等" });
  }
  if (/(?:脉冲|强度|幅度|力度)[^，。；]{0,8}(?:强烈|强劲|明显|很强|更强|偏强|较强)/u.test(request)) {
    return Object.freeze({ actualLevel: "明显", requestName: "明显" });
  }
  return undefined;
}

function profileFor(userRequest: string): ObservedSelfCheckProfile {
  const requestedStrength = requestedPulseStrength(userRequest);
  return {
    toolName: "beat_pulse",
    displayName: "节拍脉冲",
    expectedMotion: true,
    hintFrames: () => Object.freeze([]),
    selectFrames: (frames) => {
      const peaks = extremaFrames(frames, (frame) => frame.brightRatio + frame.saturatedRatio, 3);
      const surrounding = peaks.flatMap((peak) => {
        const index = frames.indexOf(peak);
        return [frames[Math.max(0, index - 1)]!, peak, frames[Math.min(frames.length - 1, index + 1)]!];
      });
      return distinctFrames([frames[0]!, ...surrounding, frames.at(-1)!]);
    },
    evaluate: (frames) => {
      const pulseRange = variationRange(frames, (frame) => frame.brightRatio + frame.saturatedRatio);
      const peaks = extremaFrames(frames, (frame) => frame.brightRatio + frame.saturatedRatio, 8)
        .filter((frame) => frame.differenceFromPrevious > 0.00005);
      const recovery = peaks.some((peak) => {
        const index = frames.indexOf(peak);
        const after = frames[Math.min(frames.length - 1, index + 1)]!;
        return after.brightRatio + after.saturatedRatio < peak.brightRatio + peak.saturatedRatio;
      });
      const strength = level(pulseRange, 0.001, 0.008);
      const pulseVisible = peaks.length > 0 && pulseRange > 0.00005;
      const strengthMatches = requestedStrength === undefined || requestedStrength.actualLevel === strength;
      const passed = pulseVisible && strengthMatches;
      return Object.freeze({
        passed,
        description: `最终视频中观察到 ${peaks.length} 次${strength}节拍脉冲，${recovery ? "峰后有回落" : "峰后回落不明显"}。`,
        verdict: !pulseVisible ? "最终成片未观察到清晰的节拍脉冲变化。"
          : strengthMatches ? "最终成片像素中存在节拍峰值与相邻回落，脉冲强弱符合用户要求。"
            : `用户要求脉冲强度${requestedStrength?.requestName ?? "符合指定等级"}，最终成片实际为${strength}。`,
        keyInformation: Object.freeze([
          Object.freeze({ label: "实际响应", value: peaks.length > 0 ? `观察到 ${peaks.length} 次可见脉冲` : "未观察到可见脉冲" }),
          ...(requestedStrength === undefined ? [] : [Object.freeze({ label: "用户要求强弱", value: requestedStrength.requestName })]),
          Object.freeze({ label: "实际脉冲强弱", value: strength }),
          ...(requestedStrength === undefined ? [] : [Object.freeze({
            label: "强弱要求匹配",
            value: strengthMatches ? "与用户要求一致" : `不一致：要求${requestedStrength.requestName}，实际为${strength}`
          })]),
          Object.freeze({ label: "峰后表现", value: recovery ? "回落后再响应" : "回落不明显" })
        ]),
        observedFacts: Object.freeze({
          visible_pulse_count: peaks.length,
          pulse_peak_level: strength,
          strength_matches_request: strengthMatches,
          recovery_between_pulses: recovery,
          observed_response: peaks.length > 0 ? "成片出现可见峰值响应" : "成片未出现可见峰值响应"
        }),
        issues: passed ? Object.freeze([]) : Object.freeze([
          ...(!pulseVisible ? ["节拍峰值没有在最终视频中形成清晰可见的脉冲。"] : []),
          ...(!strengthMatches ? [`用户要求脉冲强度${requestedStrength?.requestName ?? "符合指定等级"}，成片实际为${strength}。`] : [])
        ])
      });
    }
  };
}

export async function runBeatPulseSelfCheck(request: ObservedVideoSelfCheckRequest): Promise<ObservedSelfCheckArtifacts> {
  return runObservedVideoEvidencePipeline(profileFor(request.userRequest), request);
}
