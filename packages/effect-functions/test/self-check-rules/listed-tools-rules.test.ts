import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const RULES = Object.freeze([
  ["beat_pulse", ["visible_pulse_count", "recovery_between_pulses"]],
  ["onset_trigger", ["visible_trigger_count", "post_trigger_recovery"]],
  ["spectrum_bars", ["visible_bar_groups", "height_range"]],
  ["vocal_reactive_text", ["visible_content", "quiet_state", "active_state"]],
  ["waveform", ["trace_count", "continuity"]],
  ["number_counter", ["visible_sequence", "start_value", "end_value", "rhythm"]],
  ["typewriter", ["visible_content", "reveal_order", "complete"]],
  ["text_morph", ["source_content", "target_content", "morph_sequence"]],
  ["kinetic_typography", ["layout_motion", "scale_rhythm", "readability"]],
  ["path_trim", ["visible_path_progression", "coverage_change", "stroke_continuity"]]
] as const);

const REQUIRED_SECTIONS = Object.freeze([
  "## 输入契约",
  "## 核心原则",
  "## 自检视图字段",
  "## 关键帧规则",
  "## 用户要求到证据映射",
  "## 判定流程",
  "## 通过与返修",
  "## 禁止事项"
]);

describe("listed tools independent self-check Markdown", () => {
  for (const [toolName, factKeys] of RULES) {
    it(`${toolName}.md is independent, effect-specific, and implementation-safe`, async () => {
      const markdown = await readFile(resolve(
        process.cwd(), `packages/effect-functions/self-check-rules/tools/${toolName}.md`
      ), "utf8");
      for (const section of REQUIRED_SECTIONS) expect(markdown, section).toContain(section);
      for (const factKey of factKeys) expect(markdown, factKey).toContain(`\`${factKey}\``);
      expect(markdown).toContain("最终 MP4");
      expect(markdown).toContain("keyframe_contact_sheet");
      expect(markdown).not.toMatch(/effectId|版本号|模型名|doubao|Ark|backendId|resourceId/u);
      expect(markdown).not.toMatch(/`(?:threshold|cooldown|sensitivity|barCount|sampleCount|fromValue|toValue|speed|duration|progress|beatMap|scaleMap|strokeWidth)`/u);
    });
  }

  it("uses ten separate files with non-identical effect guidance", async () => {
    const contents = await Promise.all(RULES.map(([toolName]) => readFile(resolve(
      process.cwd(), `packages/effect-functions/self-check-rules/tools/${toolName}.md`
    ), "utf8")));
    expect(new Set(contents).size).toBe(RULES.length);
  });

  it("requires beat_pulse to compare requested strength with the observed strength", async () => {
    const markdown = await readFile(resolve(
      process.cwd(), "packages/effect-functions/self-check-rules/tools/beat_pulse.md"
    ), "utf8");
    expect(markdown).toContain("实际脉冲强弱");
    expect(markdown).toContain("实际等级为“明显”必须返修");
    expect(markdown).toContain("不用用户要求覆盖实际检测等级");
  });
});
