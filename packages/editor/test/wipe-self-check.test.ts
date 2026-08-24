import { describe, expect, it } from "vitest";
import { runWipeSelfCheck, wipeSamplingPlan } from "../src/wipe-self-check.js";
import { selfCheckFixture } from "./self-check-test-helpers.js";

describe("wipe dedicated self-check", () => {
  it("checks direction at quarter, middle, three-quarter and complete stages", async () => {
    const request = await selfCheckFixture("wipe", {
      duration: 2,
      direction: "left_bottom_to_right_top"
    }, { durationSeconds: 4 });
    expect(wipeSamplingPlan(request).map((item) => item.role)).toEqual([
      "before_wipe", "wipe_quarter", "wipe_middle", "wipe_three_quarters", "wipe_complete"
    ]);
    const artifacts = await runWipeSelfCheck(request);
    expect(artifacts.json.summary.description).toMatch(/从左下向右上持续推进/u);
    expect(artifacts.json.metadata.effect_observation).toMatchObject({
      wipe_direction: "从左下向右上",
      completion: "完成"
    });
  });
});
