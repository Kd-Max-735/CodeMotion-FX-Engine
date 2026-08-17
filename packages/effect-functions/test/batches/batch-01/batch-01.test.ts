import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  AuthorizedEffectInput,
  AuthorizedEffectInputs,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../../src/types.js";
import {
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope
} from "../../../src/validation.js";
import { BATCH_01_DEFINITIONS } from "../../../src/batches/batch-01/index.js";

const pathBinding = {
  points: [{ x: 12, y: 70 }, { x: 45, y: 22 }, { x: 86, y: 82 }, { x: 145, y: 30 }],
  closed: false
};

const shapeA = {
  points: [{ x: 18, y: 18 }, { x: 92, y: 18 }, { x: 92, y: 92 }, { x: 18, y: 92 }],
  closed: true
};

const shapeB = {
  points: [{ x: 62, y: 38 }, { x: 142, y: 38 }, { x: 142, y: 110 }, { x: 62, y: 110 }],
  closed: true
};

function slotBinding(name: string): unknown {
  if (name === "shape_a") return shapeA;
  if (name === "shape_b" || name === "source_shape") return shapeB;
  if (name === "occlusion_mask") {
    return {
      width: 8,
      height: 6,
      values: Array.from({ length: 48 }, (_, index) => index % 9 === 0 ? 1 : 0.12)
    };
  }
  if (name === "stroke_plan") {
    return {
      strokes: [
        { points: [{ x: 10, y: 20 }, { x: 70, y: 30 }, { x: 130, y: 22 }] },
        { points: [{ x: 130, y: 55 }, { x: 70, y: 80 }, { x: 15, y: 60 }] }
      ]
    };
  }
  if (name === "source_image") return { width: 160, height: 120, decoded: true };
  if (name === "terminals") {
    return { points: [{ x: 15, y: 18 }, { x: 80, y: 96 }, { x: 148, y: 24 }], closed: false };
  }
  return pathBinding;
}

function contextFor(definition: EffectToolDefinition, seed = 173, time = 1.25): ServerEffectRenderContext {
  const inputs: Record<string, unknown> = {};
  for (const slot of definition.inputSlots) {
    inputs[slot.name] = {
      slot: slot.name,
      kind: slot.kind,
      tenantId: "tenant-batch-01",
      userId: "user-batch-01",
      locked: true,
      binding: slotBinding(slot.name)
    };
  }
  return {
    environment: "server",
    requestId: "batch-01-request",
    tenantId: "tenant-batch-01",
    userId: "user-batch-01",
    time,
    deltaTime: 1 / 30,
    frame: Math.round(time * 30),
    fps: 30,
    width: 160,
    height: 120,
    seed,
    quality: "final",
    backend: definition.primaryBackend,
    inputs: inputs as AuthorizedEffectInputs
  };
}

function assertFiniteJson(value: unknown, path = "$"): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value), `${path} must be finite`).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertFiniteJson(entry, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => assertFiniteJson(entry, `${path}.${key}`));
  }
}

const invalidData: Readonly<Record<string, Record<string, unknown>>> = {
  wave_path: { amplitude: 501 },
  dash_flow: { direction: "sideways" },
  blob_morph: { vertexCount: 7 },
  shape_boolean_animate: { operation: "overlay" },
  marker_stroke: { opacity: 2 },
  neon_trace: { hue: 361 },
  lightning_trace: { branchCount: 33 },
  paint_on: { brushShape: "textured" },
  volumetric_ray: { sampleCount: 7 },
  electric_arc: { intensity: 11 }
};

const fieldSpecNames: Readonly<Record<string, string>> = {
  wave_path: "wave-path-tool-field-spec.zh-CN.md",
  dash_flow: "dash-flow-tool-field-spec.zh-CN.md",
  blob_morph: "blob-morph-tool-field-spec.zh-CN.md",
  shape_boolean_animate: "shape-boolean-animate-tool-field-spec.zh-CN.md",
  marker_stroke: "marker-stroke-tool-field-spec.zh-CN.md",
  neon_trace: "neon-trace-tool-field-spec.zh-CN.md",
  lightning_trace: "lightning-trace-tool-field-spec.zh-CN.md",
  paint_on: "paint-on-tool-field-spec.zh-CN.md",
  volumetric_ray: "volumetric-ray-tool-field-spec.zh-CN.md",
  electric_arc: "electric-arc-tool-field-spec.zh-CN.md"
};

