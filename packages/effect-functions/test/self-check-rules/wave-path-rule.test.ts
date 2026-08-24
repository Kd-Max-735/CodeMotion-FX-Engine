import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WAVE_PATH_DEFINITION } from "../../src/batches/batch-01/wave-path.js";
import { expectValidParameterContract } from "./parameter-contract-test-helper.js";

const RULE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../self-check-rules/tools/wave_path.md"
);

describe("wave_path self-check rule", () => {
  it("keeps effect-specific acceptance guidance and real important parameters", async () => {
    const markdown = await readFile(RULE_PATH, "utf8");
    expect(markdown).toMatch(/^# wave_path 自检规则/u);
    const parameters = expectValidParameterContract(markdown, "wave_path");
    expect(parameters).toContain("amplitude");
    expect(parameters.every((parameter) => Object.hasOwn(WAVE_PATH_DEFINITION.defaults, parameter))).toBe(true);
    expect(markdown).not.toMatch(/model|ruleVersion|evidenceContractVersion|effectId/u);
    expect(markdown.split(/\r?\n/u).length).toBeLessThan(120);
  });

  it("defines the compact JSON and single contact-sheet evidence", async () => {
    const markdown = await readFile(RULE_PATH, "utf8");
    expect(markdown).toContain("`metadata.media`");
    expect(markdown).toContain("`metadata.quality`");
    expect(markdown).toContain("`metadata.keyframe_evidence`");
    expect(markdown).toContain("最终 MP4");
    expect(markdown).toContain("keyframe_contact_sheet");
    expect(markdown).toContain("抽帧数量不固定");
    expect(markdown).toContain("所有关键帧按时间从左到右合并为一张图");
    expect(markdown).not.toContain("same_codec_control");
    expect(markdown).not.toContain("normalizedParams");
  });
});
