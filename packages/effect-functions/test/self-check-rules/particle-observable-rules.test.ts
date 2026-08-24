import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PARTICLE_DISSOLVE_DEFINITION, PARTICLE_EMITTER_DEFINITION,
  PARTICLE_LOGO_ASSEMBLE_DEFINITION, PARTICLE_SNOW_RAIN_DEFINITION,
  PARTICLE_SPARK_DEFINITION, PARTICLE_TRAIL_DEFINITION } from "../../src/batches/batch-03/index.js";
import { COLLISION_SHATTER_DEFINITION, FLOW_FIELD_DEFINITION,
  ORBIT_FIELD_DEFINITION } from "../../src/batches/batch-04/index.js";
import { noiseFieldDefinition } from "../../src/batches/batch-07/noise-field.js";
import { expectValidParameterContract } from "./parameter-contract-test-helper.js";

const tools = [
  ["particle_dissolve", PARTICLE_DISSOLVE_DEFINITION, ["溶解程度", "消散方向"]],
  ["particle_flow_field", FLOW_FIELD_DEFINITION, ["流场形态", "主运动方向"]],
  ["particle_orbit_field", ORBIT_FIELD_DEFINITION, ["轨道范围", "环绕方向"]],
  ["particle_snow_rain", PARTICLE_SNOW_RAIN_DEFINITION, ["风向表现", "下落速度"]],
  ["particle_spark", PARTICLE_SPARK_DEFINITION, ["爆发次数感", "衰减表现"]],
  ["particle_emitter", PARTICLE_EMITTER_DEFINITION, ["发射位置感", "生命周期"]],
  ["particle_logo_assemble", PARTICLE_LOGO_ASSEMBLE_DEFINITION, ["聚合程度", "最终形态"]],
  ["particle_trail", PARTICLE_TRAIL_DEFINITION, ["拖尾长度感", "轨迹形态"]],
  ["noise_field", noiseFieldDefinition, ["纹理尺度", "时间变化"]],
  ["sim_collision_shatter", COLLISION_SHATTER_DEFINITION, ["碎裂力度", "飞散范围"]]
] as const;

const requiredSections = ["输入契约", "核心原则", "自检视图字段", "关键帧规则",
  "用户要求到证据映射", "判定流程", "通过与返修", "禁止事项"] as const;

describe("ten independent observable-effect self-check rules", () => {
  it.each(tools)("keeps %s in its own effect-specific Markdown contract", async (toolName, definition, terms) => {
    const markdown = await readFile(resolve("packages/effect-functions/self-check-rules/tools", `${toolName}.md`), "utf8");
    expect(markdown).toMatch(new RegExp(`^# ${toolName} 自检规则`, "u"));
    for (const section of requiredSections) expect(markdown).toContain(`## ${section}`);
    for (const term of terms) expect(markdown).toContain(term);
    expect(markdown).toContain("keyframe_contact_sheet");
    expect(markdown).toMatch(/数量不固定|数量随|帧数|阶段重合/u);
    expect(markdown).toMatch(/最终.*视频|最终 MP4|最终编码视频/u);
    expect(markdown).not.toMatch(/effectId|ruleVersion|evidenceContractVersion|doubao-seed|模型版本/u);
    const documented = expectValidParameterContract(markdown, toolName);
    expect(Object.keys(definition.defaults).some((parameter) => documented.includes(parameter))).toBe(true);
  });
});
