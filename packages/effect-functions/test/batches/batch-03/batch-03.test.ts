import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@codemotion/core";
import type {
  AuthorizedEffectInputs,
  EffectInputSlotDefinition,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../../src/types.js";
import { assertEffectToolDefinition, executeSelectedEffectTool } from "../../../src/validation.js";
import { BATCH_03_DEFINITIONS } from "../../../src/batches/batch-03/index.js";
import { BATCH_03_GPU_BACKEND } from "../../../src/batches/batch-03/shared.js";

const EXPECTED_IDENTITIES = [
  ["fx.distort.waveWarp", "wave_warp"],
  ["fx.distort.turbulentDisplace", "turbulent_displace"],
  ["fx.distort.liquidDisplace", "liquid_displace"],
  ["fx.distort.kaleidoscope", "kaleidoscope"],
  ["fx.particle.emitter", "particle_emitter"],
  ["fx.particle.logoAssemble", "particle_logo_assemble"],
  ["fx.particle.dissolve", "particle_dissolve"],
  ["fx.particle.trail", "particle_trail"],
  ["fx.particle.spark", "particle_spark"],
  ["fx.particle.snowRain", "particle_snow_rain"]
] as const;

function bindingFor(slot: EffectInputSlotDefinition) {
  return {
    slot: slot.name,
    kind: slot.kind,
    tenantId: "tenant-batch-03",
    userId: "user-batch-03",
    locked: true as const,
    binding: { opaqueServerBinding: slot.name }
  };
}

function inputsFor(definition: EffectToolDefinition): AuthorizedEffectInputs {
  return Object.fromEntries(definition.inputSlots
    .filter((slot) => slot.required)
    .map((slot) => [slot.name, bindingFor(slot)]));
}

function contextFor(
  definition: EffectToolDefinition,
  seed = 7411
): ServerEffectRenderContext {
  return {
    environment: "server",
    requestId: "request-batch-03",
    tenantId: "tenant-batch-03",
    userId: "user-batch-03",
    time: 0.4,
    deltaTime: 1 / 30,
    frame: 12,
    fps: 30,
    width: 1280,
    height: 720,
    seed,
    quality: "final",
    backend: BATCH_03_GPU_BACKEND,
    inputs: inputsFor(definition)
  };
}

async function executeDefaults(definition: EffectToolDefinition, seed = 7411) {
  return executeSelectedEffectTool(
    definition,
    definition.toolName,
    { type: definition.toolName, data: {} },
    contextFor(definition, seed)
  );
}

describe("batch-03 definitions", () => {
  it("exports exactly the assigned ten definitions in the requested order", () => {
    expect(BATCH_03_DEFINITIONS.map(({ effectId, toolName }) => [effectId, toolName]))
      .toEqual(EXPECTED_IDENTITIES);
  });

  it("passes the shared contract with closed Schemas, matching defaults, and three presets", () => {
    for (const definition of BATCH_03_DEFINITIONS) {
      expect(() => assertEffectToolDefinition(definition)).not.toThrow();
      expect(definition.parameterSchema).toMatchObject({
        type: "object",
        additionalProperties: false
      });
      expect(definition.presets).toHaveLength(3);

      const schema = definition.parameterSchema as JsonObject;
      const properties = schema.properties as JsonObject;
      expect(Object.keys(properties)).not.toContain("seed");
      expect(Object.keys(properties).some((name) => /(?:asset|resource|file|url|path|image|texture|map)(?:Id)?$/iu.test(name))).toBe(false);
      for (const [name, value] of Object.entries(definition.defaults)) {
        expect((properties[name] as JsonObject).default).toEqual(value);
      }
    }
  });

  it("executes all defaults and keeps every spatial/particle algorithm distinct", async () => {
    const outputs = await Promise.all(BATCH_03_DEFINITIONS.map(executeDefaults));
    const algorithms = outputs.map((result) => (result.output as { algorithm: string }).algorithm);
    expect(new Set(algorithms.slice(0, 4)).size).toBe(4);
    expect(new Set(algorithms.slice(4)).size).toBe(6);
    expect(new Set(algorithms).size).toBe(10);
    expect(outputs.every((result) => result.backendId === BATCH_03_GPU_BACKEND.backendId)).toBe(true);
  });

  it("uses only the server seed for random effects and reproduces identical samples", async () => {
    const randomDefinitions = BATCH_03_DEFINITIONS.filter((definition) =>
      definition.effectId === "fx.distort.turbulentDisplace" || definition.category === "particle");
    for (const definition of randomDefinitions) {
      const first = await executeDefaults(definition, 99);
      const repeat = await executeDefaults(definition, 99);
      const changed = await executeDefaults(definition, 100);
      expect(repeat.output).toEqual(first.output);
      expect(changed.output).not.toEqual(first.output);
    }
  });

  it("keeps Logo, target, source, and flow resources in server input slots", async () => {
    const required = BATCH_03_DEFINITIONS.filter((definition) =>
      definition.inputSlots.some((slot) => slot.required));
    for (const definition of required) {
      const missingContext = { ...contextFor(definition), inputs: {} };
      await expect(executeSelectedEffectTool(
        definition,
        definition.toolName,
        { type: definition.toolName, data: {} },
        missingContext
      )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
    }
    expect(BATCH_03_DEFINITIONS.find(({ toolName }) => toolName === "particle_logo_assemble")?.inputSlots)
      .toContainEqual(expect.objectContaining({ name: "logo_image", required: true }));
    expect(BATCH_03_DEFINITIONS.find(({ toolName }) => toolName === "particle_dissolve")?.inputSlots)
      .toContainEqual(expect.objectContaining({ name: "target_image", required: true }));
  });
});

describe("batch-03 Chinese field specifications", () => {
  it("provides one complete instruction document for each tool", () => {
    for (const [, toolName] of EXPECTED_IDENTITIES) {
      const path = fileURLToPath(new URL(`../../../field-specs/batch-03/${toolName}.md`, import.meta.url));
      const markdown = readFileSync(path, "utf8");
      expect(markdown).toContain(`\`${toolName}\``);
      expect(markdown).toContain("## 工具作用");
      expect(markdown).toContain("## JSON 输出格式");
      expect(markdown).toContain("只输出");
      expect(markdown).toContain("## 完整参数表");
      expect(markdown).toContain("## 表达映射与选择顺序");
      expect(markdown).toContain("## 自然语言示例");
      expect(markdown).toContain("## 推荐值、默认值和中性值");
      expect(markdown).toContain("## 不适用范围");
      expect(markdown).not.toMatch(/(?:https?:\/\/|[A-Za-z]:\\\\)/u);
    }
  });
});
