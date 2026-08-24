import { describe, expect, it } from "vitest";
import { PARTICLE_TRAIL_SELF_CHECK, runParticleTrailSelfCheck,
  selectParticleTrailKeyframes } from "../../src/self-checks/particle-trail-self-check.js";
import { expectNoInternalParticleData, observation, publicSummaryJson } from "./observable-test-helpers.js";

describe("particle_trail independent self-check", () => {
  it("selects generation, maximum extent, curvature and decay evidence", () => {
    const all = [observation(0, { activity: 0, spread: 0 }), observation(2, { activity: 20, spread: 0.1 }),
      observation(5, { activity: 100, spread: 0.55, angularMotion: 0.2 }),
      observation(7, { activity: 60, spread: 0.4, angularMotion: 1.1 }), observation(9, { activity: 5, spread: 0.15 })];
    const selected = selectParticleTrailKeyframes(all);
    const roles = selected.map((item) => item.role).join(" / ");
    for (const role of ["拖尾生成", "拖尾延展最明显", "轨迹弯曲代表", "最终尾迹"]) expect(roles).toContain(role);
    expect(typeof runParticleTrailSelfCheck).toBe("function");
  });

  it("reports trail length, path shape and fading without trajectory internals", () => {
    const all = [observation(0, { activity: 0 }), observation(5, { activity: 120, spread: 0.6, angularMotion: 0.8 }), observation(9, { activity: 10 })];
    const summary = PARTICLE_TRAIL_SELF_CHECK.summarize(selectParticleTrailKeyframes(all), all);
    expect(summary.keyInformation.map((item) => item.label)).toEqual(expect.arrayContaining(["拖尾长度感", "轨迹形态"]));
    expectNoInternalParticleData(publicSummaryJson(summary));
  });
});
