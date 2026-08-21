import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeEffectTimeSample, makeRealInputFixture } from "@codemotion/effects-2d";
import {
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope
} from "../../src/validation.js";
import {
  getEffectFieldSpec,
  loadEffectFieldSpec
} from "../../src/field-specs.js";
import { EXISTING_EFFECT_TOOL_DEFINITIONS } from "../../src/existing-adapters.js";
import type {
  EffectToolContractError,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../src/types.js";

const TOOL_NAMES = Object.freeze([
  "bounce",
  "character_cascade",
  "elastic",
  "fade",
  "float",
  "kinetic_typography",
  "path_morph",
  "path_trim",
  "radial_burst",
  "rotate_in",
  "scale_pop",
  "scramble_decode",
  "shake",
  "shape_repeater",
  "slide",
  "text_extrude_3d",
  "text_morph",
  "text_path_reveal",
  "typewriter",
  "word_explode"
] as const);

type Existing01ToolName = (typeof TOOL_NAMES)[number];

const EXPECTED_INPUT_SLOTS: Readonly<Record<Existing01ToolName, readonly string[]>> = Object.freeze({
  bounce: ["source_layer"],
  character_cascade: ["source_image"],
  elastic: ["source_layer"],
  fade: ["source_layer"],
  float: ["source_layer"],
  kinetic_typography: ["source_image"],
  path_morph: ["source_frame", "target_frame"],
  path_trim: ["source_image", "subject_mask"],
  radial_burst: ["vector_source"],
  rotate_in: ["source_layer"],
  scale_pop: ["source_layer"],
  scramble_decode: ["source_image"],
  shake: ["source_layer"],
  shape_repeater: ["vector_source"],
  slide: ["source_layer"],
  text_extrude_3d: ["text_raster"],
  text_morph: ["source_image"],
  text_path_reveal: ["source_image", "motion_path"],
  typewriter: ["source_image"],
  word_explode: ["source_image"]
});

const STRUCTURED_RESOURCE_TOOLS = Object.freeze([
  "radial_burst",
  "shape_repeater",
  "text_extrude_3d"
] as const satisfies readonly Existing01ToolName[]);

const specDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../field-specs/existing-01"
);

function definitionFor(toolName: Existing01ToolName): EffectToolDefinition {
  const definition = EXISTING_EFFECT_TOOL_DEFINITIONS.find((item) => item.toolName === toolName);
  expect(definition, `${toolName} must be registered`).toBeDefined();
  return definition!;
}

function contextFor(definition: EffectToolDefinition): ServerEffectRenderContext {
  return {
    environment: "server",
    requestId: `existing-01-${definition.toolName}`,
    tenantId: "tenant-existing-01",
    userId: "user-existing-01",
    time: 0.5,
    deltaTime: 1 / 30,
    frame: 15,
    fps: 30,
    width: 24,
    height: 16,
    seed: 20260814,
    quality: "preview",
    backend: definition.primaryBackend,
    inputs: {}
  };
}

function jsonExample(markdown: string, toolName: string): { type: string; data: Record<string, unknown> } {
  const blocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gu)];
  expect(blocks, `${toolName} JSON example count`).toHaveLength(1);
  return JSON.parse(blocks[0]![1]!) as { type: string; data: Record<string, unknown> };
}

function expectContractError(action: () => unknown, code: EffectToolContractError["code"]): void {
  expect(action).toThrow(expect.objectContaining({ code }));
}

