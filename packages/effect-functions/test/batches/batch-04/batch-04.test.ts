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
  AuthorizedEffectInputs,
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

const INDIVIDUAL_MODULES = [
  ["sim_boids", "BOIDS_DEFINITION", () => import("../../../src/batches/batch-04/boids.js")],
  ["sim_cloth", "CLOTH_DEFINITION", () => import("../../../src/batches/batch-04/cloth.js")],
  ["sim_collision_shatter", "COLLISION_SHATTER_DEFINITION", () => import("../../../src/batches/batch-04/collision-shatter.js")],
  ["particle_flow_field", "FLOW_FIELD_DEFINITION", () => import("../../../src/batches/batch-04/flow-field.js")],
  ["sim_fluid_lite", "FLUID_LITE_DEFINITION", () => import("../../../src/batches/batch-04/fluid-lite.js")],
  ["particle_orbit_field", "ORBIT_FIELD_DEFINITION", () => import("../../../src/batches/batch-04/orbit-field.js")],
  ["sim_rigid_body_2d", "RIGID_BODY_2D_DEFINITION", () => import("../../../src/batches/batch-04/rigid-body-2d.js")],
  ["sim_rope", "ROPE_DEFINITION", () => import("../../../src/batches/batch-04/rope.js")],
  ["sim_soft_body", "SOFT_BODY_DEFINITION", () => import("../../../src/batches/batch-04/soft-body.js")],
  ["sim_spring", "SPRING_DEFINITION", () => import("../../../src/batches/batch-04/spring.js")]
] as const;

const STATE_BUDGETS = new Map<string, readonly [string, number]>([
  ["particle_orbit_field", ["particles", 384]],
  ["particle_flow_field", ["particles", 512]],
  ["sim_spring", ["nodes", 32]],
  ["sim_rigid_body_2d", ["bodies", 48]],
  ["sim_soft_body", ["nodes", 48]],
  ["sim_cloth", ["vertices", 196]],
  ["sim_rope", ["points", 41]],
  ["sim_fluid_lite", ["cells", 576]],
  ["sim_boids", ["boids", 96]],
  ["sim_collision_shatter", ["fragments", 64]]
]);

const TEST_IMAGE = new Uint8Array(1280 * 720 * 4).fill(160);

function requiredInputs(definition: EffectToolDefinition): AuthorizedEffectInputs {
  return Object.freeze(Object.fromEntries(definition.inputSlots
    .filter((slot) => slot.required)
    .map((slot) => [slot.name, {
      slot: slot.name,
      kind: slot.kind,
      tenantId: "tenant-batch-04",
      userId: "user-batch-04",
      locked: true as const,
      binding: { width: 1280, height: 720, data: TEST_IMAGE }
    }])));
}

function context(
  definition: EffectToolDefinition,
  time = 0.5,
  seed = 20260814,
  inputs: AuthorizedEffectInputs = requiredInputs(definition)
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
    inputs
  };
}

function authorizedInput(
  slot: EffectToolDefinition["inputSlots"][number]
): AuthorizedEffectInputs {
  const binding = slot.name === "vector_field"
    ? { columns: 2, rows: 2, vectors: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }] }
    : slot.name === "mesh"
      ? { vertices: [{ x: -0.3, y: -0.4 }, { x: 0.3, y: -0.4 }, { x: 0.3, y: 0.2 }, { x: -0.3, y: 0.2 }] }
      : slot.name === "pins"
        ? { indices: [0, 1], points: [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }] }
        : slot.name === "obstacle_mask"
          ? { blockedIndices: [0, 1, 2] }
          : slot.kind === "image"
            ? { width: 1280, height: 720, data: TEST_IMAGE }
            : { centroids: [{ x: -0.1, y: -0.1 }, { x: 0.1, y: -0.1 }] };
  return {
    [slot.name]: {
      slot: slot.name,
      kind: slot.kind,
      tenantId: "tenant-batch-04",
      userId: "user-batch-04",
      locked: true,
      binding
    }
  };
}

