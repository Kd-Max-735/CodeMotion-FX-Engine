import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runBounceSelfCheck } from "../../src/self-checks/bounce-self-check.js";
import { runObservedFixture, testFrame } from "./observed-motion-test-helpers.js";

describe("bounce independent self-check", () => {
  it("selects apex, landing, decay, and settle evidence", async () => {
    const result = await runObservedFixture(runBounceSelfCheck, (time, _duration, width, height) => {
      const displacement = -Math.abs(Math.sin(time * Math.PI * 2.5)) * 0.2 * Math.exp(-time * 0.8);
      return testFrame(width, height, { y: displacement, scale: 1 + Math.max(0, Math.cos(time * Math.PI * 5)) * 0.04 });
    }, "向上弹跳三次并逐渐停稳");
    expect(result.keyframes.some((item) => item.role === "弹跳峰值")).toBe(true);
    expect(result.keyframes.some((item) => /落地|稳定/u.test(String(item.role)))).toBe(true);
    expect(JSON.stringify(result.macro.summary)).toContain("向上弹起并落下");
    const rule = await readFile(resolve("packages/effect-functions/self-check-rules/tools/bounce.md"), "utf8");
    expect(rule).toContain("首次峰值");
  });
});
