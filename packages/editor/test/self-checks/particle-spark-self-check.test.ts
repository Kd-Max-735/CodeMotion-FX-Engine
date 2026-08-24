import { describe, expect, it } from "vitest";
import { PARTICLE_SPARK_SELF_CHECK, runParticleSparkSelfCheck,
  selectParticleSparkKeyframes } from "../../src/self-checks/particle-spark-self-check.js";
import { expectNoInternalParticleData, observation, publicSummaryJson } from "./observable-test-helpers.js";

describe("particle_spark independent self-check", () => {
  it("chooses real local burst peaks and the first decay", () => {
    const activity = [0, 20, 90, 15, 0, 45, 110, 30, 5, 0];
    const all = activity.map((value, frame) => observation(frame, { activity: value }));
    const selected = selectParticleSparkKeyframes(all);
    const roles = selected.map((item) => item.role).join(" / ");
    for (const role of ["爆发起点", "最强爆发", "火花衰减"]) expect(roles).toContain(role);
    expect(selected.length).toBeGreaterThan(3);
    expect(typeof runParticleSparkSelfCheck).toBe("function");
  });

  it("describes burst count and fading without burst internals", () => {
    const all = [0, 80, 10, 0, 70, 5, 0].map((value, frame) => observation(frame, { activity: value }));
    const summary = PARTICLE_SPARK_SELF_CHECK.summarize(selectParticleSparkKeyframes(all), all);
    expect(summary.keyInformation.map((item) => item.label)).toContain("爆发次数感");
    expectNoInternalParticleData(publicSummaryJson(summary));
  });
});
