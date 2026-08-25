import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { datamoshSamplingPlan, runDatamoshSelfCheck } from "../src/datamosh-self-check.js";
import { selfCheckFixture } from "./self-check-test-helpers.js";

describe("datamosh dedicated self-check", () => {
  it("checks persistent block displacement without treating it as codec damage", async () => {
    const request = await selfCheckFixture("datamosh", { carry: 0.8, blockSize: 16 });
    const plan = datamoshSamplingPlan(request);
    expect(plan.map((item) => item.role)).toEqual([
      "early_displacement", "block_residue", "peak_mosh", "persistence", "late_state"
    ]);
    const artifacts = await runDatamoshSelfCheck(request);
    expect(Object.keys(artifacts.json)).toEqual(["file_name", "original_request", "summary", "metadata"]);
    expect(artifacts.json.summary.description).toMatch(/块状错帧|故障外观/u);
    expect(artifacts.json.metadata.quality).toMatchObject({
      full_decode_passed: true,
      intentional_effects_excluded_from_damage_detection: true
    });
    expect(await readFile(artifacts.evidenceFiles.get("keyframe_contact_sheet")!)).not.toHaveLength(0);
    expect(JSON.stringify(artifacts.json)).not.toMatch(/backend|cache|algorithm/u);
  });

  it("marks only a real decode failure for repair", async () => {
    const request = await selfCheckFixture("datamosh", {}, { failValidation: true });
    const artifacts = await runDatamoshSelfCheck(request);
    expect(artifacts.json.metadata.quality).toMatchObject({ full_decode_passed: false });
  });
});
