import { describe, expect, it } from "vitest";
import { PARTICLE_FLOW_FIELD_SELF_CHECK, runParticleFlowFieldSelfCheck,
  selectParticleFlowFieldKeyframes } from "../../src/self-checks/particle-flow-field-self-check.js";
import { expectNoInternalParticleData, observation, publicSummaryJson } from "./observable-test-helpers.js";

describe("particle_flow_field independent self-check", () => {
  it("uses observed flow speed, coverage and direction changes", () => {
    const all = [observation(0, { speed: 0.02, coverage: 0.2 }),
      observation(3, { speed: 0.5, directionX: 0.4, directionY: 0.1 }),
      observation(6, { speed: 0.35, directionX: -0.3, directionY: 0.2, angularMotion: 0.8 }),
      observation(9, { coverage: 0.82, speed: 0.2 })];
    const selected = selectParticleFlowFieldKeyframes(all);
    const roles = selected.map((item) => item.role).join(" / ");
    for (const role of ["流动峰值", "流向转折", "分布最充分"]) expect(roles).toContain(role);
    expect(typeof runParticleFlowFieldSelfCheck).toBe("function");
  });

  it("describes flow without exposing the field implementation", () => {
    const all = [observation(0), observation(5, { speed: 0.7, coverage: 0.7, coherence: 0.4 }), observation(9)];
    const summary = PARTICLE_FLOW_FIELD_SELF_CHECK.summarize(selectParticleFlowFieldKeyframes(all), all);
    expect(summary.keyInformation.map((item) => item.label)).toContain("流场形态");
    expectNoInternalParticleData(publicSummaryJson(summary));
  });
});
