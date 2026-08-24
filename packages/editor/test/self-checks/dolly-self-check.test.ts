import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runDollySelfCheck } from "../../src/self-checks/dolly-self-check.js";
import { runObservedFixture, testFrame } from "./observed-motion-test-helpers.js";

describe("dolly independent self-check", () => {
  it("keeps track start, travel stages, midpoint, height, and endpoint evidence", async () => {
    const result = await runObservedFixture(runDollySelfCheck, (time, duration, width, height) => {
      const progress = time / duration;
      return testFrame(width, height, { y: -progress * 0.08, scale: 1 + progress * 0.32 });
    }, "沿轨道升高推进");
    expect(result.keyframes.some((item) => item.role === "轨道移动中点")).toBe(true);
    expect(result.keyframes[0]?.role).toBe("轨道移动起点");
    expect(result.keyframes.at(-1)?.role).toBe("轨道移动终点");
    expect(JSON.stringify(result.macro.summary)).toContain("轨道推进");
    const rule = await readFile(resolve("packages/effect-functions/self-check-rules/tools/dolly.md"), "utf8");
    expect(rule).toContain("前景与背景相对位移");
  });
});
