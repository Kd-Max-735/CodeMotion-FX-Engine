import {
  averageFrameChange,
  frameDifference,
  numericParam,
  runEffectVideoSelfCheck,
  samplingPlanAtTimes,
  stringParam,
  visualStrength,
  type EffectSelfCheckConfig,
  type EffectSelfCheckPlanRequest,
  type EffectSelfCheckRunRequest
} from "./effect-video-self-check.js";

export type PageTurnSelfCheckParams = Readonly<Record<string, unknown>>;

export function pageTurnSamplingPlan(request: EffectSelfCheckPlanRequest<PageTurnSelfCheckParams>) {
  const duration = numericParam(request.params, "duration", request.durationSeconds);
  return samplingPlanAtTimes(request.durationSeconds, request.fps, [
    { evidenceId: "before_page_turn", role: "before_page_turn", label: "翻页前", time: 0 },
    { evidenceId: "page_lift", role: "page_lift", label: "页面抬起", time: duration * 0.14 },
    { evidenceId: "page_curl", role: "page_curl", label: "卷曲形成", time: duration * 0.36 },
    { evidenceId: "page_middle", role: "page_middle", label: "翻页中段", time: duration * 0.58 },
    { evidenceId: "page_settle", role: "page_settle", label: "页面落下", time: duration * 0.84 },
    { evidenceId: "page_complete", role: "page_complete", label: "转场完成", time: duration + 0.05 }
  ]);
}

const PAGE_TURN_SELF_CHECK = Object.freeze<EffectSelfCheckConfig<PageTurnSelfCheckParams>>({
  toolName: "page_turn",
  displayName: "翻页转场",
  samplingPlan: pageTurnSamplingPlan,
  describe: (request, observations, technicalIntegrity) => {
    const direction = stringParam(request.params, "direction", "left") === "right" ? "向右" : "向左";
    const visibility = visualStrength(averageFrameChange(observations));
    const before = observations.find((item) => item.role === "before_page_turn");
    const completed = observations.find((item) => item.role === "page_complete");
    const complete = completed !== undefined
      && numericParam(request.params, "duration", request.durationSeconds) <= request.durationSeconds
      && frameDifference(before, completed) > 0.01;
    return Object.freeze({
      effectPassed: complete && observations.length >= 5,
      description: technicalIntegrity
        ? `页面${direction}抬起并形成${visibility}的卷曲和空间翻转，经过中段后落下，${complete ? "后续画面完整接替" : "完成状态尚未确认"}。`
        : "卷曲、阴影和透视变化属于翻页过程；当前返修仅由视频解码或关键帧读取异常触发。",
      keyInformation: Object.freeze([
        Object.freeze({ label: "翻页方向", value: direction }),
        Object.freeze({ label: "翻页过程", value: observations.length >= 5 ? "抬起、卷曲、中段、落下均有证据" : "过程证据不足" }),
        Object.freeze({ label: "完成状态", value: complete ? "页面已翻完" : "未能确认" })
      ]),
      observation: Object.freeze({
        page_direction: direction,
        curl_visibility: visibility,
        progress_coverage: observations.length >= 5 ? "完整" : "不完整",
        completion: complete ? "完成" : "未确认"
      })
    });
  }
});

export function runPageTurnSelfCheck(request: EffectSelfCheckRunRequest<PageTurnSelfCheckParams>) {
  return runEffectVideoSelfCheck(PAGE_TURN_SELF_CHECK, request);
}
