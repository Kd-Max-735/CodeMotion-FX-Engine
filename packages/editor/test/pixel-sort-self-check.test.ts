import { describe, expect, it } from "vitest";
import { pixelSortSamplingPlan, runPixelSortSelfCheck } from "../src/pixel-sort-self-check.js";
import { selfCheckFixture } from "./self-check-test-helpers.js";

describe("pixel_sort dedicated self-check", () => {
  it("observes sorted streaks across early, middle and late frames", async () => {
    const request = await selfCheckFixture("pixel_sort", { direction: "vertical" });
    expect(pixelSortSamplingPlan(request)).toHaveLength(3);
    const artifacts = await runPixelSortSelfCheck(request);
    expect(artifacts.json.summary.description).toMatch(/像素|条带/u);
    expect(artifacts.json.metadata.effect_observation).toMatchObject({ completion: "全段状态已取证" });
    expect(artifacts.json.metadata.keyframe_evidence.keyframes.map((item) => item.role))
      .toEqual(["前段排序", "中段排序", "后段排序"]);
  });
});
