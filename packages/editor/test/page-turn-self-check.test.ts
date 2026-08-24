import { describe, expect, it } from "vitest";
import { pageTurnSamplingPlan, runPageTurnSelfCheck } from "../src/page-turn-self-check.js";
import { selfCheckFixture } from "./self-check-test-helpers.js";

describe("page_turn dedicated self-check", () => {
  it("checks lift, curl, middle, settle and completed page replacement", async () => {
    const request = await selfCheckFixture("page_turn", { duration: 1.4, direction: "right" }, { durationSeconds: 3 });
    expect(pageTurnSamplingPlan(request).map((item) => item.role)).toEqual([
      "before_page_turn", "page_lift", "page_curl", "page_middle", "page_settle", "page_complete"
    ]);
    const artifacts = await runPageTurnSelfCheck(request);
    expect(artifacts.json.summary.description).toMatch(/向右抬起|卷曲/u);
    expect(artifacts.json.metadata.effect_observation).toMatchObject({
      page_direction: "向右",
      completion: "完成"
    });
  });
});
