import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@codemotion/core";
import {
  BATCH_04_DEFINITIONS
} from "../../../src/batches/batch-04/index.js";
import {
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope
} from "../../../src/validation.js";
import type {
  EffectRenderResult,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../../src/types.js";

const EXPECTED = [
  ["fx.particle.orbitField", "particle_orbit_field", "particle_orbit_field.md"],
  ["fx.particle.flowField", "particle_flow_field", "particle_flow_field.md"],
  ["fx.sim.spring", "sim_spring", "sim_spring.md"],
  ["fx.sim.rigidBody2D", "sim_rigid_body_2d", "sim_rigid_body_2d.md"],
  ["fx.sim.softBody", "sim_soft_body", "sim_soft_body.md"],
  ["fx.sim.cloth", "sim_cloth", "sim_cloth.md"],
  ["fx.sim.rope", "sim_rope", "sim_rope.md"],
  ["fx.sim.fluidLite", "sim_fluid_lite", "sim_fluid_lite.md"],
  ["fx.sim.boids", "sim_boids", "sim_boids.md"],
  ["fx.sim.collisionShatter", "sim_collision_shatter", "sim_collision_shatter.md"]
] as const;

function context(
  definition: EffectToolDefinition,
  time = 0.5,
  seed = 20260814
): ServerEffectRenderContext {
  return {
    environment: "server",
    requestId: "batch-04-test",
    tenantId: "tenant-batch-04",
    userId: "user-batch-04",
    time,
    deltaTime: 1 / 60,
    frame: Math.max(0, Math.floor(time * 60)),
    fps: 60,
    width: 1280,
    height: 720,
    seed,
    quality: "final",
    backend: definition.primaryBackend,
    inputs: {}
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  expect(Array.isArray(value)).toBe(false);
  return value as Record<string, unknown>;
}

function expectFiniteJson(value: unknown): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    for (const entry of value) expectFiniteJson(entry);
    return;
  }
  expect(typeof value).toBe("object");
  for (const entry of Object.values(value as Record<string, unknown>)) expectFiniteJson(entry);
}

function schemaProperties(definition: EffectToolDefinition): Record<string, Record<string, unknown>> {
  const schema = definition.parameterSchema as JsonObject;
  return schema.properties as unknown as Record<string, Record<string, unknown>>;
}

function paramsAtNumericBound(
  definition: EffectToolDefinition,
  bound: "minimum" | "maximum"
): JsonObject {
  const result: JsonObject = { ...definition.defaults };
  for (const [name, property] of Object.entries(schemaProperties(definition))) {
    if ((property.type === "number" || property.type === "integer") && typeof property[bound] === "number") {
      result[name] = property[bound] as number;
    }
  }
  return result;
}

async function render(
  definition: EffectToolDefinition,
  time: number,
  params: JsonObject = definition.defaults
): Promise<EffectRenderResult> {
  return definition.render(context(definition, time), params) as Promise<EffectRenderResult>;
}

