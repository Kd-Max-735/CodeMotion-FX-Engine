import { describe, expect, it } from "vitest";
import {
  runVideoFreezeFrameSelfCheck,
  videoFreezeFrameSamplingPlan
} from "../src/video-freeze-frame-self-check.js";
import { selfCheckFixture } from "./self-check-test-helpers.js";

describe("video_freeze_frame dedicated self-check", () => {
  it("proves the frozen interval and separately checks resumed motion", async () => {
    const request = await selfCheckFixture("video_freeze_frame", {
      freezeAt: 1,
      freezeDuration: 1
    }, { durationSeconds: 4, freezeWindow: [1, 2] });
    const roles = videoFreezeFrameSamplingPlan(request).map((item) => item.role);
    expect(roles).toEqual([
      "before_freeze", "freeze_start", "freeze_middle", "freeze_end", "motion_resume", "after_resume"
    ]);
    const artifacts = await runVideoFreezeFrameSelfCheck(request);
    expect(artifacts.json.summary.description).toMatch(/定格开始至结束前保持一致/u);
    expect(artifacts.json.metadata.effect_observation).toMatchObject({
      freeze_interval_stable: true,
      motion_after_freeze: "已取证",
      completion: "完成"
    });
  });
});
