import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RULES = Object.freeze([
  ["aura_field", ["呼吸起伏", "连续光场", "轻微中心漂移"]],
  ["gradient_flow", ["连续色场", "传播方向", "全画面色彩变化"]],
  ["neon_glow", ["霓虹核心", "外围光晕", "电流感"]],
  ["energy_pulse", ["脉冲中心", "向外推进", "脉冲间暗段"]],
  ["lens_flare", ["主光源位置", "鬼影层次", "水平条纹"]],
  ["neon_trace", ["路径起始区域", "追踪方向", "完成后保留"]],
  ["sacred_geometry", ["对称性", "线条交叉", "整体旋转"]],
  ["scan_beam", ["光束朝向", "扫描方向", "循环回到起点"]],
  ["volumetric_ray", ["光束层次", "遮挡间隙", "底图可读性"]],
  ["hologram", ["扫描纹理", "全息抖动", "主体可读性"]]
] as const);

const SECTIONS = Object.freeze([
  "## 输入契约",
  "## 核心原则",
  "## 自检视图字段",
  "## 关键帧规则",
  "## 用户要求到证据映射",
  "## 判定流程",
  "## 通过与返修",
  "## 禁止事项"
]);

describe("ten light-effect independent self-check rules", () => {
  for (const [toolName, dedicatedPhrases] of RULES) {
    it(`${toolName}.md has its own final-video evidence and false-positive guidance`, async () => {
      const markdown = await readFile(resolve(
        process.cwd(), `packages/effect-functions/self-check-rules/tools/${toolName}.md`
      ), "utf8");
      expect(markdown).toMatch(new RegExp(`^# ${toolName} 自检规则`, "u"));
      for (const section of SECTIONS) expect(markdown, section).toContain(section);
      for (const phrase of dedicatedPhrases) expect(markdown, phrase).toContain(phrase);
      for (const field of ["file_name", "original_request", "summary", "metadata"]) {
        expect(markdown, field).toContain(`\`${field}\``);
      }
      expect(markdown).toContain("最终 MP4");
      expect(markdown).toContain("keyframe_contact_sheet");
      expect(markdown).toMatch(/误判|不能.*判|不得.*判/u);
      expect(markdown).not.toMatch(/effectId|版本号|模型名|doubao|Ark|backendId|resourceId|same_codec_control/u);
      expect(markdown.split(/\r?\n/u).length).toBeLessThan(100);
    });
  }

  it("keeps all ten rule files independently authored", async () => {
    const contents = await Promise.all(RULES.map(([toolName]) => readFile(resolve(
      process.cwd(), `packages/effect-functions/self-check-rules/tools/${toolName}.md`
    ), "utf8")));
    expect(new Set(contents).size).toBe(RULES.length);
  });

  it("requires aura_field to compare an explicitly requested location with the observed location", async () => {
    const markdown = await readFile(resolve(
      process.cwd(), "packages/effect-functions/self-check-rules/tools/aura_field.md"
    ), "utf8");
    expect(markdown).toContain("实际光场位置");
    expect(markdown).toContain("位置不一致时必须返修");
    expect(markdown).toContain("不用用户要求覆盖实际检测位置");
  });
});
