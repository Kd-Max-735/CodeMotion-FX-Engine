import { describe, expect, it } from "vitest";
import { SIM_COLLISION_SHATTER_SELF_CHECK, runSimCollisionShatterSelfCheck,
  selectCollisionShatterKeyframes } from "../../src/self-checks/sim-collision-shatter-self-check.js";
import { expectNoInternalParticleData, observation, publicSummaryJson } from "./observable-test-helpers.js";

describe("sim_collision_shatter independent self-check", () => {
  it("selects separation, speed peak, first impact, spin and widest spread", () => {
    const all = [observation(0, { displacement: 0, speed: 0, impacts: 0 }),
      observation(2, { displacement: 0.2, speed: 5, impacts: 0 }),
      observation(4, { displacement: 0.55, speed: 3, impacts: 0, rotation: 0.4 }),
      observation(6, { displacement: 0.9, speed: 1.5, impacts: 2, rotation: 1.2 }),
      observation(9, { displacement: 1.1, speed: 0.2, impacts: 4, rotation: 0.8 })];
    const selected = selectCollisionShatterKeyframes(all);
    const roles = selected.map((item) => item.role).join(" / ");
    for (const role of ["碎片开始分离", "爆裂速度峰值", "碎片首次落地", "碎片散布最广"]) expect(roles).toContain(role);
    expect(typeof runSimCollisionShatterSelfCheck).toBe("function");
  });

  it("reports strength, spread and later motion without fragment data", () => {
    const all = [observation(0, { displacement: 0 }), observation(5, { speed: 6, displacement: 0.7 }), observation(9, { displacement: 1.2, impacts: 3, rotation: 1 })];
    const summary = SIM_COLLISION_SHATTER_SELF_CHECK.summarize(selectCollisionShatterKeyframes(all), all);
    expect(summary.keyInformation.map((item) => item.label)).toEqual(expect.arrayContaining(["碎裂力度", "飞散范围", "后续运动"]));
    expectNoInternalParticleData(publicSummaryJson(summary));
  });
});
