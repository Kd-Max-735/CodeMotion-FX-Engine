import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runElasticSelfCheck } from "../../src/self-checks/elastic-self-check.js";
import { runObservedFixture, testFrame } from "./observed-motion-test-helpers.js";

describe("elastic independent self-check", () => {
  it("selects alternating overshoot, rebound, damping, and stable stages", async () => {
    const result = await runObservedFixture("elastic", runElasticSelfCheck, (time, _duration, width, height) =>
      testFrame(width, height, { x: Math.sin(time * Math.PI * 6) * 0.18 * Math.exp(-time * 1.5) }),
    "水平弹性往返并快速衰减");
    expect(result.keyframes.some((item) => /超调/u.test(String(item.role)))).toBe(true);
    expect(result.keyframes.some((item) => /回弹|稳定/u.test(String(item.role)))).toBe(true);
    expect(JSON.stringify(result.macro.summary)).toContain("水平方向");
    const rule = await readFile(resolve("packages/effect-functions/self-check-rules/tools/elastic.md"), "utf8");
    expect(rule).toContain("交替超调与回弹");
  });
});
