import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runSlideSelfCheck } from "../../src/self-checks/slide-self-check.js";
import { runObservedFixture, testFrame } from "./observed-motion-test-helpers.js";

describe("slide independent self-check", () => {
  it("selects entry, overshoot, rebound, and stable landing evidence", async () => {
    const result = await runObservedFixture("slide", runSlideSelfCheck, (time, duration, width, height) => {
      const progress = time / duration;
      const x = -0.42 * (1 - progress) + Math.sin(progress * Math.PI) * 0.04;
      return testFrame(width, height, { x });
    }, "从左侧快速划入并轻微回弹");
    expect(result.keyframes.some((item) => item.role === "划入中段")).toBe(true);
    expect(result.keyframes.some((item) => /落位|回弹/u.test(String(item.role)))).toBe(true);
    expect(JSON.stringify(result.macro.summary)).toContain("从左向右进入");
    const rule = await readFile(resolve("packages/effect-functions/self-check-rules/tools/slide.md"), "utf8");
    expect(rule).toContain("越过落点");
  });
});
