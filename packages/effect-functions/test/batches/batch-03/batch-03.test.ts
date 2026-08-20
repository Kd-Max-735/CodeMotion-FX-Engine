import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { JsonObject } from "@codemotion/core";
import type {
  AuthorizedEffectInputs,
  EffectInputSlotDefinition,
  EffectRenderResult,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../../src/types.js";
import {
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope
} from "../../../src/validation.js";
import { BATCH_03_DEFINITIONS } from "../../../src/batches/batch-03/index.js";
import type {
  ParticleTextureBuffer,
  RgbaFrame
} from "../../../src/batches/batch-03/shared.js";

const WIDTH = 18;
const HEIGHT = 12;
const TENANT = "tenant-batch-03";
const USER = "user-batch-03";

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

function rgbaFrame(width = WIDTH, height = HEIGHT, variant = 0): RgbaFrame {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = (x * 29 + y * 7 + variant * 61) % 256;
      data[offset + 1] = (x * 11 + y * 31 + variant * 37) % 256;
      data[offset + 2] = (x * 17 + y * 19 + variant * 23) % 256;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data };
}

function bindingFor(slot: EffectInputSlotDefinition, variant = 0) {
  const isSmallTexture = slot.name === "flow_map" || slot.name === "particle_texture";
  return {
    slot: slot.name,
    kind: slot.kind,
    tenantId: TENANT,
    userId: USER,
    locked: true as const,
    binding: rgbaFrame(isSmallTexture ? 4 : WIDTH, isSmallTexture ? 4 : HEIGHT, variant)
  };
}

function inputsFor(
  definition: EffectToolDefinition,
  optionalSlots: readonly string[] = [],
  variant = 0
): AuthorizedEffectInputs {
  return Object.fromEntries(definition.inputSlots
    .filter((slot) => slot.required || optionalSlots.includes(slot.name))
    .map((slot) => [slot.name, bindingFor(slot, variant)]));
}

function contextFor(
  definition: EffectToolDefinition,
  options: {
    readonly seed?: number;
    readonly time?: number;
    readonly inputs?: AuthorizedEffectInputs;
  } = {}
): ServerEffectRenderContext {
  const time = options.time ?? 0.4;
  return {
    environment: "server",
    requestId: "request-batch-03",
    tenantId: TENANT,
    userId: USER,
    time,
    deltaTime: 1 / 30,
    frame: Math.floor(time * 30),
    fps: 30,
    width: WIDTH,
    height: HEIGHT,
    seed: options.seed ?? 7411,
    quality: "final",
    backend: definition.primaryBackend,
    inputs: options.inputs ?? inputsFor(definition)
  };
}

async function executeDefaults(
  definition: EffectToolDefinition,
  options: Parameters<typeof contextFor>[1] = {}
): Promise<EffectRenderResult> {
  return executeSelectedEffectTool(
    definition,
    definition.toolName,
    { type: definition.toolName, data: {} },
    contextFor(definition, options)
  );
}

function schemaProperties(definition: EffectToolDefinition): Record<string, Record<string, unknown>> {
  return (definition.parameterSchema as JsonObject).properties as unknown as Record<string, Record<string, unknown>>;
}

function expectFinite(value: unknown): void {
  if (typeof value === "number") {
    expect(Number.isFinite(value)).toBe(true);
    return;
  }
  if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return;
  if (ArrayBuffer.isView(value)) {
    for (const entry of value as unknown as ArrayLike<number>) expect(Number.isFinite(entry)).toBe(true);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) expectFinite(entry);
    return;
  }
  for (const entry of Object.values(value as Record<string, unknown>)) expectFinite(entry);
}