describe("batch-04 definitions", () => {
  it("exports exactly the assigned ten independent definitions", () => {
    expect(BATCH_04_DEFINITIONS).toHaveLength(10);
    expect(BATCH_04_DEFINITIONS.map(({ effectId, toolName }) => [effectId, toolName]))
      .toEqual(EXPECTED.map(([effectId, toolName]) => [effectId, toolName]));
    expect(new Set(BATCH_04_DEFINITIONS.map((definition) => definition.toolName)).size).toBe(10);
    expect(BATCH_04_DEFINITIONS.every((definition) => definition.presets.length === 3)).toBe(true);
  });

  it("passes the shared public definition contract", () => {
    for (const definition of BATCH_04_DEFINITIONS) {
      expect(() => assertEffectToolDefinition(definition)).not.toThrow();
      expect(definition.primaryBackend.deterministic).toBe(true);
      expect(definition.toolName).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u);
    }
  });

  it("runs every default through the public selected-tool executor and returns finite output", async () => {
    for (const definition of BATCH_04_DEFINITIONS) {
      const result = await executeSelectedEffectTool(
        definition,
        definition.toolName,
        { type: definition.toolName, data: {} },
        context(definition)
      );
      expect(result.kind).toBe("metadata");
      expect(result.backendId).toBe(definition.primaryBackend.backendId);
      const output = asRecord(result.output);
      expect(output.effectId).toBe(definition.effectId);
      expect(output.stepCount).toBeGreaterThan(0);
      expectFiniteJson(output);
    }
  });

  it("is reproducible for the same context and changes state over time", async () => {
    for (const definition of BATCH_04_DEFINITIONS) {
      const first = await render(definition, 0.75);
      const second = await render(definition, 0.75);
      expect(second).toEqual(first);
      const initial = asRecord((await render(definition, 0)).output);
      const evolved = asRecord(first.output);
      expect(evolved.state).not.toEqual(initial.state);
    }
  });

  it("rejects out-of-schema extremes before rendering", () => {
    for (const definition of BATCH_04_DEFINITIONS) {
      const properties = schemaProperties(definition);
      const numeric = Object.entries(properties).find(([, property]) => typeof property.maximum === "number");
      expect(numeric).toBeDefined();
      const [name, property] = numeric!;
      expect(() => validateAndNormalizeEffectEnvelope(
        definition,
        definition.toolName,
        { type: definition.toolName, data: { [name]: (property.maximum as number) + 1 } }
      )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
    }
  });

  it("clamps direct finite extremes and caps simulation work", async () => {
    for (const definition of BATCH_04_DEFINITIONS) {
      for (const bound of ["minimum", "maximum"] as const) {
        const extreme: JsonObject = { ...definition.defaults };
        for (const [name, property] of Object.entries(schemaProperties(definition))) {
          if (property.type === "number" || property.type === "integer") {
            extreme[name] = bound === "minimum" ? -1e9 : 1e9;
          }
        }
        const normalized = definition.normalizeParams(extreme);
        expect(() => validateAndNormalizeEffectEnvelope(
          definition,
          definition.toolName,
          { type: definition.toolName, data: normalized }
        )).not.toThrow();
      }
      const result = await render(definition, 999, paramsAtNumericBound(definition, "maximum"));
      const output = asRecord(result.output);
      expect(output.stepCount).toBeLessThanOrEqual(360);
      expect(result.warnings).toHaveLength(1);
      expectFiniteJson(output);
    }
  }, 20_000);

  it("keeps mesh, pins, fracture maps and vector fields outside model data", () => {
    const forbidden = new Set(["mesh", "pins", "fractureMap", "fracture_map", "vectorField", "vector_field"]);
    const slots = new Set<string>();
    for (const definition of BATCH_04_DEFINITIONS) {
      for (const name of Object.keys(schemaProperties(definition))) expect(forbidden.has(name)).toBe(false);
      for (const slot of definition.inputSlots) slots.add(slot.name);
    }
    expect(slots).toEqual(new Set(["vector_field", "mesh", "pins", "obstacle_mask", "fracture_map"]));
  });
});

describe("batch-04 Chinese model field specifications", () => {
  it.each(EXPECTED)("documents %s as selected-tool-only JSON guidance", (_effectId, toolName, fileName) => {
    const markdown = readFileSync(new URL(`../../../field-specs/batch-04/${fileName}`, import.meta.url), "utf8");
    expect(markdown).toContain(`\`${toolName}\``);
    expect(markdown).toContain("只输出");
    expect(markdown).toContain(`\"type\":\"${toolName}\"`);
    expect(markdown).toContain("| 字段 | 必填 | 取值 | 选择策略 |");
    expect(markdown).toContain("参数优先级");
    expect(markdown).toContain("自然语言示例");
    expect(markdown).toContain("推荐档位");
    expect(markdown).toContain("中性值与默认行为");
    expect(markdown).toContain("不适用范围");
    expect((markdown.match(/^- /gmu) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
