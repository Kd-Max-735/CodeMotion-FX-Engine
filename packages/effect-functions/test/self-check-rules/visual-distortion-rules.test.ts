import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tools = [
  "displacement_map", "kaleidoscope", "liquid_displace", "fractal", "glass",
  "image_depth_parallax", "path_morph", "turbulent_displace", "wave_warp", "wave_surface"
] as const;

const dedicatedEvidence = {
  displacement_map: ["实际形变范围", "形变方向", "边缘表现"],
  kaleidoscope: ["对称性", "中心表现", "接缝质量"],
  liquid_displace: ["液态流动", "折射表现", "彩色边缘"],
  fractal: ["递归层次", "层间区分", "中心深入感"],
  glass: ["通透与磨砂", "玻璃色调", "边缘高光"],
  image_depth_parallax: ["深度层次", "镜头运动", "边缘完整性"],
  path_morph: ["起止关系", "变形峰值", "结束稳定性"],
  turbulent_displace: ["形变尺度", "方向偏置", "有机连续性"],
  wave_warp: ["扭曲方向", "波纹疏密", "波形连续性"],
  wave_surface: ["波面形态", "峰谷层次", "曲面完整性"]
} as const;

describe("ten independent visual self-check Markdown rules", () => {
  for (const tool of tools) {
    it(`${tool} owns a complete, effect-specific rule`, async () => {
      const path = resolve(`packages/effect-functions/self-check-rules/tools/${tool}.md`);
      const markdown = await readFile(path, "utf8");
      expect(markdown).toMatch(new RegExp(`^# ${tool} 自检规则`, "u"));
      for (const heading of ["输入契约", "核心原则", "自检视图字段", "关键帧规则",
        "用户要求到证据的映射", "判定流程", "通过与返修", "禁止事项"]) {
        expect(markdown, heading).toContain(`## ${heading}`);
      }
      expect(markdown).toContain("最终 MP4");
      expect(markdown).toContain("keyframe_contact_sheet");
      for (const fact of dedicatedEvidence[tool]) expect(markdown, fact).toContain(fact);
      expect(markdown).not.toMatch(/effectId|ruleVersion|evidenceContractVersion|doubao|Ark|采样密度/u);
      expect(markdown).not.toMatch(/[A-Za-z]:\\|\/tmp\/|resource[_ ]?id|资源 ID/iu);
    });
  }
});
