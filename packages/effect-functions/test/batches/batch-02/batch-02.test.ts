import { describe, expect, it } from "vitest";
import type {
  AuthorizedEffectInput,
  AuthorizedEffectInputs,
  EffectRenderResult,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../../src/types.js";
import {
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope
} from "../../../src/validation.js";
import {
  AURA_FIELD_DEFINITION,
  BATCH_02_DEFINITIONS,
  COLOR_GRADE_DEFINITION,
  DATAMOSH_DEFINITION,
  DEPTH_OF_FIELD_DEFINITION,
  GLITCH_SLICE_DEFINITION,
  PIXEL_SORT_DEFINITION,
  type RgbaFrame
} from "../../../src/batches/batch-02/index.js";

const width = 12;
const height = 8;
const assignedToolNames = [
  "aura_field",
  "chromatic_aberration",
  "color_grade",
  "datamosh",
  "depth_of_field",
  "glitch_slice",
  "gradient_flow",
  "pixel_sort",
  "rgb_split"
] as const;

function rgbaFrame(variant = 0): RgbaFrame {
  const data: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data.push(
        (x * 29 + y * 17 + variant * 53) % 256,
        (x * 11 + y * 43 + variant * 71) % 256,
        (x * 37 + y * 7 + variant * 31) % 256,
        255
      );
    }
  }
  return { width, height, data };
}

const source = rgbaFrame();
const previous = rgbaFrame(2);
const depth = {
  width,
  height,
  data: Array.from({ length: width * height }, (_, index) => (index % width) / (width - 1))
};

function binding(slot: string, kind: "image" | "depth-map", value: unknown) {
  return { slot, kind, tenantId: "tenant-b02", userId: "user-b02", locked: true as const, binding: value };
}

function context(definition: EffectToolDefinition, time = 1.25): ServerEffectRenderContext {
  const entries = definition.inputSlots.map((slot) => {
    const value = slot.name === "previous_frame" ? previous : slot.name === "depth_field" ? depth : source;
    return [slot.name, binding(slot.name, slot.kind as "image" | "depth-map", value)] as const;
  });
  return {
    environment: "server",
    requestId: "request-b02",
    tenantId: "tenant-b02",
    userId: "user-b02",
    time,
    deltaTime: 1 / 30,
    frame: Math.round(time * 30),
    fps: 30,
    width,
    height,
    seed: 424242,
    quality: "final",
    backend: definition.primaryBackend,
    inputs: Object.fromEntries(entries) as AuthorizedEffectInputs
  };
}

async function render(
  definition: EffectToolDefinition,
  params: Record<string, unknown> = definition.defaults
): Promise<RgbaFrame> {
  const result = await executeSelectedEffectTool(
    definition,
    definition.toolName,
    { type: definition.toolName, data: params },
    context(definition)
  ) as EffectRenderResult<RgbaFrame>;
  expect(result.kind).toBe("frame");
  expect(result.backendId).toBe(definition.primaryBackend.backendId);
  expect(result.degraded).toBe(false);
  return result.output;
}

function pixel(frame: RgbaFrame, x: number, y: number): readonly number[] {
  const offset = (y * frame.width + x) * 4;
  return Array.from(frame.data.slice(offset, offset + 4));
}

function assignedDefinitions(): readonly EffectToolDefinition[] {
  return assignedToolNames.map((toolName) => {
    const definition = BATCH_02_DEFINITIONS.find((entry) => entry.toolName === toolName);
    if (definition === undefined) throw new Error(`Missing batch-02 definition ${toolName}.`);
    return definition;
  });
}

function input(definition: EffectToolDefinition, slotName = "source_frame"): AuthorizedEffectInput {
  const value = context(definition).inputs[slotName];
  if (value === undefined || Array.isArray(value)) throw new Error(`Expected one ${slotName} binding.`);
  return value as AuthorizedEffectInput;
}

