import { describe, expect, it } from "vitest";
import { PARTICLE_EMITTER_SELF_CHECK, runParticleEmitterSelfCheck,
  selectParticleEmitterKeyframes } from "../../src/self-checks/particle-emitter-self-check.js";
import { expectNoInternalParticleData, observation, publicSummaryJson } from "./observable-test-helpers.js";

describe("particle_emitter independent self-check", () => {
  it("covers onset, growth, peak and post-emission tail from actual activity", () => {
    const counts = [0, 5, 30, 75, 120, 95, 55, 20, 0];
    const all = counts.map((value, frame) => observation(frame, { activity: value }));
    const selected = selectParticleEmitterKeyframes(all);
    const roles = selected.map((item) => item.role).join(" / ");
    for (const role of ["开始发射", "粒子数量峰值", "最终状态"]) expect(roles).toContain(role);
    expect(selected.length).toBeGreaterThan(3);
    expect(typeof runParticleEmitterSelfCheck).toBe("function");
  });

  it("reports source feel, direction and lifecycle without emission data", () => {
    const all = [observation(0, { activity: 0 }), observation(5, { activity: 180, speed: 0.8 }), observation(9, { activity: 0 })];
    const summary = PARTICLE_EMITTER_SELF_CHECK.summarize(selectParticleEmitterKeyframes(all), all);
    expect(summary.keyInformation.map((item) => item.label)).toEqual(expect.arrayContaining(["发射位置感", "生命周期"]));
    expectNoInternalParticleData(publicSummaryJson(summary));
  });
});
