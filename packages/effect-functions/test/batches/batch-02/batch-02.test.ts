import { describe, expect, it } from "vitest";
import type {
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

function context(definition: EffectToolDefinition): ServerEffectRenderContext {
  const entries = definition.inputSlots.map((slot) => {
    const value = slot.name === "previous_frame" ? previous : slot.name === "depth_field" ? depth : source;
    return [slot.name, binding(slot.name, slot.kind as "image" | "depth-map", value)] as const;
  });
  return {
    environment: "server",
    requestId: "request-b02",
    tenantId: "tenant-b02",
    userId: "user-b02",
    time: 1.25,
    deltaTime: 1 / 30,
    frame: 9,
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
  return frame.data.slice(offset, offset + 4);
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
    for (const definition of BATCH_02_DEFINITIONS) {
      expect(() => assertEffectToolDefinition(definition)).not.toThrow();
      const schema = definition.parameterSchema as { properties: Record<string, unknown> };
      expect(Object.keys(schema.properties).some((name) => /(?:asset|resource|file|url|path|image|video|lut|depth.*map)/iu.test(name))).toBe(false);
    }
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
