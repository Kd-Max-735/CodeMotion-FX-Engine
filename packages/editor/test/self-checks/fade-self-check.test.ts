import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runFadeSelfCheck } from "../../src/self-checks/fade-self-check.js";
import { runObservedFixture, testFrame } from "./observed-motion-test-helpers.js";

describe("fade independent self-check", () => {
  it("selects observed visibility quarters without reading expected opacity", async () => {
    const result = await runObservedFixture(runFadeSelfCheck, (time, duration, width, height) =>
      testFrame(width, height, { opacity: Math.min(1, time / (duration * 0.7)) }), "柔和淡入后保持清晰");
    expect(result.keyframes.some((item) => item.role === "可见度过渡中点")).toBe(true);
    expect(JSON.stringify(result.macro.summary)).toContain("由弱到强淡入");
    const rule = await readFile(resolve("packages/effect-functions/self-check-rules/tools/fade.md"), "utf8");
    expect(rule).toContain("结束保持");
  });
});
