import { describe, expect, it } from "vitest";
import { portalSamplingPlan, runPortalSelfCheck } from "../src/portal-self-check.js";
import { selfCheckFixture } from "./self-check-test-helpers.js";

describe("portal dedicated self-check", () => {
  it("checks aperture opening, expansion, coverage and completed replacement", async () => {
    const request = await selfCheckFixture("portal", { duration: 1.2 }, { durationSeconds: 3 });
    expect(portalSamplingPlan(request).map((item) => item.role)).toEqual([
      "before_portal", "portal_opening", "portal_middle", "portal_covering", "portal_complete"
    ]);
    const artifacts = await runPortalSelfCheck(request);
    expect(artifacts.json.summary.description).toMatch(/传送门|门洞/u);
    expect(artifacts.json.metadata.effect_observation).toMatchObject({ completion: "完成" });
  });
});
