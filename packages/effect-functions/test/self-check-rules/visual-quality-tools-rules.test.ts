import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const TOOLS = Object.freeze([
  "chromatic_aberration", "color_grade", "film_grain", "gaussian_blur", "directional_blur",
  "motion_blur", "radial_blur", "rgb_split", "texture_overlay", "track_matte"
]);
const SECTIONS = Object.freeze([
  "输入契约", "核心原则", "自检视图字段及含义", "关键帧检查规则",
  "用户要求到证据的映射", "判定流程", "通过与返修原则", "禁止事项"
]);
const SIGNATURES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  chromatic_aberration: ["红蓝边缘", "外围"], color_grade: ["冷暖", "高光"],
  film_grain: ["正常颗粒", "时间变化"], gaussian_blur: ["均匀柔化", "拍摄失焦"],
  directional_blur: ["拖影轴", "方向集中"], motion_blur: ["运动拖影", "失焦故障"],
  radial_blur: ["视觉中心", "径向结构"], rgb_split: ["三通道", "绿色参照"],
  texture_overlay: ["覆盖范围", "接缝"], track_matte: ["保留", "隐藏"]
});

describe("visual-quality tool acceptance rules", () => {
  for (const tool of TOOLS) it(`${tool} has an independent, effect-specific acceptance contract`, async () => {
    const markdown = await readFile(new URL(`../../self-check-rules/tools/${tool}.md`, import.meta.url), "utf8");
    for (const section of SECTIONS) expect(markdown).toContain(`## ${section}`);
    expect(markdown).toContain("file_name");
    expect(markdown).toContain("keyframe_contact_sheet");
    for (const phrase of SIGNATURES[tool]!) expect(markdown).toContain(phrase);
    expect(markdown).not.toMatch(/effectId|doubao|seed-\d|版本号|后端|https?:\/\/|[A-Za-z]:\\/u);
  });
});
