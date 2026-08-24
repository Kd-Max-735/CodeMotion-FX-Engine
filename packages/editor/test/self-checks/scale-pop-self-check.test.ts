import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runScalePopSelfCheck } from "../../src/self-checks/scale-pop-self-check.js";
import { runObservedFixture, testFrame } from "./observed-motion-test-helpers.js";

describe("scale_pop independent self-check", () => {
  it("selects start, overshoot, rebound, and final scale evidence", async () => {
    const result = await runObservedFixture("scale_pop", runScalePopSelfCheck, (time, duration, width, height) => {
      const progress = time / duration;
      const scale = 0.25 + progress * 0.75 + Math.sin(progress * Math.PI * 3) * (1 - progress) * 0.16;
      return testFrame(width, height, { scale });
    }, "由小弹性放大并轻微超调回弹");
    expect(result.keyframes.some((item) => item.role === "缩放超调峰值")).toBe(true);
    expect(result.keyframes.some((item) => /回弹|稳定/u.test(String(item.role)))).toBe(true);
    expect(JSON.stringify(result.macro.summary)).toContain("缩放出现");
    const rule = await readFile(resolve("packages/effect-functions/self-check-rules/tools/scale_pop.md"), "utf8");
    expect(rule).toContain("最大尺寸");
  });
});