function paramsAtBoundary(
  definition: EffectToolDefinition,
  propertyName: string,
  value: unknown
): Record<string, unknown> {
  const params = { ...definition.defaults, [propertyName]: value };
  if (definition.toolName === "pixel_sort" && propertyName === "lowThreshold") {
    params.highThreshold = Math.max(Number(value), Number(params.highThreshold));
  }
  if (definition.toolName === "pixel_sort" && propertyName === "highThreshold") {
    params.lowThreshold = Math.min(Number(value), Number(params.lowThreshold));
  }
  return params;
}

describe("batch-02 definitions", () => {
  it("exports the exact ten distinct tools and passes the public definition gate", () => {
    expect(BATCH_02_DEFINITIONS.map((definition) => definition.effectId)).toEqual([
      "fx.light.gradientFlow",
      "fx.light.auraField",
      "fx.post.depthOfField",
      "fx.post.chromaticAberration",
      "fx.post.filmGrain",
      "fx.post.colorGrade",
      "fx.distort.glitchSlice",
      "fx.distort.rgbSplit",
      "fx.distort.pixelSort",
      "fx.distort.datamosh"
    ]);
    expect(new Set(BATCH_02_DEFINITIONS.map((definition) => definition.toolName)).size).toBe(10);
    expect(assignedDefinitions().map((definition) => definition.toolName)).toEqual(assignedToolNames);
    for (const definition of BATCH_02_DEFINITIONS) {
      expect(() => assertEffectToolDefinition(definition)).not.toThrow();
      const schema = definition.parameterSchema as { properties: Record<string, unknown> };
      expect(Object.keys(schema.properties).some((name) => /(?:asset|resource|file|url|path|image|video|lut|depth.*map)/iu.test(name))).toBe(false);
    }
  });

  it.each(assignedDefinitions())("requires the exact selected name for $toolName", (definition) => {
    expect(() => validateAndNormalizeEffectEnvelope(
      definition,
      definition.toolName,
      { type: definition.toolName.toUpperCase(), data: definition.defaults }
    )).toThrow(expect.objectContaining({ code: "TYPE_MISMATCH" }));
    expect(() => validateAndNormalizeEffectEnvelope(
      definition,
      `${definition.toolName}_alias`,
      { type: `${definition.toolName}_alias`, data: definition.defaults }
    )).toThrow(expect.objectContaining({ code: "TYPE_MISMATCH" }));
  });

  it.each(assignedDefinitions())("enforces the closed Schema and resource separation for $toolName", (definition) => {
    expect(() => validateAndNormalizeEffectEnvelope(
      definition,
      definition.toolName,
      { type: definition.toolName, data: { ...definition.defaults, unknownParameter: true } }
    )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
    expect(() => validateAndNormalizeEffectEnvelope(
      definition,
      definition.toolName,
      { type: definition.toolName, data: { ...definition.defaults, resource_id: "resource_123456789abc" } }
    )).toThrow(expect.objectContaining({ code: "RESOURCE_INJECTION" }));
    expect(() => validateAndNormalizeEffectEnvelope(
      definition,
      definition.toolName,
      { type: definition.toolName, data: { ...definition.defaults, file_path: "D:\\media\\source.png" } }
    )).toThrow(expect.objectContaining({ code: "RESOURCE_INJECTION" }));
    const numericProperty = Object.entries((definition.parameterSchema as {
      properties: Record<string, { type?: string }>;
    }).properties).find(([, property]) => property.type === "number" || property.type === "integer")?.[0];
    expect(numericProperty).toBeDefined();
    for (const nonFinite of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => validateAndNormalizeEffectEnvelope(
        definition,
        definition.toolName,
        {
          type: definition.toolName,
          data: { ...definition.defaults, [numericProperty!]: nonFinite }
        }
      )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
    }
  });

  it.each(assignedDefinitions())("declares real server execution and explicit input slots for $toolName", (definition) => {
    const expectedSlots = definition.toolName === "datamosh"
      ? [["source_frame", "image"], ["previous_frame", "image"]]
      : definition.toolName === "depth_of_field"
        ? [["source_frame", "image"], ["depth_field", "depth-map"]]
        : [["source_frame", "image"]];
    expect(definition.inputSlots.map((slot) => [slot.name, slot.kind])).toEqual(expectedSlots);
    expect(definition.inputSlots.every((slot) => slot.required && slot.cardinality === "one")).toBe(true);
    expect(definition.primaryBackend).toEqual({
      backendId: "batch-02-server-cpu-v1",
      kind: "server-cpu",
      version: "1.0.0",
      deterministic: true
    });
    expect(definition.fallbackStrategy).toMatchObject({ kind: "reject" });
    expect(["light", "medium", "heavy", "extreme"]).toContain(definition.performanceGrade);
  });

  it.each(assignedDefinitions())("accepts exact boundaries and rejects out-of-range or off-step $toolName values", (definition) => {
    const schema = definition.parameterSchema as unknown as {
      properties: Record<string, {
        type: string;
        minimum?: number;
        maximum?: number;
        multipleOf?: number;
        enum?: readonly unknown[];
      }>;
    };
    for (const [propertyName, property] of Object.entries(schema.properties)) {
      for (const boundary of [property.minimum, property.maximum]) {
        if (boundary === undefined) continue;
        expect(() => validateAndNormalizeEffectEnvelope(
          definition,
          definition.toolName,
          { type: definition.toolName, data: paramsAtBoundary(definition, propertyName, boundary) }
        ), `${propertyName} boundary ${boundary}`).not.toThrow();
      }
      if (property.maximum !== undefined) {
        const invalid = property.maximum + (property.multipleOf ?? 1);
        expect(() => validateAndNormalizeEffectEnvelope(
          definition,
          definition.toolName,
          { type: definition.toolName, data: paramsAtBoundary(definition, propertyName, invalid) }
        ), `${propertyName} above maximum`).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
      }
      if (property.multipleOf !== undefined && property.minimum !== undefined) {
        const offStep = property.minimum + property.multipleOf / 2;
        expect(() => validateAndNormalizeEffectEnvelope(
          definition,
          definition.toolName,
          { type: definition.toolName, data: paramsAtBoundary(definition, propertyName, offStep) }
        ), `${propertyName} off step`).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
      }
      if (property.enum !== undefined) {
        for (const member of property.enum) {
          expect(() => validateAndNormalizeEffectEnvelope(
            definition,
            definition.toolName,
            { type: definition.toolName, data: paramsAtBoundary(definition, propertyName, member) }
          ), `${propertyName} enum ${String(member)}`).not.toThrow();
        }
        expect(() => validateAndNormalizeEffectEnvelope(
          definition,
          definition.toolName,
          { type: definition.toolName, data: paramsAtBoundary(definition, propertyName, "not_an_enum_member") }
        )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
      }
    }
  });

  it.each(assignedDefinitions())("requires owner-scoped, kind-correct, locked inputs for $toolName", async (definition) => {
    const validContext = context(definition);
    for (const slot of definition.inputSlots) {
      const validInput = validContext.inputs[slot.name];
      if (validInput === undefined || Array.isArray(validInput)) {
        throw new Error(`Expected one ${slot.name} binding.`);
      }
      const invalidBindings = [
        { ...validInput, tenantId: "other-tenant" },
        { ...validInput, userId: "other-user" },
        { ...validInput, kind: "texture" as const },
        { ...validInput, locked: false }
      ];
      for (const invalid of invalidBindings) {
        const inputs = { ...validContext.inputs, [slot.name]: invalid } as AuthorizedEffectInputs;
        await expect(executeSelectedEffectTool(
          definition,
          definition.toolName,
          { type: definition.toolName, data: definition.defaults },
          { ...validContext, inputs }
        )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
      }
    }
    await expect(executeSelectedEffectTool(
      definition,
      definition.toolName,
      { type: definition.toolName, data: definition.defaults },
      { ...validContext, inputs: {} }
    )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
  });

  it("renders valid bounded RGBA data and gives every algorithm a distinct result", async () => {
    const outputs = await Promise.all(BATCH_02_DEFINITIONS.map((definition) =>
      render(definition, definition.presets[1]?.params ?? definition.defaults)));
    for (const output of outputs) {
      expect(output).toMatchObject({ width, height });
      expect(output.data).toHaveLength(width * height * 4);
      expect(output.data.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)).toBe(true);
    }
    expect(new Set(outputs.map((output) => output.data.join(","))).size).toBe(10);
  });

  it("is deterministic for every effect with identical inputs and server context", async () => {
    for (const definition of BATCH_02_DEFINITIONS) {
      const first = await render(definition);
      const second = await render(definition);
      expect(second).toEqual(first);
    }
  });

  it("keeps the focus plane sharp while blurring out-of-focus depth", async () => {
    const output = await render(DEPTH_OF_FIELD_DEFINITION, {
      focusDepth: 0.45,
      focusRange: 0.12,
      blurRadius: 10,
      bokehBoost: 0.2,
      edgePreservation: 0
    });
    expect(pixel(output, 5, 3)).toEqual(pixel(source, 5, 3));
    expect(pixel(output, 0, 3)).not.toEqual(pixel(source, 0, 3));
    expect(pixel(output, 11, 3)).not.toEqual(pixel(source, 11, 3));
  });

  it("animates aura motion, preserves pulseRate zero, and wraps red hues correctly", async () => {
    const dynamicParams = {
      ...AURA_FIELD_DEFINITION.defaults,
      intensity: 0.82,
      hue: 350,
      secondaryHue: 10,
      pulseRate: 1
    };
    const renderAuraAt = async (time: number, params: Record<string, unknown>) => {
      const result = await executeSelectedEffectTool(
        AURA_FIELD_DEFINITION,
        AURA_FIELD_DEFINITION.toolName,
        { type: AURA_FIELD_DEFINITION.toolName, data: params },
        context(AURA_FIELD_DEFINITION, time)
      ) as EffectRenderResult<RgbaFrame>;
      return result.output;
    };
    const first = await renderAuraAt(0, dynamicParams);
    const later = await renderAuraAt(0.25, dynamicParams);
    expect(later.data).not.toEqual(first.data);

    const staticParams = { ...dynamicParams, pulseRate: 0 };
    expect(await renderAuraAt(1, staticParams)).toEqual(await renderAuraAt(0, staticParams));
    const center = pixel(await renderAuraAt(0, staticParams), 6, 4);
    expect(center[0]).toBeGreaterThan(center[1]!);
  });

  it("makes the documented strong aura visibly stronger than the default field", async () => {
    const lightAura = await render(AURA_FIELD_DEFINITION, {
      ...AURA_FIELD_DEFINITION.defaults,
      intensity: 0.25,
      radius: 0.42,
      softness: 0.48,
      pulseRate: 0
    });
    const strongAura = await render(AURA_FIELD_DEFINITION, {
      ...AURA_FIELD_DEFINITION.defaults,
      intensity: 0.94,
      radius: 0.42,
      softness: 0.48,
      pulseRate: 0
    });
    const meanRgbDelta = (frame: RgbaFrame): number => frame.data.reduce((sum, value, index) =>
      index % 4 === 3 ? sum : sum + Math.abs(value - source.data[index]!), 0) / (width * height * 3);
    expect(meanRgbDelta(strongAura)).toBeGreaterThan(meanRgbDelta(lightAura) * 2.5);
  });

  it("applies a real color transform and keeps its all-neutral grade unchanged", async () => {
    const neutral = await render(COLOR_GRADE_DEFINITION);
    expect(neutral.data).toEqual(source.data);
    const warm = await render(COLOR_GRADE_DEFINITION, {
      exposure: 0.4,
      contrast: 1.2,
      saturation: 1.25,
      temperature: 0.35,
      tint: 0.08,
      lift: -0.02,
      gamma: 0.9,
      gain: 1.1,
      mix: 1
    });
    expect(warm.data).not.toEqual(source.data);
    expect(pixel(warm, 5, 3)).not.toEqual(pixel(source, 5, 3));
  });

  it("uses structurally different slice, sort, and inter-frame datamosh algorithms", async () => {
    const glitch = await render(GLITCH_SLICE_DEFINITION, {
      sliceSize: 2, displacement: 5, density: 1, direction: "horizontal", channelJitter: 2, seedOffset: 4, mix: 1
    });
    const sorted = await render(PIXEL_SORT_DEFINITION, {
      direction: "horizontal", lowThreshold: 0, highThreshold: 1, minimumRun: 2, order: "ascending", mix: 1
    });
    const moshed = await render(DATAMOSH_DEFINITION, {
      blockSize: 3, carry: 1, motionX: 2, motionY: 1, corruption: 1, smear: 0.6, seedOffset: 4
    });
    expect(new Set([glitch.data.join(","), sorted.data.join(","), moshed.data.join(",")]).size).toBe(3);
    expect(moshed.data).not.toEqual(source.data);
    expect(sorted.data).not.toEqual(source.data);
  });

  it("rejects a datamosh previous frame that reuses the current frame binding", async () => {
    const validContext = context(DATAMOSH_DEFINITION);
    const sourceInput = input(DATAMOSH_DEFINITION);
    const previousInput = input(DATAMOSH_DEFINITION, "previous_frame");
    const inputs = {
      ...validContext.inputs,
      previous_frame: { ...previousInput, binding: sourceInput.binding }
    } satisfies AuthorizedEffectInputs;
    await expect(executeSelectedEffectTool(
      DATAMOSH_DEFINITION,
      DATAMOSH_DEFINITION.toolName,
      { type: DATAMOSH_DEFINITION.toolName, data: DATAMOSH_DEFINITION.defaults },
      { ...validContext, inputs }
    )).rejects.toThrow("must be independent");
  });

  it("rejects an RGBA source frame masquerading as the required depth field", async () => {
    const validContext = context(DEPTH_OF_FIELD_DEFINITION);
    const sourceInput = input(DEPTH_OF_FIELD_DEFINITION);
    const depthInput = input(DEPTH_OF_FIELD_DEFINITION, "depth_field");
    const inputs = {
      ...validContext.inputs,
      depth_field: { ...depthInput, binding: sourceInput.binding }
    } satisfies AuthorizedEffectInputs;
    await expect(executeSelectedEffectTool(
      DEPTH_OF_FIELD_DEFINITION,
      DEPTH_OF_FIELD_DEFINITION.toolName,
      { type: DEPTH_OF_FIELD_DEFINITION.toolName, data: DEPTH_OF_FIELD_DEFINITION.defaults },
      { ...validContext, inputs }
    )).rejects.toThrow("data length does not match");
  });

  it("rejects an invalid pixel-sort threshold relationship", () => {
    expect(() => validateAndNormalizeEffectEnvelope(
      PIXEL_SORT_DEFINITION,
      "pixel_sort",
      { type: "pixel_sort", data: { lowThreshold: 0.8, highThreshold: 0.2 } }
    )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
  });

  it("rejects malformed server-bound RGBA data instead of emitting invalid channels", async () => {
    const definition = COLOR_GRADE_DEFINITION;
    const invalidContext = context(definition);
    const invalidSource = { ...source, data: [...source.data] };
    invalidSource.data[0] = 300;
    const inputs = {
      source_frame: binding("source_frame", "image", invalidSource)
    } satisfies AuthorizedEffectInputs;
    await expect(executeSelectedEffectTool(
      definition,
      definition.toolName,
      { type: definition.toolName, data: definition.defaults },
      { ...invalidContext, inputs }
    )).rejects.toThrow("8-bit RGBA");
  });
});
