import { describe, expect, it } from "vitest";
import { PARTICLE_DISSOLVE_SELF_CHECK, runParticleDissolveSelfCheck,
  selectParticleDissolveKeyframes } from "../../src/self-checks/particle-dissolve-self-check.js";
import { expectNoInternalParticleData, observation, publicSummaryJson } from "./observable-test-helpers.js";

describe("particle_dissolve independent self-check", () => {
  it("selects actual dissolve onset, half-state, activity peak and tail", () => {
    const all = [observation(0, { activity: 0, sourceRemaining: 1 }),
      observation(2, { activity: 30, sourceRemaining: 0.85 }),
      observation(5, { activity: 90, sourceRemaining: 0.48, coverage: 0.6 }),
      observation(7, { activity: 45, sourceRemaining: 0.15 }),
      observation(9, { activity: 0, sourceRemaining: 0 })];
    const selected = selectParticleDissolveKeyframes(all);
    const roles = selected.map((item) => item.role).join(" / ");
    for (const role of ["溶解前状态", "粒子活动峰值", "最终消散状态"]) expect(roles).toContain(role);
    expect(selected.length).toBeGreaterThan(3);
    expect(typeof runParticleDissolveSelfCheck).toBe("function");
  });

  it("publishes only user-facing dissolve semantics", () => {
    const all = [observation(0, { sourceRemaining: 1 }), observation(5, { activity: 80, sourceRemaining: 0.4 }),
      observation(9, { activity: 0, sourceRemaining: 0 })];
    const summary = PARTICLE_DISSOLVE_SELF_CHECK.summarize(selectParticleDissolveKeyframes(all), all);
    expect(summary.keyInformation.map((item) => item.label)).toContain("溶解程度");
    expectNoInternalParticleData(publicSummaryJson(summary));
  });
});
