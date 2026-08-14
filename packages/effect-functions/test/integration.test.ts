import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  makeEffectTimeSample,
  makeRealInputFixture
} from "@codemotion/effects-2d";
import {
  ALL_EFFECT_TOOL_DEFINITIONS,
  EFFECT_FIELD_SPECS,
  EFFECT_TOOL_REGISTRY,
  EXISTING_EFFECT_TOOL_DEFINITIONS,
  NEW_EFFECT_TOOL_DEFINITIONS,
  createEffectToolRegistry,
  executeSelectedEffectTool,
  loadEffectFieldSpec,
  type AuthorizedEffectInputs,
  type EffectToolDefinition,
  type ServerEffectRenderContext
} from "../src/index.js";

function contextFor(
  definition: EffectToolDefinition,
  inputs: AuthorizedEffectInputs = {},
  time = 0.5
): ServerEffectRenderContext {
  return {
    environment: "server",
    requestId: `integration-${definition.toolName}`,
    tenantId: "tenant-integration",
    userId: "user-integration",
    time,
    deltaTime: 1 / 30,
    frame: 15,
    fps: 30,
    width: 24,
    height: 16,
    seed: 20260814,
    quality: "preview",
    backend: definition.primaryBackend,
    inputs
  };
}

async function countMarkdown(directory: URL): Promise<number> {
  const items = await readdir(directory, { withFileTypes: true });
  let count = 0;
  for (const item of items) {
    if (item.isDirectory()) count += await countMarkdown(new URL(`${item.name}/`, directory));
    else if (item.isFile() && item.name.endsWith(".md") && item.name !== "README.md") count += 1;
  }
  return count;
}

describe("complete effect tool integration", () => {
  it("registers exactly 40 existing and 80 new real definitions in stable order", () => {
    expect(EXISTING_EFFECT_TOOL_DEFINITIONS).toHaveLength(40);
    expect(NEW_EFFECT_TOOL_DEFINITIONS).toHaveLength(80);
    expect(ALL_EFFECT_TOOL_DEFINITIONS).toHaveLength(120);
    expect(EFFECT_TOOL_REGISTRY.list()).toEqual(ALL_EFFECT_TOOL_DEFINITIONS);
    expect(createEffectToolRegistry().list()).toEqual(ALL_EFFECT_TOOL_DEFINITIONS);
    expect(new Set(ALL_EFFECT_TOOL_DEFINITIONS.map((item) => item.effectId)).size).toBe(120);
    expect(new Set(ALL_EFFECT_TOOL_DEFINITIONS.map((item) => item.toolName)).size).toBe(120);
  });

  it("maps every registered tool to exactly one reviewed Markdown file", async () => {
    expect(EFFECT_FIELD_SPECS).toHaveLength(120);
    expect(new Set(EFFECT_FIELD_SPECS.map((item) => item.toolName)).size).toBe(120);
    expect(new Set(EFFECT_FIELD_SPECS.map((item) => item.relativePath)).size).toBe(120);
    expect(await countMarkdown(new URL("../field-specs/", import.meta.url))).toBe(120);
    expect(new Set(EFFECT_FIELD_SPECS.map((item) => item.toolName)))
      .toEqual(new Set(ALL_EFFECT_TOOL_DEFINITIONS.map((item) => item.toolName)));
    for (const descriptor of EFFECT_FIELD_SPECS) {
      const markdown = await loadEffectFieldSpec(descriptor.toolName);
      expect(markdown.length, descriptor.relativePath).toBeGreaterThan(100);
      expect(markdown, descriptor.relativePath).toContain(`\"type\"`);
      expect(markdown, descriptor.relativePath).toContain(`\"${descriptor.toolName}\"`);
      expect(await readFile(new URL(`../field-specs/${descriptor.relativePath}`, import.meta.url), "utf8"))
        .toBe(markdown);
    }
    await expect(loadEffectFieldSpec("../existing-01/fade")).rejects.toThrow("Unknown effect tool name");
  });

  it("keeps historical resource fields out of existing model Schemas", () => {
    const forbidden = new Set([
      "path", "fromPath", "toPath", "brushTexture", "mask", "matteLayer", "map"
    ]);
    for (const definition of EXISTING_EFFECT_TOOL_DEFINITIONS) {
      const schema = definition.parameterSchema as Record<string, unknown>;
      const properties = schema.properties as Record<string, unknown>;
      expect(Object.keys(properties).some((name) => forbidden.has(name)), definition.toolName).toBe(false);
      expect(definition.inputSlots.length, definition.toolName).toBeGreaterThan(0);
    }
  });

  it("executes an existing real renderer through its adapter", async () => {
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("fade")!;
    const time = makeEffectTimeSample(definition.effectId, "existing-smoke", 0.5);
    const source = makeRealInputFixture(
      definition.effectId,
      "media",
      24,
      16,
      false,
      "srgb",
      time
    );
    const result = await executeSelectedEffectTool(
      definition,
      definition.toolName,
      { type: definition.toolName, data: definition.defaults },
      contextFor(definition, {
        source_layer: {
          slot: "source_layer",
          kind: "data",
          tenantId: "tenant-integration",
          userId: "user-integration",
          locked: true,
          binding: { surface: source.surface, rasterInput: source.input }
        }
      })
    );
    expect(result.kind).toBe("frame");
    expect((result.output as { data: Uint8ClampedArray }).data).toHaveLength(24 * 16 * 4);
  });

  it("executes a new real renderer and calls it exactly once", async () => {
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("particle_spark")!;
    let calls = 0;
    const observed = { ...definition, render: async (...args: Parameters<typeof definition.render>) => {
      calls += 1;
      return definition.render(...args);
    } } as EffectToolDefinition;
    const result = await executeSelectedEffectTool(
      observed,
      observed.toolName,
      { type: observed.toolName, data: observed.defaults },
      contextFor(observed)
    );
    expect(result.kind).toBe("metadata");
    expect(calls).toBe(1);
  });

  it("rejects missing required server input before rendering", async () => {
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("fade")!;
    let calls = 0;
    const observed = { ...definition, render: async (...args: Parameters<typeof definition.render>) => {
      calls += 1;
      return definition.render(...args);
    } } as EffectToolDefinition;
    await expect(executeSelectedEffectTool(
      observed,
      observed.toolName,
      { type: observed.toolName, data: observed.defaults },
      contextFor(observed)
    )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
    expect(calls).toBe(0);
  });
});
