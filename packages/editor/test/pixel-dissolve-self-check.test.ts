import { describe, expect, it } from "vitest";
import { pixelDissolveSamplingPlan, runPixelDissolveSelfCheck } from "../src/pixel-dissolve-self-check.js";
import { selfCheckFixture } from "./self-check-test-helpers.js";

describe("pixel_dissolve dedicated self-check", () => {
  it("covers pixel replacement progress and the completed state", async () => {
    const request = await selfCheckFixture("pixel_dissolve", { duration: 2 }, { durationSeconds: 4 });
    const roles = pixelDissolveSamplingPlan(request).map((item) => item.role);
    expect(roles).toContain("dissolve_middle");
    expect(roles).toContain("dissolve_complete");
    expect(roles).toContain("after_dissolve");
    const artifacts = await runPixelDissolveSelfCheck(request);
    expect(artifacts.json.summary.description).toMatch(/像素块替换/u);
    expect(artifacts.json.metadata.effect_observation).toMatchObject({ completion: "完成" });
    expect(artifacts.json.metadata.keyframe_evidence.coverage).toBe("sufficient");
  });
});
