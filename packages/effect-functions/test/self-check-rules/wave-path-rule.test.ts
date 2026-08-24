import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WAVE_PATH_DEFINITION } from "../../src/batches/batch-01/wave-path.js";

const RULE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../self-check-rules/tools/wave_path.md"
);

const RULE_IDS = [
  "WP_EXECUTION_INTEGRITY",
  "WP_BASELINE_AND_DIRECTION",
  "WP_WAVE_GEOMETRY",
  "WP_PHASE_AND_MOTION",
  "WP_TAPER_BEHAVIOR",
  "WP_FRAME_SAFETY",
  "WP_USER_INTENT"
] as const;

describe("wave_path self-check rule", () => {
  it("binds one English-named rule to the exact effect identity and parameter contract", async () => {
    const markdown = await readFile(RULE_PATH, "utf8");
    expect(markdown).toContain("`toolName`: `wave_path`");
    expect(markdown).toContain(`\`effectId\`: \`${WAVE_PATH_DEFINITION.effectId}\``);
    for (const parameter of Object.keys(WAVE_PATH_DEFINITION.defaults)) {
      expect(markdown, parameter).toContain(`\`${parameter}\``);
    }
  });

  it("requires macro JSON, final-video frame evidence, and all seven decisions", async () => {
    const markdown = await readFile(RULE_PATH, "utf8");
    expect(markdown).toContain("宏观自检 JSON");
    expect(markdown).toContain("抽帧从最终编码视频解码");
    expect(markdown).toContain("keyframe_contact_sheet");
    expect(markdown).toContain("same_codec_control");
    expect(markdown).not.toContain("source_reference");
    expect(markdown).not.toContain("path_detail");
    for (const ruleId of RULE_IDS) expect(markdown, ruleId).toContain(ruleId);
  });

  it("keeps the model decision closed to pass or fail", async () => {
    const markdown = await readFile(RULE_PATH, "utf8");
    expect(markdown).toContain("`status` 只能是 `pass` 或 `fail`");
    expect(markdown).not.toMatch(/"status"\s*:\s*"insufficient"/u);
    const jsonBlocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gu)];
    expect(jsonBlocks).toHaveLength(1);
    const example = JSON.parse(jsonBlocks[0]![1]!) as {
      status: string;
      checks: readonly { ruleId: string; status: string }[];
      issues: readonly unknown[];
    };
    expect(example.status).toBe("pass");
    expect(example.checks.map((check) => check.ruleId)).toEqual(RULE_IDS);
    expect(example.checks.every((check) => check.status === "pass")).toBe(true);
    expect(example.issues).toEqual([]);
  });
});
