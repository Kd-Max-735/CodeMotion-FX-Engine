import { describe, expect, it } from "vitest";
import { NOISE_FIELD_SELF_CHECK, runNoiseFieldSelfCheck,
  selectNoiseFieldKeyframes } from "../../src/self-checks/noise-field-self-check.js";
import { expectNoInternalParticleData, observation, publicSummaryJson } from "./observable-test-helpers.js";

describe("noise_field independent self-check", () => {
  it("selects the strongest real texture changes rather than fixed fractions", () => {
    const signatures = [[0.1, 0.2], [0.11, 0.21], [0.5, 0.8], [0.51, 0.79], [0.2, 0.3]];
    const all = signatures.map((signature, frame) => observation(frame,
      { signature, contrast: 0.08 + frame * 0.03, detail: 0.04 + frame * 0.02 }));
    const selected = selectNoiseFieldKeyframes(all);
    const roles = selected.map((item) => item.role).join(" / ");
    for (const role of ["第 1 个明显演变", "层次最分明", "纹理后段"]) expect(roles).toContain(role);
    expect(typeof runNoiseFieldSelfCheck).toBe("function");
  });

  it("reports texture scale, contrast and temporal behavior without a value grid", () => {
    const all = [observation(0, { signature: [0.1, 0.2], contrast: 0.1, detail: 0.05 }),
      observation(5, { signature: [0.3, 0.5], contrast: 0.2, detail: 0.14 }),
      observation(9, { signature: [0.4, 0.6], contrast: 0.18, detail: 0.12 })];
    const summary = NOISE_FIELD_SELF_CHECK.summarize(selectNoiseFieldKeyframes(all), all);
    expect(summary.keyInformation.map((item) => item.label)).toEqual(expect.arrayContaining(["纹理尺度", "时间变化"]));
    expectNoInternalParticleData(publicSummaryJson(summary));
  });
});
