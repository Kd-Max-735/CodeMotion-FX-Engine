import { describe, expect, it } from "vitest";
import { echoTrailSamplingPlan, runEchoTrailSelfCheck } from "../src/echo-trail-self-check.js";
import { selfCheckFixture } from "./self-check-test-helpers.js";

describe("echo_trail dedicated self-check", () => {
  it("checks trail formation, layering, establishment and late state", async () => {
    const request = await selfCheckFixture("echo_trail", { spacing: 0.12, trailCount: 8 });
    const roles = echoTrailSamplingPlan(request).map((item) => item.role);
    expect(roles).toEqual(["before_echo", "echo_forming", "echo_layering", "echo_established", "echo_late"]);
    const artifacts = await runEchoTrailSelfCheck(request);
    expect(artifacts.json.summary.description).toMatch(/历史帧拖影|重复轮廓/u);
    expect(artifacts.json.metadata.effect_observation).toMatchObject({
      trail_formation: "完成",
      completion: "后段状态已取证"
    });
  });
});
