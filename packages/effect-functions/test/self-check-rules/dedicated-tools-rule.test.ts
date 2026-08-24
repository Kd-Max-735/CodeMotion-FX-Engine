import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidParameterContract } from "./parameter-contract-test-helper.js";

const TOOLS = Object.freeze([
  "background_remove_compose",
  "blend",
  "blob_morph",
  "chart_reveal",
  "character_cascade",
  "handwriting",
  "brush_reveal",
  "mask_reveal",
  "paint_on"
] as const);

const REQUIRED_HEADINGS = Object.freeze([
  "## 输入契约",
  "## 核心原则",
  "## 自检视图字段及含义",
  "## 关键帧合成图的检查方法",
  "## 用户要求到证据的映射",
  "## 判定流程",
  "## 通过与返修原则",
  "## 禁止事项"
]);

function rulePath(toolName: typeof TOOLS[number]): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), `../../self-check-rules/tools/${toolName}.md`);
}

describe("nine dedicated tool self-check rules", () => {
  it.each(TOOLS)("$0 has an independent compact acceptance document", async (toolName) => {
    const markdown = await readFile(rulePath(toolName), "utf8");
    expect(markdown).toMatch(new RegExp(`^# ${toolName} 自检规则`, "u"));
    for (const heading of REQUIRED_HEADINGS) expect(markdown).toContain(heading);
    expect(markdown).toContain("keyframe_contact_sheet");
    expect(markdown).toContain("最终视频");
    expect(markdown.split(/\r?\n/u).length).toBeLessThan(110);
  });

  it.each(TOOLS)("$0 exposes only real important fields without implementation identity", async (toolName) => {
    const markdown = await readFile(rulePath(toolName), "utf8");
    expectValidParameterContract(markdown, toolName);
    expect(markdown).not.toMatch(/effectId|ruleVersion|evidenceContractVersion|backendId|same_codec_control|normalizedParams/u);
    expect(markdown).not.toMatch(/doubao-seed|gpt-|claude|gemini/iu);
  });

  it("keeps every tool's evidence vocabulary distinct", async () => {
    const markdown = Object.fromEntries(await Promise.all(TOOLS.map(async (toolName) => [
      toolName,
      await readFile(rulePath(toolName), "utf8")
    ])));
    expect(markdown.background_remove_compose).toContain("主体边缘");
    expect(markdown.blend).toContain("图层贡献");
    expect(markdown.blob_morph).toContain("轮廓连续");
    expect(markdown.chart_reveal).toContain("数据组");
    expect(markdown.character_cascade).toContain("文字完整性");
    expect(markdown.handwriting).toContain("笔迹进度");
    expect(markdown.brush_reveal).toContain("笔刷纹理");
    expect(markdown.mask_reveal).toContain("未覆盖区域");
    expect(markdown.paint_on).toContain("逐笔顺序");
  });
});
