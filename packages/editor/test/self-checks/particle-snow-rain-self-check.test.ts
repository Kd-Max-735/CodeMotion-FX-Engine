import { describe, expect, it } from "vitest";
import { PARTICLE_SNOW_RAIN_SELF_CHECK, runParticleSnowRainSelfCheck,
  selectParticleSnowRainKeyframes } from "../../src/self-checks/particle-snow-rain-self-check.js";
import { expectNoInternalParticleData, observation, publicSummaryJson } from "./observable-test-helpers.js";

describe("particle_snow_rain independent self-check", () => {
  it("selects distribution, wind and falling-motion evidence", () => {
    const all = [observation(0, { detail: 1, coverage: 0.2 }),
      observation(4, { detail: 1, coverage: 0.75, directionX: -0.25, directionY: 0.7 }),
      observation(7, { detail: 1, speed: 0.9, directionY: 0.8 }), observation(9, { detail: 1 })];
    const selected = selectParticleSnowRainKeyframes(all);
    const roles = selected.map((item) => item.role).join(" / ");
    for (const role of ["分布最充分", "风向表现", "下落运动代表"]) expect(roles).toContain(role);
    expect(typeof runParticleSnowRainSelfCheck).toBe("function");
  });

  it("distinguishes rain and describes density without particle details", () => {
    const all = [observation(0, { detail: 1 }), observation(5, { detail: 1, coverage: 0.8, activity: 600 }), observation(9, { detail: 1 })];
    const summary = PARTICLE_SNOW_RAIN_SELF_CHECK.summarize(selectParticleSnowRainKeyframes(all), all);
    expect(summary.keyInformation[0]).toEqual({ label: "特效类型", value: "雨粒子" });
    expectNoInternalParticleData(publicSummaryJson(summary));
  });
});
