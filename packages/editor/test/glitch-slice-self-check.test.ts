import { describe, expect, it } from "vitest";
import { glitchSliceSamplingPlan, runGlitchSliceSelfCheck } from "../src/glitch-slice-self-check.js";
import { selfCheckFixture } from "./self-check-test-helpers.js";

describe("glitch_slice dedicated self-check", () => {
  it("uses slice-specific onset, structure, variation and late evidence", async () => {
    const request = await selfCheckFixture("glitch_slice", { direction: "horizontal" });
    expect(glitchSliceSamplingPlan(request).map((item) => item.role)).toEqual([
      "slice_onset", "slice_pattern", "slice_variation", "slice_late"
    ]);
    const artifacts = await runGlitchSliceSelfCheck(request);
    expect(artifacts.json.summary.description).toMatch(/切片错位|故障切片/u);
    expect(artifacts.json.metadata.effect_observation).toHaveProperty("slice_direction");
    expect(artifacts.json.metadata.quality.full_decode_passed).toBe(true);
    expect(artifacts.json.metadata.keyframe_evidence.image_count).toBe(4);
  });
});