function guardedDefinition(
  definition: EffectToolDefinition,
  onRender: () => void,
  inputSlots = definition.inputSlots
): EffectToolDefinition {
  return {
    ...definition,
    inputSlots,
    render: (renderContext, params) => {
      onRender();
      return definition.render(renderContext, params);
    }
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

  it.each(INDIVIDUAL_MODULES)("loads %s from its exact independent module", async (
    toolName,
    exportName,
    load
  ) => {
    const module = await load() as Record<string, unknown>;
    const definition = module[exportName] as EffectToolDefinition;
    expect(definition.toolName).toBe(toolName);
    expect(BATCH_04_DEFINITIONS.filter((entry) => entry.toolName === toolName)).toEqual([definition]);
  });

  it("passes the shared public definition contract", () => {
    for (const definition of BATCH_04_DEFINITIONS) {
      expect(() => assertEffectToolDefinition(definition)).not.toThrow();
      expect(definition.primaryBackend.deterministic).toBe(true);
      expect(definition.toolName).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u);
    }
  });

  it("keeps every Schema closed and applies the matching optional defaults", () => {
    for (const definition of BATCH_04_DEFINITIONS) {
      const schema = definition.parameterSchema as JsonObject;
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required ?? []).toEqual([]);
      const envelope = validateAndNormalizeEffectEnvelope(
        definition,
        definition.toolName,
        { type: definition.toolName, data: {} }
      );
      expect(envelope.data).toEqual(definition.defaults);
      expect(Object.keys(envelope.data)).toEqual(Object.keys(schemaProperties(definition)));
      for (const property of Object.values(schemaProperties(definition))) {
        if (property.type === "number") {
          expect(property.multipleOf).toEqual(expect.any(Number));
          expect(property.multipleOf).toBeGreaterThan(0);
        }
      }
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
      expect(evolved.simulatedTime).toBeLessThanOrEqual(0.75);
    }
  });

  it("uses the fixed seed for stochastic initial conditions", async () => {
    const stochastic = new Set([
      "particle_orbit_field",
      "particle_flow_field",
      "sim_rigid_body_2d",
      "sim_boids",
      "sim_collision_shatter"
    ]);
    for (const definition of BATCH_04_DEFINITIONS.filter(({ toolName }) => stochastic.has(toolName))) {
      const first = await definition.render(context(definition, 0.5, 11), definition.defaults);
      const second = await definition.render(context(definition, 0.5, 12), definition.defaults);
      expect(asRecord(first.output).state).not.toEqual(asRecord(second.output).state);
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

  it("rejects unknown, non-finite and resource-bearing model data without entering render", async () => {
    for (const definition of BATCH_04_DEFINITIONS) {
      const numericName = Object.entries(schemaProperties(definition))
        .find(([, property]) => property.type === "number" || property.type === "integer")?.[0];
      const stepped = Object.entries(schemaProperties(definition))
        .find(([, property]) => property.type === "number" && typeof property.multipleOf === "number");
      expect(numericName).toBeDefined();
      expect(stepped).toBeDefined();
      const [steppedName, steppedProperty] = stepped!;
      for (const [data, code] of [
        [{ unexpected: true }, "PARAMETER_INVALID"],
        [{ [numericName!]: Number.NaN }, "PARAMETER_INVALID"],
        [{ [numericName!]: Number.POSITIVE_INFINITY }, "PARAMETER_INVALID"],
        [{ [steppedName]: (steppedProperty.minimum as number) + (steppedProperty.multipleOf as number) / 2 }, "PARAMETER_INVALID"],
        [{ asset_id: "asset_0123456789abcdef01234567" }, "RESOURCE_INJECTION"]
      ] as const) {
        let renderCalls = 0;
        const guarded = guardedDefinition(definition, () => { renderCalls += 1; });
        await expect(executeSelectedEffectTool(
          guarded,
          guarded.toolName,
          { type: guarded.toolName, data },
          context(guarded)
        )).rejects.toMatchObject({ code });
        expect(renderCalls).toBe(0);
      }

      let renderCalls = 0;
      const guarded = guardedDefinition(definition, () => { renderCalls += 1; });
      await expect(executeSelectedEffectTool(
        guarded,
        guarded.toolName,
        { type: `wrong_${guarded.toolName}`, data: {} },
        context(guarded)
      )).rejects.toMatchObject({ code: "TYPE_MISMATCH" });
      await expect(executeSelectedEffectTool(
        guarded,
        guarded.toolName,
        { type: guarded.toolName, data: {} },
        { ...context(guarded), time: Number.NaN }
      )).rejects.toMatchObject({ code: "SERVER_CONTEXT_INVALID" });
      expect(renderCalls).toBe(0);
    }
  });

  it("clamps direct finite extremes and enforces structural simulation budgets", async () => {
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
      const [collectionName, maximumSize] = STATE_BUDGETS.get(definition.toolName)!;
      const state = asRecord(output.state);
      expect(state[collectionName]).toBeInstanceOf(Array);
      expect((state[collectionName] as unknown[]).length).toBeLessThanOrEqual(maximumSize);
    }
  }, 20_000);

  it("keeps mesh, pins, fracture maps and vector fields outside model data", () => {
    const forbidden = new Set([
      "mesh", "pins", "fractureMap", "fracture_map", "vectorField", "vector_field", "obstacle_mask"
    ]);
    const slots = new Set<string>();
    for (const definition of BATCH_04_DEFINITIONS) {
      for (const name of Object.keys(schemaProperties(definition))) expect(forbidden.has(name)).toBe(false);
      for (const slot of definition.inputSlots) slots.add(slot.name);
    }
    expect(slots).toEqual(new Set([
      "vector_field", "background_image", "cloth_image", "source_image",
      "mesh", "pins", "obstacle_mask", "fracture_map"
    ]));
  });

  it("accepts valid owner-locked resources and deterministic omission defaults", async () => {
    for (const definition of BATCH_04_DEFINITIONS) {
      const omitted = await executeSelectedEffectTool(
        definition,
        definition.toolName,
        { type: definition.toolName, data: {} },
        context(definition)
      );
      expectFiniteJson(omitted.output);
      const omittedState = asRecord(omitted.output).state;
      for (const slot of definition.inputSlots) {
        const result = await executeSelectedEffectTool(
          definition,
          definition.toolName,
          { type: definition.toolName, data: {} },
          context(definition, 0.5, 20260814, {
            ...requiredInputs(definition),
            ...authorizedInput(slot)
          })
        );
        expectFiniteJson(result.output);
        if (slot.kind === "image") {
          expect(asRecord(result.output).state).toEqual(omittedState);
        } else {
          expect(asRecord(result.output).state).not.toEqual(omittedState);
        }
      }
    }
  });

  it("rejects missing required or invalid owner/kind/lock inputs without entering render", async () => {
    for (const definition of BATCH_04_DEFINITIONS.filter(({ inputSlots }) => inputSlots.length > 0)) {
      const slot = definition.inputSlots[0]!;
      let renderCalls = 0;
      const required = guardedDefinition(definition, () => { renderCalls += 1; }, [
        { ...slot, required: true },
        ...definition.inputSlots.slice(1)
      ]);
      await expect(executeSelectedEffectTool(
        required,
        required.toolName,
        { type: required.toolName, data: {} },
        context(required, 0.5, 20260814, {})
      )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
      expect(renderCalls).toBe(0);

      const valid = authorizedInput(slot);
      const binding = valid[slot.name] as Exclude<(typeof valid)[string], readonly unknown[]>;
      for (const invalid of [
        { ...binding, tenantId: "other-tenant" },
        { ...binding, userId: "other-user" },
        { ...binding, kind: slot.kind === "data" ? "image" : "data" },
        { ...binding, locked: false }
      ]) {
        await expect(executeSelectedEffectTool(
          required,
          required.toolName,
          { type: required.toolName, data: {} },
          context(required, 0.5, 20260814, {
            ...requiredInputs(required),
            [slot.name]: invalid
          } as unknown as AuthorizedEffectInputs)
        )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
        expect(renderCalls).toBe(0);
      }
    }
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
    const definition = BATCH_04_DEFINITIONS.find((entry) => entry.toolName === toolName)!;
    for (const parameterName of Object.keys(schemaProperties(definition))) {
      expect(markdown).toContain(`\`${parameterName}\``);
    }
    for (const slot of definition.inputSlots) {
      expect(markdown).toContain(`\`${slot.name}\``);
    }
    expect((markdown.match(/^- /gmu) ?? []).length).toBeGreaterThanOrEqual(5);
  });
});
