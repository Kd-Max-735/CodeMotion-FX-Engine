import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runFloatSelfCheck } from "../../src/self-checks/float-self-check.js";
import { runObservedFixture, testFrame } from "./observed-motion-test-helpers.js";

describe("float independent self-check", () => {
  it("selects actual loop turns and reports the observed floating path", async () => {
    const result = await runObservedFixture(runFloatSelfCheck, (time, _duration, width, height) =>
      testFrame(width, height, { x: Math.sin(time * Math.PI * 2) * 0.08, y: Math.cos(time * Math.PI * 2) * 0.08 }),
    "环绕式循环漂浮");
    expect(result.keyframes.filter((item) => item.role === "漂浮转向位置").length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(result.macro.summary)).toContain("漂浮");
    const rule = await readFile(resolve("packages/effect-functions/self-check-rules/tools/float.md"), "utf8");
    expect(rule).toContain("上方或下方极值");
  });
});