function expectParticleBuffer(output: unknown): ParticleTextureBuffer {
  const buffer = output as ParticleTextureBuffer;
  expect(buffer.format).toBe("codemotion-particle-buffer/v1");
  expect(buffer.positions).toBeInstanceOf(Float32Array);
  expect(buffer.velocities).toBeInstanceOf(Float32Array);
  expect(buffer.sizes).toBeInstanceOf(Float32Array);
  expect(buffer.opacities).toBeInstanceOf(Float32Array);
  expect(buffer.colors).toBeInstanceOf(Uint8ClampedArray);
  expect(buffer.positions).toHaveLength(buffer.count * 2);
  expect(buffer.velocities).toHaveLength(buffer.count * 2);
  expect(buffer.sizes).toHaveLength(buffer.count);
  expect(buffer.opacities).toHaveLength(buffer.count);
  expect(buffer.colors).toHaveLength(buffer.count * 4);
  return buffer;
}

describe("batch-03 definitions", () => {
  it("exports exactly the assigned ten definitions in the requested order", () => {
    expect(BATCH_03_DEFINITIONS.map(({ effectId, toolName }) => [effectId, toolName]))
      .toEqual(EXPECTED_IDENTITIES);
    expect(new Set(BATCH_03_DEFINITIONS.map(({ toolName }) => toolName)).size).toBe(10);
  });

  it("passes the shared contract with closed Schemas, exact defaults, presets, and CPU backends", () => {
    for (const definition of BATCH_03_DEFINITIONS) {
      expect(() => assertEffectToolDefinition(definition)).not.toThrow();
      expect(definition.parameterSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(definition.primaryBackend).toMatchObject({ kind: "server-cpu", deterministic: true });
      expect(definition.presets).toHaveLength(3);
      const properties = schemaProperties(definition);
      expect(Object.keys(properties)).toEqual(Object.keys(definition.defaults));
      expect(Object.keys(properties)).not.toContain("seed");
      expect(Object.keys(properties).some((name) =>
        /(?:asset|resource|file|url|path|image|texture|map)(?:Id)?$/iu.test(name))).toBe(false);
      for (const [name, value] of Object.entries(definition.defaults)) {
        expect(properties[name]?.default).toEqual(value);
      }
    }
  });

  it("requires an exact selected snake_case tool name", () => {
    for (const definition of BATCH_03_DEFINITIONS) {
      for (const mismatch of [definition.toolName.toUpperCase(), `${definition.toolName}_alias`, definition.effectId]) {
        expect(() => validateAndNormalizeEffectEnvelope(
          definition,
          definition.toolName,
          { type: mismatch, data: {} }
        )).toThrow(expect.objectContaining({ code: "TYPE_MISMATCH" }));
      }
    }
  });

  it("accepts numeric boundaries and rejects out-of-range, non-finite, fractional integer, and enum values", () => {
    for (const definition of BATCH_03_DEFINITIONS) {
      const properties = schemaProperties(definition);
      for (const [name, property] of Object.entries(properties)) {
        if ((property.type === "number" || property.type === "integer")
          && typeof property.minimum === "number" && typeof property.maximum === "number") {
          for (const boundary of [property.minimum, property.maximum]) {
            expect(() => validateAndNormalizeEffectEnvelope(
              definition,
              definition.toolName,
              { type: definition.toolName, data: { [name]: boundary } }
            )).not.toThrow();
          }
          expect(() => validateAndNormalizeEffectEnvelope(
            definition,
            definition.toolName,
            { type: definition.toolName, data: { [name]: (property.maximum as number) + 1 } }
          )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
          expect(() => validateAndNormalizeEffectEnvelope(
            definition,
            definition.toolName,
            { type: definition.toolName, data: { [name]: Number.NaN } }
          )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
          if (property.type === "integer") {
            expect(() => validateAndNormalizeEffectEnvelope(
              definition,
              definition.toolName,
              { type: definition.toolName, data: { [name]: (property.minimum as number) + 0.5 } }
            )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
          }
        }
        if (Array.isArray(property.enum)) {
          expect(() => validateAndNormalizeEffectEnvelope(
            definition,
            definition.toolName,
            { type: definition.toolName, data: { [name]: "not_a_member" } }
          )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
        }
      }
    }
  });

  it("keeps all assigned resource names in server-only input slots", async () => {
    const slotNames = new Set(BATCH_03_DEFINITIONS.flatMap((definition) =>
      definition.inputSlots.map((slot) => slot.name)));
    expect(slotNames).toEqual(new Set([
      "primary_image", "flow_map", "particle_texture", "logo_image", "target_image", "source_image",
      "background_image", "subject_mask"
    ]));
    for (const definition of BATCH_03_DEFINITIONS) {
      expect(() => validateAndNormalizeEffectEnvelope(
        definition,
        definition.toolName,
        { type: definition.toolName, data: { resource_id: "asset_0123456789abcdef" } }
      )).toThrow(expect.objectContaining({ code: "RESOURCE_INJECTION" }));
      await expect(executeSelectedEffectTool(
        definition,
        definition.toolName,
        { type: definition.toolName, data: {} },
        contextFor(definition, {
          inputs: { ...inputsFor(definition), undeclared_slot: bindingFor({
            name: "undeclared_slot", kind: "image", required: false, cardinality: "one", description: "test"
          }) }
        })
      )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
    }
  });

  it("rejects missing or cross-owner required inputs before render", async () => {
    for (const definition of BATCH_03_DEFINITIONS.filter((item) =>
      item.inputSlots.some((slot) => slot.required))) {
      const render = vi.fn(definition.render.bind(definition));
      const observed = { ...definition, render };
      await expect(executeSelectedEffectTool(
        observed,
        observed.toolName,
        { type: observed.toolName, data: {} },
        contextFor(observed, { inputs: {} })
      )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
      expect(render).not.toHaveBeenCalled();

      const requiredSlot = definition.inputSlots.find((slot) => slot.required)!;
      const crossOwner = bindingFor(requiredSlot) as ReturnType<typeof bindingFor> & { userId: string };
      crossOwner.userId = "other-user";
      await expect(executeSelectedEffectTool(
        definition,
        definition.toolName,
        { type: definition.toolName, data: {} },
        contextFor(definition, { inputs: { [requiredSlot.name]: crossOwner } })
      )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
    }
  });

  it("returns real RGBA frames for distortions and real particle buffers for particles", async () => {
    for (const definition of BATCH_03_DEFINITIONS) {
      const result = await executeDefaults(definition);
      expect(result.kind).not.toBe("metadata");
      expect(result.backendId).toBe(definition.primaryBackend.backendId);
      if (definition.category === "distort") {
        expect(result.kind).toBe("frame");
        const frame = result.output as RgbaFrame;
        expect(frame).toMatchObject({ width: WIDTH, height: HEIGHT });
        expect(frame.data).toBeInstanceOf(Uint8ClampedArray);
        expect(frame.data).toHaveLength(WIDTH * HEIGHT * 4);
        expect(result.warnings).toEqual([]);
      } else {
        expect(result.kind).toBe("texture");
        expectParticleBuffer(result.output);
        expect(result.warnings).toEqual([]);
      }
      expectFinite(result.output);
    }
  });

  it("is deterministic for the same seed/time and every tool evolves over time", async () => {
    for (const definition of BATCH_03_DEFINITIONS) {
      const first = await executeDefaults(definition, { seed: 99, time: 0.2 });
      const repeat = await executeDefaults(definition, { seed: 99, time: 0.2 });
      const evolved = await executeDefaults(definition, { seed: 99, time: 0.4 });
      expect(repeat).toEqual(first);
      expect(evolved.output).not.toEqual(first.output);
    }
  });

  it("renders distinct liquid presets and preserves visible motion for high-viscosity gel", async () => {
    const definition = BATCH_03_DEFINITIONS.find(({ toolName }) => toolName === "liquid_displace")!;
    const renderParams = async (data: JsonObject) => executeSelectedEffectTool(
      definition,
      definition.toolName,
      { type: definition.toolName, data },
      contextFor(definition, { time: 0.8 })
    );
    const glass = await renderParams({ ...definition.defaults, viscosity: 0.82, refraction: 0.18,
      flowSpeed: 0.18, surfaceTension: 0.75, chromaticDispersion: 0.02 });
    const gel = await renderParams({ ...definition.defaults, viscosity: 0.95, refraction: 0.4,
      flowSpeed: 0.08, surfaceTension: 0.9, chromaticDispersion: 0 });
    expect(glass.output).not.toEqual(gel.output);
    expect((glass.output as RgbaFrame).data).not.toEqual(rgbaFrame().data);
    expect((gel.output as RgbaFrame).data).not.toEqual(rgbaFrame().data);
  });

  it("clears a completed dissolve, assembles a logo from blank, and repeats spark bursts for its duration", async () => {
    const dissolve = BATCH_03_DEFINITIONS.find(({ toolName }) => toolName === "particle_dissolve")!;
    const dissolveMidway = await executeSelectedEffectTool(
      dissolve,
      dissolve.toolName,
      { type: dissolve.toolName, data: { ...dissolve.defaults } },
      contextFor(dissolve, { time: 1.5 })
    );
    const mask = expectParticleBuffer(dissolveMidway.output).sourceComposite?.mask;
    expect(mask).toBeInstanceOf(Uint8Array);
    expect(mask).toContain(0);
    expect(mask).toContain(255);
    const dissolveComplete = expectParticleBuffer((await executeSelectedEffectTool(
      dissolve,
      dissolve.toolName,
      { type: dissolve.toolName, data: { ...dissolve.defaults } },
      contextFor(dissolve, { time: 3 })
    )).output);
    expect(dissolveComplete.count).toBe(0);
    expect([...dissolveComplete.sourceComposite!.mask!].every((alpha) => alpha === 0)).toBe(true);

    const logo = BATCH_03_DEFINITIONS.find(({ toolName }) => toolName === "particle_logo_assemble")!;
    const logoStart = expectParticleBuffer((await executeDefaults(logo, { time: 0 })).output);
    const logoLater = expectParticleBuffer((await executeDefaults(logo, { time: 0.8 })).output);
    const logoComplete = expectParticleBuffer((await executeDefaults(logo, {
      time: logo.defaults.duration as number
    })).output);
    expect([...logoStart.opacities].every((opacity) => opacity === 0)).toBe(true);
    expect(logoStart.sourceComposite?.opacity).toBe(1);
    expect(logoStart.sourceComposite?.excludeMask).toBeInstanceOf(Uint8Array);
    expect([...logoLater.opacities].some((opacity) => opacity > 0)).toBe(true);
    expect(logoComplete.sourceComposite?.opacity).toBe(1);

    const spark = BATCH_03_DEFINITIONS.find(({ toolName }) => toolName === "particle_spark")!;
    const repeated = await executeSelectedEffectTool(
      spark,
      spark.toolName,
      { type: spark.toolName, data: { ...spark.defaults, emissionDuration: 3, burstInterval: 0.4, lifetime: 0.65 } },
      contextFor(spark, { time: 0.45 })
    );
    expect(expectParticleBuffer(repeated.output).count).toBe((spark.defaults.count as number) * 2);
  });

  it("uses trail position, trajectory, direction, and color parameters in particle output", async () => {
    const trail = BATCH_03_DEFINITIONS.find(({ toolName }) => toolName === "particle_trail")!;
    const renderParams = async (data: JsonObject) => expectParticleBuffer((await executeSelectedEffectTool(
      trail,
      trail.toolName,
      { type: trail.toolName, data },
      contextFor(trail, { time: 0.8 })
    )).output);
    const blueOrbit = await renderParams({ ...trail.defaults });
    const redLine = await renderParams({ ...trail.defaults, startX: 0.1, startY: 0.8,
      trajectory: "linear", direction: 0, hue: 0, saturation: 1 });
    const shortDuration = await renderParams({ ...trail.defaults, duration: 0.2 });
    expect(redLine.positions).not.toEqual(blueOrbit.positions);
    expect(redLine.colors).not.toEqual(blueOrbit.colors);
    expect(shortDuration.count).toBeLessThan(blueOrbit.count);
  });

  it("uses only the server seed for stochastic distortion and particle state", async () => {
    const stochastic = BATCH_03_DEFINITIONS.filter((definition) =>
      definition.toolName === "turbulent_displace"
      || definition.toolName === "liquid_displace"
      || definition.category === "particle");
    for (const definition of stochastic) {
      const first = await executeDefaults(definition, { seed: 120, time: 0.3 });
      const changed = await executeDefaults(definition, { seed: 121, time: 0.3 });
      expect(changed.output).not.toEqual(first.output);
    }
    const sourceText = BATCH_03_DEFINITIONS.map((definition) =>
      readFileSync(fileURLToPath(new URL(`../../../src/batches/batch-03/${definition.toolName.replaceAll("_", "-")}.ts`, import.meta.url)), "utf8")
    ).join("\n");
    expect(sourceText).not.toContain("Math.random");
  });

  it("consumes required pixels and gives every optional resource a deterministic omission behavior", async () => {
    for (const definition of BATCH_03_DEFINITIONS.filter((item) =>
      item.inputSlots.some((slot) => slot.required))) {
      const normal = await executeDefaults(definition);
      const changed = await executeDefaults(definition, { inputs: inputsFor(definition, [], 1) });
      if (definition.category === "particle") {
        const composite = expectParticleBuffer(normal.output).sourceComposite;
        if (composite !== undefined) expect(composite.opacity).toBeGreaterThanOrEqual(0);
        else expect(changed.output).not.toEqual(normal.output);
      } else {
        expect(changed.output).not.toEqual(normal.output);
      }
    }

    const liquid = BATCH_03_DEFINITIONS.find(({ toolName }) => toolName === "liquid_displace")!;
    const proceduralFlow = await executeDefaults(liquid);
    const boundFlow = await executeDefaults(liquid, { inputs: inputsFor(liquid, ["flow_map"], 1) });
    expect(boundFlow.output).not.toEqual(proceduralFlow.output);

    const emitter = BATCH_03_DEFINITIONS.find(({ toolName }) => toolName === "particle_emitter")!;
    const proceduralParticles = expectParticleBuffer((await executeDefaults(emitter)).output);
    const texturedParticles = expectParticleBuffer((await executeDefaults(emitter, {
      inputs: inputsFor(emitter, ["particle_texture"])
    })).output);
    expect(proceduralParticles.primitive).toBe("disc");
    expect(texturedParticles).toMatchObject({ primitive: "sprite", spriteSlot: "particle_texture" });

    const trail = BATCH_03_DEFINITIONS.find(({ toolName }) => toolName === "particle_trail")!;
    expect(expectParticleBuffer((await executeDefaults(trail)).output).sourceComposite)
      .toEqual({ slot: "source_image", opacity: 1 });
  });
});

describe("batch-03 Chinese field specifications", () => {
  it("provides one complete, executable default envelope for each tool", () => {
    for (const [, toolName] of EXPECTED_IDENTITIES) {
      const definition = BATCH_03_DEFINITIONS.find((item) => item.toolName === toolName)!;
      const path = fileURLToPath(new URL(`../../../field-specs/batch-03/${toolName}.md`, import.meta.url));
      const markdown = readFileSync(path, "utf8");
      expect(markdown).toContain(`\`${toolName}\``);
      for (const heading of [
        "## 工具作用", "## JSON 输出格式", "## 完整参数表", "## 表达映射与选择顺序",
        "## 自然语言示例", "## 推荐值、默认值和中性值", "## 服务器输入行为", "## 不适用范围"
      ]) expect(markdown).toContain(heading);
      expect(markdown).toContain("只输出");
      expect(markdown).not.toMatch(/(?:https?:\/\/|[A-Za-z]:\\\\)/u);
      const jsonBlock = markdown.match(/```json\r?\n([^\r\n]+)\r?\n```/u);
      expect(jsonBlock).not.toBeNull();
      const envelope = JSON.parse(jsonBlock![1]!) as unknown;
      expect(validateAndNormalizeEffectEnvelope(definition, toolName, envelope).data)
        .toEqual(definition.defaults);
      for (const propertyName of Object.keys(schemaProperties(definition))) {
        expect(markdown).toContain(`\`${propertyName}\``);
      }
    }
  });
});
