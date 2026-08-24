import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runRotateInSelfCheck } from "../../src/self-checks/rotate-in-self-check.js";
import { runObservedFixture, testFrame } from "./observed-motion-test-helpers.js";

describe("rotate_in independent self-check", () => {
  it("keeps a multi-stage final-video rotation proof", async () => {
    const result = await runObservedFixture("rotate_in", runRotateInSelfCheck, (time, duration, width, height) =>
      testFrame(width, height, { angle: (1 - time / duration) * Math.PI * 1.5, scale: 0.75 + time / duration * 0.25 }),
    "顺时针旋转进入并回正");
    expect(result.keyframes.filter((item) => /旋转/u.test(String(item.role))).length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(result.macro.summary)).toContain("旋转");
    const rule = await readFile(resolve("packages/effect-functions/self-check-rules/tools/rotate_in.md"), "utf8");
    expect(rule).toContain("多圈旋转");
  });
});
