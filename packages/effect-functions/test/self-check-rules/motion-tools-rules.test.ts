import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectValidParameterContract } from "./parameter-contract-test-helper.js";

const RULES = Object.freeze([
  ["handheld", ["intensity", "frequency", "translationJitter", "rotationJitterDegrees", "smoothing", "seedOffset"]],
  ["bounce", ["height", "gravity", "bounces", "damping", "squash"]],
  ["elastic", ["amplitude", "period", "decay", "axis"]],
  ["float", ["axis", "range", "frequency", "phase"]],
  ["fade", ["from", "to", "duration", "easing"]],
  ["rotate_in", ["angle", "pivot", "blur", "turns", "duration"]],
  ["scale_pop", ["startScale", "endScale", "spring", "pivot", "duration"]],
  ["slide", ["direction", "distance", "overshoot", "duration", "vector"]],
  ["ken_burns", ["startTime", "duration", "startScale", "endScale", "startCenterX", "startCenterY",
    "endCenterX", "endCenterY", "easing", "motionMode", "startCenterMode", "endCenterMode"]],
  ["dolly", ["direction", "distance", "heightOffset", "duration", "verticalFovDegrees", "easing"]]
] as const);

const REQUIRED = Object.freeze([
  "## 输入契约和核心原则",
  "## 自检视图字段",
  "## 关键帧合成图",
  "## 用户要求与证据",
  "## 判定流程",
  "## 通过与返修原则",
  "## 禁止事项"
]);

describe("ten independent motion self-check rules", () => {
  for (const [toolName, parameters] of RULES) {
    it(`${toolName}.md contains final-video guidance and real important parameters`, async () => {
      const markdown = await readFile(resolve(
        `packages/effect-functions/self-check-rules/tools/${toolName}.md`
      ), "utf8");
      expect(markdown).toMatch(new RegExp(`^# ${toolName} 自检规则`, "u"));
      for (const heading of REQUIRED) expect(markdown, heading).toContain(heading);
      expect(markdown).toContain("最终 MP4");
      expect(markdown).toContain("keyframe_contact_sheet");
      expect(markdown).toMatch(/关键帧数量.*(?:不固定|实际|取决|根据|随)/u);
      expect(markdown).not.toMatch(/model|模型名|版本号|effectId|ruleVersion|evidenceContractVersion|doubao|Ark|backendId|resourceId/u);
      const documented = expectValidParameterContract(markdown, toolName);
      expect(parameters.some((parameter) => documented.includes(parameter))).toBe(true);
      expect(markdown.split(/\r?\n/u).length).toBeLessThan(100);
    });
  }

  it("uses ten distinct files rather than one shared rule body", async () => {
    const contents = await Promise.all(RULES.map(([toolName]) => readFile(resolve(
      `packages/effect-functions/self-check-rules/tools/${toolName}.md`
    ), "utf8")));
    expect(new Set(contents).size).toBe(10);
  });
});
