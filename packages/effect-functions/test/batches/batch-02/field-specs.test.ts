import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BATCH_02_DEFINITIONS } from "../../../src/batches/batch-02/index.js";
import { validateAndNormalizeEffectEnvelope } from "../../../src/validation.js";

const specDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../../../field-specs/batch-02");
const expectedFiles = BATCH_02_DEFINITIONS.map((definition) => `${definition.toolName}.md`).sort();
const assignedToolNames = new Set([
  "aura_field", "chromatic_aberration", "color_grade", "datamosh", "depth_of_field",
  "glitch_slice", "gradient_flow", "pixel_sort", "rgb_split"
]);

describe("batch-02 Chinese field specifications", () => {
  it("provides exactly one specification for every tool", () => {
    const files = readdirSync(specDirectory).filter((name) => name.endsWith(".md")).sort();
    expect(files).toEqual(expectedFiles);
  });

  it("validates every documented JSON envelope against its selected definition", () => {
    for (const definition of BATCH_02_DEFINITIONS) {
      const markdown = readFileSync(resolve(specDirectory, `${definition.toolName}.md`), "utf8");
      expect(markdown.split("\n", 1)[0]).toContain(`（${definition.toolName}）`);
      for (const heading of ["效果说明", "输出要求", "模型参数字段", "参数选择规则", "自然语言示例", "推荐档位", "默认值和中性值", "不适用范围"]) {
        expect(markdown).toContain(`## ${heading}`);
      }
      const jsonBlocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gu)];
      expect(jsonBlocks).toHaveLength(1);
      const envelope = JSON.parse(jsonBlocks[0]![1]!) as unknown;
      const normalized = validateAndNormalizeEffectEnvelope(
        definition,
        definition.toolName,
        envelope
      );
      const schema = definition.parameterSchema as { properties: Record<string, unknown> };
      const documentedData = (envelope as { data: Record<string, unknown> }).data;
      expect(Object.keys(documentedData).sort()).toEqual(Object.keys(schema.properties).sort());
      expect(Object.keys(documentedData).sort()).toEqual(Object.keys(definition.defaults).sort());
      if (assignedToolNames.has(definition.toolName)) {
        expect(normalized.data).toEqual(definition.defaults);
      }

      const examples = markdown.match(/## 自然语言示例([\s\S]*?)## 推荐档位/u)?.[1] ?? "";
      const exampleCount = [...examples.matchAll(/^\d+\. /gmu)].length;
      expect(exampleCount).toBeGreaterThanOrEqual(5);
      expect(exampleCount).toBeLessThanOrEqual(8);
      expect(markdown).toMatch(/服务器输入/u);
    }
  });
});
