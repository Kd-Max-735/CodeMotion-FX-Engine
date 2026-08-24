import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { expectValidParameterContract } from "./parameter-contract-test-helper.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../self-check-rules/tools");

const RULES = [
  {
    tool: "datamosh",
    required: ["跨时刻的块状残帧", "错帧外观", "完整视频无法解码"],
    forbidden: ["blockSize", "carry", "motionX", "motionY", "corruption", "smear", "seedOffset"]
  },
  {
    tool: "glitch_slice",
    required: ["横条或竖条", "切片撕裂", "红蓝边"],
    forbidden: ["sliceSize", "displacement", "density", "direction", "channelJitter", "seedOffset", "mix"]
  },
  {
    tool: "pixel_sort",
    required: ["亮暗像素", "连续条带", "未参与区域"],
    forbidden: ["lowThreshold", "highThreshold", "minimumRun", "order", "mix"]
  },
  {
    tool: "pixel_dissolve",
    required: ["块状替换过程", "像素缺口", "完成帧"],
    forbidden: ["grid", "order", "seed", "progress", "duration"]
  },
  {
    tool: "video_freeze_frame",
    required: ["冻结区间", "恢复后画面", "不能被判为卡死"],
    forbidden: ["freezeAt", "freezeDuration", "zoomScale", "vignette"]
  },
  {
    tool: "echo_trail",
    required: ["真实历史轮廓", "静态背景", "重复人物"],
    forbidden: ["trailCount", "spacing", "decay", "offsetX", "offsetY", "blendMode"]
  },
  {
    tool: "zoom_tunnel",
    required: ["纵深穿梭", "运动模糊", "接近出口"],
    forbidden: ["transitionStart", "startScale", "endScale", "tunnelDepth", "motionBlur", "twistDegrees"]
  },
  {
    tool: "portal",
    required: ["门洞持续扩张", "门边扭曲", "完成帧"],
    forbidden: ["innerRadius", "outerRadius", "swirlTurns", "edgeSoftness", "glowStrength"]
  },
  {
    tool: "page_turn",
    required: ["页面抬起", "卷曲形成", "页面落下"],
    forbidden: ["curlRadius", "perspective", "shadowStrength", "easing"]
  },
  {
    tool: "wipe",
    required: ["移动边界", "四分之一", "最终完成整幅替换"],
    forbidden: ["softness", "angle", "progress", "duration"]
  }
] as const;

const SECTIONS = [
  "## 输入契约",
  "## 核心原则",
  "## 自检视图字段及含义",
  "## 关键帧证据检查方法",
  "## 用户要求到证据的映射",
  "## 判定流程",
  "## 通过与返修原则",
  "## 禁止事项"
] as const;

describe("ten independent effect self-check rules", () => {
  for (const rule of RULES) {
    it(`${rule.tool} contains only its dedicated final-video acceptance rule`, async () => {
      const markdown = await readFile(resolve(ROOT, `${rule.tool}.md`), "utf8");
      expect(markdown).toMatch(new RegExp(`^# ${rule.tool} 自检规则`, "u"));
      for (const section of SECTIONS) expect(markdown, section).toContain(section);
      for (const phrase of rule.required) expect(markdown, phrase).toContain(phrase);
      const documented = expectValidParameterContract(markdown, rule.tool);
      expect(rule.forbidden.some((name) => documented.includes(name))).toBe(true);
      expect(markdown).toContain("`file_name`");
      expect(markdown).toContain("`original_request`");
      expect(markdown).toContain("`summary`");
      expect(markdown).toContain("`metadata`");
      expect(markdown).toContain("最终 MP4");
      expect(markdown).toContain("keyframe_contact_sheet");
      expect(markdown).not.toMatch(/model|effectId|ruleVersion|evidenceContractVersion|资源 ID/u);
      expect(markdown.split(/\r?\n/u).length).toBeLessThan(100);
    });
  }
});
