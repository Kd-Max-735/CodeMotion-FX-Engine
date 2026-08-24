import { describe, expect, it } from "vitest";
import { PARTICLE_LOGO_ASSEMBLE_SELF_CHECK, runParticleLogoAssembleSelfCheck,
  selectParticleLogoAssembleKeyframes } from "../../src/self-checks/particle-logo-assemble-self-check.js";
import { expectNoInternalParticleData, observation, publicSummaryJson } from "./observable-test-helpers.js";

describe("particle_logo_assemble independent self-check", () => {
  it("selects scattered, midpoint, contour and tightest aggregation states", () => {
    const all = [observation(0, { opacity: 0, spread: 0.8 }),
      observation(2, { opacity: 0.2, spread: 0.75 }), observation(5, { opacity: 0.7, spread: 0.42 }),
      observation(7, { opacity: 0.95, spread: 0.18 }), observation(9, { opacity: 0, spread: 0.05 })];
    const selected = selectParticleLogoAssembleKeyframes(all);
    const roles = selected.map((item) => item.role).join(" / ");
    for (const role of ["最分散状态", "聚合中段", "轮廓形成", "最终 Logo 状态"]) expect(roles).toContain(role);
    expect(typeof runParticleLogoAssembleSelfCheck).toBe("function");
  });

  it("describes aggregation degree and final form without target samples", () => {
    const all = [observation(0, { opacity: 0.1, spread: 0.8 }), observation(5, { opacity: 0.8, spread: 0.35 }), observation(9, { opacity: 0.5, spread: 0.08 })];
    const summary = PARTICLE_LOGO_ASSEMBLE_SELF_CHECK.summarize(selectParticleLogoAssembleKeyframes(all), all);
    expect(summary.keyInformation.map((item) => item.label)).toEqual(expect.arrayContaining(["聚合程度", "最终形态"]));
    expectNoInternalParticleData(publicSummaryJson(summary));
  });
});
