import { describe, expect, it } from "vitest";
import { PARTICLE_ORBIT_FIELD_SELF_CHECK, runParticleOrbitFieldSelfCheck,
  selectParticleOrbitFieldKeyframes } from "../../src/self-checks/particle-orbit-field-self-check.js";
import { expectNoInternalParticleData, observation, publicSummaryJson } from "./observable-test-helpers.js";

describe("particle_orbit_field independent self-check", () => {
  it("derives a variable set of orbit milestones from accumulated rotation", () => {
    const all = Array.from({ length: 9 }, (_, index) => observation(index,
      { angularMotion: 0.9 + index * 0.05, spread: 0.35 + index * 0.01 }));
    const selected = selectParticleOrbitFieldKeyframes(all);
    expect(selected.map((item) => item.role).join(" / ")).toContain("环绕最明显");
    expect(selected.length).toBeGreaterThanOrEqual(4);
    expect(typeof runParticleOrbitFieldSelfCheck).toBe("function");
  });

  it("reports orbit range and direction in visible language", () => {
    const all = [observation(0, { angularMotion: 0.7 }), observation(5, { angularMotion: 1.4, spread: 0.5 }), observation(9, { angularMotion: 1 })];
    const summary = PARTICLE_ORBIT_FIELD_SELF_CHECK.summarize(selectParticleOrbitFieldKeyframes(all), all);
    expect(summary.keyInformation.map((item) => item.label)).toEqual(expect.arrayContaining(["轨道范围", "环绕方向"]));
    expectNoInternalParticleData(publicSummaryJson(summary));
  });
});