describe("batch-01 effect definitions", () => {
  it("exports exactly the ten assigned definitions with unique identities", () => {
    expect(BATCH_01_DEFINITIONS).toHaveLength(10);
    expect(new Set(BATCH_01_DEFINITIONS.map((definition) => definition.effectId)).size).toBe(10);
    expect(new Set(BATCH_01_DEFINITIONS.map((definition) => definition.toolName)).size).toBe(10);
    BATCH_01_DEFINITIONS.forEach(assertEffectToolDefinition);
  });

  it.each(BATCH_01_DEFINITIONS)("executes $toolName defaults and returns finite output", async (definition) => {
    const result = await executeSelectedEffectTool(
      definition,
      definition.toolName,
      { type: definition.toolName, data: {} },
      contextFor(definition)
    );
    expect(result.backendId).toBe(definition.primaryBackend.backendId);
    expect(result.degraded).toBe(false);
    expect(["frame", "metadata"]).toContain(result.kind);
    expect(() => JSON.stringify(result.output)).not.toThrow();
    assertFiniteJson(result.output);
  });

  it.each(BATCH_01_DEFINITIONS)("reproduces $toolName output with the same server seed", async (definition) => {
    const envelope = { type: definition.toolName, data: {} };
    const first = await executeSelectedEffectTool(definition, definition.toolName, envelope, contextFor(definition, 91));
    const second = await executeSelectedEffectTool(definition, definition.toolName, envelope, contextFor(definition, 91));
    expect(second).toEqual(first);
  });

  it.each(["blob_morph", "marker_stroke", "lightning_trace", "electric_arc"])(
    "uses the server seed for deterministic variation in %s",
    async (toolName) => {
      const definition = BATCH_01_DEFINITIONS.find((entry) => entry.toolName === toolName)!;
      const envelope = { type: toolName, data: {} };
      const first = await executeSelectedEffectTool(definition, toolName, envelope, contextFor(definition, 10));
      const second = await executeSelectedEffectTool(definition, toolName, envelope, contextFor(definition, 11));
      expect(second.output).not.toEqual(first.output);
    }
  );

  it("reveals lightning and marker geometry over server render time", async () => {
    const lightning = BATCH_01_DEFINITIONS.find((entry) => entry.toolName === "lightning_trace")!;
    const marker = BATCH_01_DEFINITIONS.find((entry) => entry.toolName === "marker_stroke")!;
    const renderAt = async (definition: EffectToolDefinition, time: number) => executeSelectedEffectTool(
      definition,
      definition.toolName,
      { type: definition.toolName, data: {} },
      contextFor(definition, 173, time)
    );

    const lightningStart = (await renderAt(lightning, 0)).output as {
      main: readonly unknown[]; revealProgress: number;
    };
    const lightningMiddle = (await renderAt(lightning, 0.625)).output as {
      main: readonly unknown[]; revealProgress: number;
    };
    const lightningEnd = (await renderAt(lightning, 1.25)).output as {
      main: readonly unknown[]; revealProgress: number;
    };
    expect(lightningStart.main).toHaveLength(0);
    expect(lightningMiddle.main.length).toBeGreaterThan(1);
    expect(lightningEnd.main.length).toBeGreaterThan(lightningMiddle.main.length);
    expect([lightningStart.revealProgress, lightningMiddle.revealProgress, lightningEnd.revealProgress])
      .toEqual([0, 0.5, 1]);

    const markerStart = (await renderAt(marker, 0)).output as { revealProgress: number };
    const markerMiddle = (await renderAt(marker, 0.7)).output as { revealProgress: number };
    const markerEnd = (await renderAt(marker, 1.4)).output as { revealProgress: number };
    expect([markerStart.revealProgress, markerMiddle.revealProgress, markerEnd.revealProgress])
      .toEqual([0, 0.5, 1]);
  });

  it.each([
    ["shape_boolean_animate", "progress", 1.4],
    ["neon_trace", "revealProgress", 1.4],
    ["paint_on", "revealProgress", 1.6]
  ] as const)("animates %s toward its requested target over server render time", async (
    toolName,
    progressKey,
    duration
  ) => {
    const definition = BATCH_01_DEFINITIONS.find((entry) => entry.toolName === toolName)!;
    const renderAt = (time: number) => executeSelectedEffectTool(
      definition,
      definition.toolName,
      { type: definition.toolName, data: {} },
      contextFor(definition, 173, time)
    );
    const start = (await renderAt(0)).output as Record<string, unknown>;
    const middle = (await renderAt(duration / 2)).output as Record<string, unknown>;
    const end = (await renderAt(duration)).output as Record<string, unknown>;
    expect(start[progressKey]).toBe(0);
    expect(middle[progressKey]).toBe(0.5);
    expect(end[progressKey]).toBe(1);
    expect(middle).not.toEqual(start);
    expect(end).not.toEqual(middle);
    if (toolName === "neon_trace") {
      expect(start.points).toEqual([]);
      expect((end.points as readonly unknown[]).length).toBeGreaterThan(2);
    }
    if (toolName === "paint_on") {
      expect(start.dabs).toEqual([]);
      expect((end.dabs as readonly unknown[]).length).toBeGreaterThan(2);
    }
  });

  it.each([
    ["shape_boolean_animate", ["union", "intersect", "subtract", "xor"].map((operation) => ({ operation }))],
    ["volumetric_ray", [
      { density: 0.35, exposure: 0.4, weight: 0.1, lightX: 0.2, lightY: 0 },
      { density: 0.75, exposure: 1.1, weight: 0.22, lightX: 0.5, lightY: 0.1 },
      { density: 1.2, exposure: 2.2, weight: 0.34, lightX: 0.85, lightY: -0.15 }
    ]],
    ["wave_path", [
      { amplitude: 10, wavelength: 260, speed: 0.2 },
      { amplitude: 36, wavelength: 180, speed: 0.5 },
      { amplitude: 18, wavelength: 72, speed: -1.2 }
    ]]
  ] as const)("produces visibly distinct structured output for reported %s parameter variants", async (
    toolName,
    variants
  ) => {
    const definition = BATCH_01_DEFINITIONS.find((entry) => entry.toolName === toolName)!;
    const outputs = await Promise.all(variants.map(async (variant) => {
      const result = await executeSelectedEffectTool(
        definition,
        definition.toolName,
        { type: definition.toolName, data: { ...definition.defaults, ...variant } },
        contextFor(definition, 173, 1.6)
      );
      return JSON.stringify(result.output);
    }));
    expect(new Set(outputs).size).toBe(variants.length);
  });

  it.each(BATCH_01_DEFINITIONS)("rejects unknown and invalid $toolName parameters", (definition) => {
    expect(() => validateAndNormalizeEffectEnvelope(
      definition,
      definition.toolName,
      { type: definition.toolName, data: { unknownParameter: true } }
    )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
    expect(() => validateAndNormalizeEffectEnvelope(
      definition,
      definition.toolName,
      { type: definition.toolName, data: invalidData[definition.toolName] }
    )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
  });

  it.each(BATCH_01_DEFINITIONS)("requires server-authorized inputs for $toolName", async (definition) => {
    const context = { ...contextFor(definition), inputs: {} };
    await expect(executeSelectedEffectTool(
      definition,
      definition.toolName,
      { type: definition.toolName, data: {} },
      context
    )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
  });

  it("rejects degenerate server path geometry instead of producing non-finite dash output", async () => {
    const definition = BATCH_01_DEFINITIONS.find((entry) => entry.toolName === "dash_flow")!;
    const context = contextFor(definition);
    const source = context.inputs.source_path as AuthorizedEffectInput;
    const inputs = {
      ...context.inputs,
      source_path: { ...source, binding: { points: [{ x: 4, y: 4 }, { x: 4, y: 4 }] } }
    } as AuthorizedEffectInputs;
    await expect(executeSelectedEffectTool(
      definition,
      definition.toolName,
      { type: definition.toolName, data: {} },
      { ...context, inputs }
    )).rejects.toThrow("zero-length path");
  });

  it.each(BATCH_01_DEFINITIONS)("keeps the $toolName Markdown JSON example Schema-valid", (definition) => {
    const filename = fieldSpecNames[definition.toolName]!;
    const markdown = readFileSync(new URL(`../../../field-specs/batch-01/${filename}`, import.meta.url), "utf8");
    expect(markdown).toContain(`\`${definition.toolName}\``);
    const match = /```json\s*([\s\S]*?)```/u.exec(markdown);
    expect(match, `${filename} needs one JSON example`).not.toBeNull();
    const example = JSON.parse(match![1]!) as unknown;
    const normalized = validateAndNormalizeEffectEnvelope(definition, definition.toolName, example);
    expect(normalized.type).toBe(definition.toolName);
    expect(normalized.data).toEqual(definition.defaults);
  });

  it("implements ten distinct output algorithms", async () => {
    const algorithms = await Promise.all(BATCH_01_DEFINITIONS.map(async (definition) => {
      const result = await executeSelectedEffectTool(
        definition,
        definition.toolName,
        { type: definition.toolName, data: {} },
        contextFor(definition)
      );
      return (result.output as { algorithm?: unknown }).algorithm;
    }));
    expect(algorithms.every((algorithm) => typeof algorithm === "string")).toBe(true);
    expect(new Set(algorithms).size).toBe(10);
  });
});
