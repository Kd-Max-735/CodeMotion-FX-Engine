import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runHandheldSelfCheck } from "../../src/self-checks/handheld-self-check.js";
import { runObservedFixture, testFrame } from "./observed-motion-test-helpers.js";

describe("handheld independent self-check", () => {
  it("selects real multi-direction shake stages and keeps its rule independent", async () => {
    const result = await runObservedFixture("handheld", runHandheldSelfCheck, (time, _duration, width, height) =>
      testFrame(width, height, { x: Math.sin(time * 13) * 0.05, y: Math.sin(time * 17) * 0.03,
        angle: Math.sin(time * 11) * 0.08 }), "自然但明显的手持晃动");
    expect(result.artifacts.view.status).toBe("pass");
    expect(result.keyframes.some((item) => /晃动|方向变化/u.test(String(item.role)))).toBe(true);
    expect(JSON.stringify(result.macro.summary)).toContain("多方向手持晃动");
    expect(Object.keys(result.macro)).toEqual(["file_name", "original_request", "summary", "metadata"]);
    const rule = await readFile(resolve("packages/effect-functions/self-check-rules/tools/handheld.md"), "utf8");
    expect(rule).toContain("持续单向漂移");
  });
});