interface PropertySchema {
  readonly type?: string;
  readonly default?: unknown;
  readonly enum?: readonly unknown[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly multipleOf?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly items?: PropertySchema;
}

function jsonText(value: unknown): string {
  return JSON.stringify(value);
}

function documentedValue(value: unknown): string {
  return typeof value === "string" ? value : jsonText(value);
}

describe("existing-01 registry and field specifications", () => {
  it("resolves exactly the assigned twenty tool names from the integrated Registry", async () => {
    const { EFFECT_TOOL_REGISTRY } = await import("../../src/registry.js");
    const files = readdirSync(specDirectory).filter((name) => name.endsWith(".md")).sort();
    expect(files).toEqual(TOOL_NAMES.map((toolName) => `${toolName}.md`).sort());
    for (const toolName of TOOL_NAMES) {
      const definition = definitionFor(toolName);
      expect(definition.toolName).toBe(toolName);
      expect(EFFECT_TOOL_REGISTRY.list().filter((item) => item.toolName === toolName)).toEqual([definition]);
      expect(() => assertEffectToolDefinition(definition)).not.toThrow();
    }
  });

  it("loads each selected tool's one independent Chinese Markdown file", async () => {
    for (const toolName of TOOL_NAMES) {
      const descriptor = getEffectFieldSpec(toolName);
      expect(descriptor).toEqual({
        toolName,
        relativePath: `existing-01/${toolName}.md`
      });
      const loaded = await loadEffectFieldSpec(toolName);
      expect(loaded).toBe(readFileSync(join(specDirectory, `${toolName}.md`), "utf8"));
      expect(loaded).toMatch(/[\u3400-\u9fff]/u);
      expect(jsonExample(loaded, toolName).type).toBe(toolName);
    }
    expect(getEffectFieldSpec("Fade")).toBeUndefined();
    await expect(loadEffectFieldSpec("../existing-01/fade"))
      .rejects.toThrow("Unknown effect tool name");
  });

  it("keeps every specification example exactly aligned with Schema and defaults", () => {
    for (const toolName of TOOL_NAMES) {
      const definition = definitionFor(toolName);
      const markdown = readFileSync(join(specDirectory, `${toolName}.md`), "utf8");
      const example = jsonExample(markdown, toolName);
      const schema = definition.parameterSchema as {
        type?: unknown;
        additionalProperties?: unknown;
        required?: readonly string[];
        properties?: Readonly<Record<string, unknown>>;
      };
      expect(Object.keys(example)).toEqual(["type", "data"]);
      expect(example.data, `${toolName} JSON data must equal defaults`).toEqual(definition.defaults);
      expect(schema.type, toolName).toBe("object");
      expect(schema.additionalProperties, toolName).toBe(false);
      expect(Object.keys(schema.properties ?? {}).sort(), toolName)
        .toEqual(Object.keys(definition.defaults).sort());
      expect([...(schema.required ?? [])].sort(), toolName)
        .toEqual(Object.keys(definition.defaults).sort());
      expect(validateAndNormalizeEffectEnvelope(
        definition,
        toolName,
        example
      )).toEqual({ type: toolName, data: definition.defaults });
    }
  });

  it("matches every documented field range, step, enum, and default to the runtime Schema", () => {
    for (const toolName of TOOL_NAMES) {
      const definition = definitionFor(toolName);
      const markdown = readFileSync(join(specDirectory, `${toolName}.md`), "utf8");
      const properties = (definition.parameterSchema as {
        properties?: Readonly<Record<string, PropertySchema>>;
      }).properties ?? {};
      for (const [name, property] of Object.entries(properties)) {
        const fieldRow = markdown.split(/\r?\n/u)
          .find((line) => line.startsWith(`| \`${name}\` |`));
        expect(fieldRow, `${toolName}.${name} field row`).toBeDefined();
        expect(property.default, `${toolName}.${name} Schema default`)
          .toEqual(definition.defaults[name]);
        expect(fieldRow, `${toolName}.${name} documented default`)
          .toContain(`默认 \`${documentedValue(property.default)}\``);
        if (property.enum !== undefined) {
          for (const member of property.enum) {
            expect(fieldRow, `${toolName}.${name} enum ${jsonText(member)}`)
              .toContain(`\`${String(member)}\``);
          }
        }
        if (property.minimum !== undefined && property.maximum !== undefined) {
          expect(fieldRow, `${toolName}.${name} range`)
            .toContain(`\`${property.minimum}..${property.maximum}\``);
        }
        if (property.multipleOf !== undefined) {
          if (property.multipleOf === 1 && fieldRow!.includes("整数")) {
            expect(fieldRow, `${toolName}.${name} integer step`).toContain("整数");
          } else {
            expect(fieldRow, `${toolName}.${name} step`)
              .toContain(`步长 \`${property.multipleOf}\``);
          }
        }
        if (property.maxLength !== undefined) {
          expect(fieldRow, `${toolName}.${name} maximum length`)
            .toContain(`最长 ${property.maxLength}`);
        }
        if (property.minLength !== undefined && property.minLength > 0) {
          expect(fieldRow, `${toolName}.${name} minimum length`).toContain("非空字符串");
        }
        if (property.type === "array") {
          expect(property.minItems, `${toolName}.${name} minItems`).toBe(2);
          expect(property.maxItems, `${toolName}.${name} maxItems`).toBe(2);
          expect(fieldRow, `${toolName}.${name} two-item tuple`).toContain("两元素数组");
          if (property.items?.minimum !== undefined && property.items.maximum !== undefined) {
            expect(fieldRow, `${toolName}.${name} item range`)
              .toContain(`每项 \`${property.items.minimum}..${property.items.maximum}\``);
          }
        }
      }
    }
  });

  it("documents the exact server input slots and excludes them from model parameters", () => {
    const resourceFieldNames = new Set([
      "source_layer", "text_raster", "vector_source", "motion_path", "morph_paths",
      "sourceLayer", "textRaster", "vectorSource", "motionPath", "morphPaths",
      "assetId", "resourceId", "fileId", "filePath", "url", "uri", "fontId", "textureId"
    ]);
    for (const toolName of TOOL_NAMES) {
      const definition = definitionFor(toolName);
      const markdown = readFileSync(join(specDirectory, `${toolName}.md`), "utf8");
      const propertyNames = Object.keys(
        (definition.parameterSchema as { properties?: Record<string, unknown> }).properties ?? {}
      );
      expect(definition.inputSlots.map((slot) => slot.name), toolName)
        .toEqual(EXPECTED_INPUT_SLOTS[toolName]);
      for (const slot of definition.inputSlots) {
        expect(slot.required, `${toolName}.${slot.name}`).toBe(true);
        expect(slot.cardinality, `${toolName}.${slot.name}`).toBe("one");
        expect(markdown, `${toolName} must document ${slot.name}`).toContain(`\`${slot.name}\``);
      }
      expect(propertyNames.filter((name) => resourceFieldNames.has(name)), toolName).toEqual([]);
      expect(Object.keys(jsonExample(markdown, toolName).data)
        .filter((name) => resourceFieldNames.has(name)), toolName).toEqual([]);
    }
  });

  it("documents rotate speed through duration without coupling it to angle", () => {
    const definition = definitionFor("rotate_in");
    const markdown = readFileSync(join(specDirectory, "rotate_in.md"), "utf8");
    const properties = (definition.parameterSchema as {
      properties?: Readonly<Record<string, unknown>>;
    }).properties ?? {};
    expect(Object.keys(properties)).toEqual(["angle", "pivot", "blur", "turns", "duration"]);
    expect(markdown).toContain("旋转速度");
    expect(markdown).toContain("duration");
    expect(definition.defaults.turns).toBe(2);
    expect(definition.defaults.duration).toBe(1.2);
  });
});

describe("existing-01 execution safety", () => {
  it("renders real source and target glyphs and a server-derived path over one uploaded background", async () => {
    const width = 160; const height = 90;
    const surface = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: "srgb" as const,
      alphaMode: "straight" as const
    };
    const bindingFor = (definition: EffectToolDefinition) => ({
      surface,
      rasterInput: makeRealInputFixture(
        definition.effectId,
        "media",
        width,
        height,
        false,
        "srgb",
        makeEffectTimeSample(definition.effectId, `text-${definition.toolName}`, 0)
      ).input
    });
    const authorized = (slot: string, kind: "image" | "data", binding: unknown) => ({
      slot,
      kind,
      tenantId: "tenant-existing-01",
      userId: "user-existing-01",
      locked: true as const,
      binding
    });

    const morph = definitionFor("text_morph");
    const morphInputs = {
      source_image: authorized("source_image", "image", bindingFor(morph))
    };
    const morphAt = async (time: number) => (await morph.render({
      ...contextFor(morph),
      time,
      width,
      height,
      inputs: morphInputs
    }, morph.defaults)).output as typeof surface;
    const sourceGlyphs = await morphAt(0);
    const targetGlyphs = await morphAt(morph.defaults.duration as number);
    expect(Buffer.from(sourceGlyphs.data)).not.toEqual(Buffer.from(targetGlyphs.data));
    expect(sourceGlyphs.data.some((value, offset) => offset % 4 === 3 && value > 0)).toBe(true);
    expect(targetGlyphs.data.some((value, offset) => offset % 4 === 3 && value > 0)).toBe(true);

    const path = definitionFor("text_path_reveal");
    const pathInputs = {
      source_image: authorized("source_image", "image", bindingFor(path)),
      motion_path: authorized("motion_path", "data", { path: "M 0.08 0.62 C 0.3 0.18 0.7 0.82 0.92 0.38" })
    };
    const pathAt = async (time: number) => (await path.render({
      ...contextFor(path),
      time,
      width,
      height,
      inputs: pathInputs
    }, { ...path.defaults, progress: 1 })).output as typeof surface;
    const hidden = await pathAt(0);
    const revealed = await pathAt(path.defaults.duration as number);
    const alphaCount = (data: Uint8ClampedArray) => data.filter((value, offset) => offset % 4 === 3 && value > 0).length;
    expect(alphaCount(hidden.data)).toBe(0);
    expect(alphaCount(revealed.data)).toBeGreaterThan(0);
  }, 20_000);

  it("moves every word_explode glyph independently away from the text center", async () => {
    const definition = definitionFor("word_explode");
    const width = 320;
    const height = 180;
    const surface = {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: "srgb" as const,
      alphaMode: "straight" as const
    };
    const rasterInput = makeRealInputFixture(
      definition.effectId,
      "media",
      width,
      height,
      false,
      "srgb",
      makeEffectTimeSample(definition.effectId, "word-explode-characters", 0)
    ).input;
    const inputs = {
      source_image: {
        slot: "source_image",
        kind: "image" as const,
        tenantId: "tenant-existing-01",
        userId: "user-existing-01",
        locked: true as const,
        binding: { surface, rasterInput }
      }
    };
    const renderAt = async (time: number) => (await definition.render({
      ...contextFor(definition),
      time,
      width,
      height,
      inputs
    }, {
      ...definition.defaults,
      text: "ABCD",
      selector: "character",
      force: 0.45,
      rotation: 0,
      depth: 0
    })).output as typeof surface;
    const alphaBounds = (frame: typeof surface) => {
      let left = width;
      let right = -1;
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        if (frame.data[(y * width + x) * 4 + 3]! < 24) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
      return { left, right, width: right >= left ? right - left + 1 : 0 };
    };
    const initial = alphaBounds(await renderAt(0));
    const explodedFrame = await renderAt(0.65);
    const exploded = alphaBounds(explodedFrame);
    expect(initial.width).toBeGreaterThan(0);
    expect(exploded.left).toBeLessThan(initial.left);
    expect(exploded.right).toBeGreaterThan(initial.right);
    expect(exploded.width).toBeGreaterThan(initial.width + 20);
    expect(Buffer.from((await renderAt(0.65)).data)).toEqual(Buffer.from(explodedFrame.data));
    const selector = ((definition.parameterSchema as { properties: Record<string, unknown> }).properties.selector);
    expect(selector).toMatchObject({ default: "character", enum: ["character"] });
  }, 20_000);

  it("rejects unknown model parameters and resource identities for every tool", () => {
    for (const toolName of TOOL_NAMES) {
      const definition = definitionFor(toolName);
      expectContractError(() => validateAndNormalizeEffectEnvelope(
        definition,
        toolName,
        { type: toolName, data: { ...definition.defaults, unexpected: true } }
      ), "PARAMETER_INVALID");
      expectContractError(() => validateAndNormalizeEffectEnvelope(
        definition,
        toolName,
        { type: toolName, data: { ...definition.defaults, resource_id: "asset_0123456789abcdef01234567" } }
      ), "RESOURCE_INJECTION");
    }
  });

  it("does not execute a different or case-folded tool name", async () => {
    for (const toolName of TOOL_NAMES) {
      const definition = definitionFor(toolName);
      let renderCalls = 0;
      const observed = {
        ...definition,
        render: (...args: Parameters<typeof definition.render>) => {
          renderCalls += 1;
          return definition.render(...args);
        }
      } as EffectToolDefinition;
      for (const wrongName of [`${toolName}_other`, toolName.toUpperCase()]) {
        await expect(executeSelectedEffectTool(
          observed,
          wrongName,
          { type: wrongName, data: definition.defaults },
          contextFor(observed)
        )).rejects.toMatchObject({ code: "TYPE_MISMATCH" });
      }
      expect(renderCalls, toolName).toBe(0);
    }
  });

  it("reports missing required server resources before any renderer call", async () => {
    for (const toolName of TOOL_NAMES) {
      const definition = definitionFor(toolName);
      let renderCalls = 0;
      const observed = {
        ...definition,
        render: (...args: Parameters<typeof definition.render>) => {
          renderCalls += 1;
          return definition.render(...args);
        }
      } as EffectToolDefinition;
      await expect(executeSelectedEffectTool(
        observed,
        toolName,
        { type: toolName, data: definition.defaults },
        contextFor(observed)
      )).rejects.toMatchObject({
        code: "INPUT_AUTHORIZATION_INVALID",
        message: expect.stringContaining(`Required input slot ${definition.inputSlots[0]!.name} is not bound`)
      });
      expect(renderCalls, toolName).toBe(0);
    }
  });

  it("rejects an uploaded image masquerading as text, path, shape, or 3D font input", async () => {
    for (const toolName of STRUCTURED_RESOURCE_TOOLS) {
      const definition = definitionFor(toolName);
      let renderCalls = 0;
      const observed = {
        ...definition,
        render: (...args: Parameters<typeof definition.render>) => {
          renderCalls += 1;
          return definition.render(...args);
        }
      } as EffectToolDefinition;
      const inputs = Object.fromEntries(definition.inputSlots.map((slot, index) => [
        slot.name,
        {
          slot: slot.name,
          kind: index === 0 ? "image" : slot.kind,
          tenantId: "tenant-existing-01",
          userId: "user-existing-01",
          locked: true,
          binding: { uploadedImage: true }
        }
      ]));
      await expect(executeSelectedEffectTool(
        observed,
        toolName,
        { type: toolName, data: definition.defaults },
        { ...contextFor(observed), inputs }
      )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
      expect(renderCalls, toolName).toBe(0);
    }
  });
});
