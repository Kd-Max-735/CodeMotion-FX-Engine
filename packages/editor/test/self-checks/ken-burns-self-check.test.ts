import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runKenBurnsSelfCheck } from "../../src/self-checks/ken-burns-self-check.js";
import { runObservedFixture, testFrame } from "./observed-motion-test-helpers.js";

describe("ken_burns independent self-check", () => {
  it("keeps start, pan/zoom stages, midpoint, and end framing", async () => {
    const result = await runObservedFixture("ken_burns", runKenBurnsSelfCheck, (time, duration, width, height) => {
      const progress = time / duration;
      return testFrame(width, height, { x: progress * 0.13, y: -progress * 0.05, scale: 1 + progress * 0.28 });
    }, "缓慢向右上巡览并推近");
    expect(result.keyframes.some((item) => item.role === "平移缩放中点")).toBe(true);
    expect(result.keyframes[0]?.role).toBe("起始取景");
    expect(result.keyframes.at(-1)?.role).toBe("结束取景");
    expect(JSON.stringify(result.macro.summary)).toContain("平移缩放");
    const rule = await readFile(resolve("packages/effect-functions/self-check-rules/tools/ken_burns.md"), "utf8");
    expect(rule).toContain("主体占画面比例");
  });
});
