import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  EXISTING_EFFECT_TOOL_DEFINITIONS
} from "../../src/existing-adapters.js";
import {
  getEffectFieldSpec,
  loadEffectFieldSpec
} from "../../src/field-specs.js";
import {
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope
} from "../../src/validation.js";
import type {
  AuthorizedEffectInputs,
  EffectInputKind,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../src/types.js";

type PropertyContract = Readonly<Record<string, unknown>>;

interface ExpectedContract {
  readonly effectId: string;
  readonly properties: Readonly<Record<string, PropertyContract>>;
  readonly slots: readonly (readonly [string, EffectInputKind])[];
}

const number = (value: number, minimum: number, maximum: number, multipleOf: number) =>
  Object.freeze({ type: "number", default: value, minimum, maximum, multipleOf });
const choice = (value: string, values: readonly string[]) =>
  Object.freeze({ type: "string", default: value, enum: [...values] });
const boolean = (value: boolean) => Object.freeze({ type: "boolean", default: value });
const vector = (value: readonly [number, number], minimum = 0, maximum = 1, multipleOf = 0.01) =>
  Object.freeze({
    type: "array",
    default: [...value],
    minItems: 2,
    maxItems: 2,
    items: { type: "number", minimum, maximum, multipleOf }
  });
const text = (value: string, maxLength: number) =>
  Object.freeze({ type: "string", default: value, minLength: 0, maxLength });

const EXPECTED = Object.freeze({
  blend: {
    effectId: "fx.composite.blend",
    properties: {
      mode: choice("normal", ["normal", "multiply", "screen", "add", "difference"]),
      opacity: number(1, 0, 1, 0.01), premultiply: boolean(true), mix: number(1, 0, 1, 0.01)
    },
    slots: [["source_layer", "data"], ["overlay_layer", "image"]]
  },
  brush_reveal: {
    effectId: "fx.draw.brushReveal",
    properties: {
      size: number(0.12, 0.005, 1, 0.005), roughness: number(0.35, 0, 1, 0.01),
      progress: number(0.5, 0, 1, 0.01)
    },
    slots: [["source_frame", "image"], ["target_frame", "image"], ["brush_texture", "texture"]]
  },
  chalk_stroke: {
    effectId: "fx.draw.chalkStroke",
    properties: {
      grain: number(0.55, 0, 1, 0.01), scatter: number(0.18, 0, 1, 0.01),
      opacity: number(0.85, 0, 1, 0.01), progress: number(0.5, 0, 1, 0.01)
    },
    slots: [["vector_source", "data"]]
  },
  directional_blur: {
    effectId: "fx.post.directionalBlur",
    properties: {
      angle: number(0, -360, 360, 1), distance: number(12, 0, 128, 1),
      samples: number(8, 1, 32, 1), edgeMode: choice("clamp", ["clamp", "wrap", "mirror"])
    },
    slots: [["source_frame", "image"]]
  },
  displacement_map: {
    effectId: "fx.composite.displacementMap",
    properties: {
      xAmount: number(0.05, -1, 1, 0.005), yAmount: number(0.05, -1, 1, 0.005),
      channel: choice("luma", ["red", "green", "blue", "alpha", "luma"])
    },
    slots: [["source_layer", "data"], ["displacement_map", "texture"]]
  },
  energy_pulse: {
    effectId: "fx.light.energyPulse",
    properties: {
      center: vector([0.5, 0.5]), radius: number(0.34, 0, 2, 0.01),
      falloff: number(0.2, 0.001, 1, 0.005), rings: number(4, 1, 32, 1),
      duration: number(3, 0.1, 60, 0.1),
      centerMode: choice("coordinates", ["coordinates", "brightest", "subject_center", "subject_left", "subject_right", "subject_top", "subject_bottom"])
    },
    slots: [["source_frame", "image"]]
  },
  gaussian_blur: {
    effectId: "fx.post.gaussianBlur",
    properties: {
      radius: number(6, 0, 64, 0.5), passes: number(2, 1, 8, 1),
      edgeMode: choice("clamp", ["clamp", "wrap", "mirror"]), alphaAware: boolean(true)
    },
    slots: [["source_frame", "image"]]
  },
  handwriting: {
    effectId: "fx.draw.handwriting",
    properties: {
      text: { ...text("手写文字", 80), minLength: 1 },
      fontFamily: choice("kai", ["song", "kai", "sans"]),
      fontSize: number(72, 12, 240, 1), positionX: number(0.5, 0, 1, 0.01),
      positionY: number(0.5, 0, 1, 0.01),
      color: { ...text("#202020", 16), pattern: "^#[0-9A-Fa-f]{6}$" },
      pressure: number(0.7, 0, 1, 0.01), speedVariation: number(0.25, 0, 1, 0.01),
      progress: number(0.5, 0, 1, 0.01)
    },
    slots: [["source_image", "image"]]
  },
  ink_spread: {
    effectId: "fx.draw.inkSpread",
    properties: {
      diffusion: number(0.55, 0, 1, 0.01), edgeNoise: number(0.2, 0, 1, 0.01),
      absorption: number(0.65, 0, 1, 0.01), progress: number(0.5, 0, 1, 0.01)
    },
    slots: [["source_image", "image"]]
  },
  lens_flare: {
    effectId: "fx.light.lensFlare",
    properties: {
      source: vector([0.72, 0.28]), ghosts: number(2, 0, 8, 1),
      streak: number(0.18, 0, 1, 0.01), chromatic: number(0.03, 0, 0.5, 0.01)
    },
    slots: [["source_frame", "image"]]
  },
  liquid_wipe: {
    effectId: "fx.transition.liquidWipe",
    properties: {
      noise: number(0.16, 0, 1, 0.01), viscosity: number(0.6, 0, 1, 0.01),
      edgeGlow: number(0.25, 0, 2, 0.01), progress: number(0.5, 0, 1, 0.01)
    },
    slots: [["source_frame", "image"], ["target_frame", "image"]]
  },
  mask_reveal: {
    effectId: "fx.composite.maskReveal",
    properties: {
      progress: number(0.5, 0, 1, 0.01), feather: number(0.04, 0, 0.5, 0.005),
      invert: boolean(false)
    },
    slots: [["source_layer", "data"], ["mask_layer", "mask"]]
  },
  motion_blur: {
    effectId: "fx.post.motionBlur",
    properties: {
      shutterAngle: number(180, 0, 720, 1), samples: number(8, 1, 32, 1),
      velocity: vector([0.08, 0], -2, 2), centered: boolean(true)
    },
    slots: [["source_frame", "image"]]
  },
  neon_glow: {
    effectId: "fx.light.neonGlow",
    properties: {
      color: text("#42C8FF", 16), radius: number(0.08, 0, 0.5, 0.005),
      intensity: number(1.8, 0, 8, 0.05), flicker: number(0.12, 0, 1, 0.01)
    },
    slots: [["source_frame", "image"]]
  },
  pixel_dissolve: {
    effectId: "fx.transition.pixelDissolve",
    properties: {
      grid: number(20, 2, 128, 1), order: choice("random", ["random", "linear", "radial"]),
      seed: number(1, 0, 100000, 1), progress: number(0.5, 0, 1, 0.01)
    },
    slots: [["source_frame", "image"], ["target_frame", "image"]]
  },
  radial_blur: {
    effectId: "fx.post.radialBlur",
    properties: {
      center: vector([0.5, 0.5]), strength: number(0.16, 0, 2, 0.01),
      mode: choice("zoom", ["zoom", "spin"]), samples: number(8, 1, 32, 1)
    },
    slots: [["source_frame", "image"]]
  },
  radial_wipe: {
    effectId: "fx.transition.radialWipe",
    properties: {
      center: vector([0.5, 0.5]), startAngle: number(-90, -360, 360, 1),
      clockwise: boolean(true), progress: number(0.5, 0, 1, 0.01)
    },
    slots: [["source_frame", "image"], ["target_frame", "image"]]
  },
  scan_beam: {
    effectId: "fx.light.scanBeam",
    properties: {
      angle: number(18, -360, 360, 1), width: number(0.12, 0.005, 1, 0.005),
      softness: number(0.4, 0, 1, 0.01), speed: number(0.8, -10, 10, 0.1)
    },
    slots: [["source_frame", "image"]]
  },
  track_matte: {
    effectId: "fx.composite.trackMatte",
    properties: {
      mode: choice("alpha", ["alpha", "luma"]), invert: boolean(false),
      opacity: number(1, 0, 1, 0.01)
    },
    slots: [["source_layer", "data"], ["matte_layer", "mask"]]
  },
  wipe: {
    effectId: "fx.transition.wipe",
    properties: {
      direction: choice("left", ["left", "right", "up", "down"]),
      softness: number(0.04, 0, 0.5, 0.005), angle: number(0, -180, 180, 1),
      progress: number(0.5, 0, 1, 0.01)
    },
    slots: [["source_frame", "image"], ["target_frame", "image"]]
  }
} satisfies Readonly<Record<string, ExpectedContract>>);

const TOOL_NAMES = Object.freeze(Object.keys(EXPECTED).sort());
const SPEC_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "../../field-specs/existing-02");
const DOC_INPUT_TERMS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  blend: ["底层和上层画面由服务端绑定"],
  brush_reveal: ["服务端绑定的真实笔刷覆盖", "起始图片", "目标图片"],
  chalk_stroke: ["路径和源图形由服务端绑定"],
  directional_blur: ["服务端绑定的画面"],
  displacement_map: ["置换图和源画面由服务端绑定"],
  energy_pulse: ["源画面和动画时间由服务端绑定"],
  gaussian_blur: ["源图片或视频由服务端绑定"],
  handwriting: ["文字内容、字体栅格和书写路径由服务端"],
  ink_spread: ["源图片由服务端绑定"],
  lens_flare: ["源画面由服务端绑定"],
  liquid_wipe: ["A、B 两路素材由服务端绑定"],
  mask_reveal: ["遮罩与源画面由服务端绑定"],
  motion_blur: ["源画面和实际素材由服务端绑定"],
  neon_glow: ["源图片、文字或图形由服务端绑定"],
  pixel_dissolve: ["A、B 两路素材由服务端绑定"],
  radial_blur: ["源画面由服务端绑定"],
  radial_wipe: ["A、B 两路素材由服务端绑定"],
  scan_beam: ["源画面由服务端绑定"],
  track_matte: ["matte 和源画面由服务端绑定"],
  wipe: ["A、B 两路素材由服务端绑定"]
});
const FORBIDDEN_RESOURCE_FIELDS = new Set([
  "path", "brushTexture", "mask", "matteLayer", "map", "source_layer", "overlay_layer",
  "brush_texture", "mask_layer", "matte_layer", "displacement_map", "source_frame", "target_frame"
]);

function definitions(): ReadonlyMap<string, EffectToolDefinition> {
  return new Map(EXISTING_EFFECT_TOOL_DEFINITIONS
    .filter((definition) => TOOL_NAMES.includes(definition.toolName))
    .map((definition) => [definition.toolName, definition]));
}

function inputsFor(definition: EffectToolDefinition): AuthorizedEffectInputs {
  return Object.fromEntries(definition.inputSlots.map((slot) => [slot.name, {
    slot: slot.name,
    kind: slot.kind,
    tenantId: "tenant-existing-02",
    userId: "user-existing-02",
    locked: true as const,
    binding: { serverResourceKey: `${definition.toolName}:${slot.name}` }
  }]));
}

function contextFor(
  definition: EffectToolDefinition,
  inputs: AuthorizedEffectInputs
): ServerEffectRenderContext {
  return {
    environment: "server",
    requestId: `existing-02:${definition.toolName}`,
    tenantId: "tenant-existing-02",
    userId: "user-existing-02",
    time: 0.5,
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

function observedDefinition(definition: EffectToolDefinition): {
  readonly definition: EffectToolDefinition;
  readonly calls: { value: number };
} {
  const calls = { value: 0 };
  return {
    calls,
    definition: {
      ...definition,
      render: () => {
        calls.value += 1;
        return {
          kind: "metadata",
          backendId: definition.primaryBackend.backendId,
          output: {},
          degraded: false,
          warnings: []
        };
      }
    }
  };
}

function tableFields(markdown: string): ReadonlyMap<string, string> {
  return new Map([...markdown.matchAll(/^\| `([^`]+)` \| (?:是|否) \| ([^|]+) \|/gmu)]
    .map((match) => [match[1]!, match[2]!.trim()]));
}

function expectDocumentedProperty(field: string, property: PropertyContract, textValue: string): void {
  if (property.type === "number") {
    expect(textValue, field).toContain(`\`${String(property.minimum)}..${String(property.maximum)}\``);
    expect(textValue, field).toContain(`步长 \`${String(property.multipleOf)}\``);
  } else if (property.type === "array") {
    const items = property.items as PropertyContract;
    expect(textValue, field).toContain(`\`${String(items.minimum)}..${String(items.maximum)}\``);
    expect(textValue, field).toContain(`步长 \`${String(items.multipleOf)}\``);
  } else if (Array.isArray(property.enum)) {
    for (const value of property.enum) expect(textValue, field).toContain(`\`${String(value)}\``);
  } else if (property.type === "boolean") {
    expect(textValue, field).toContain("布尔");
  } else if (property.type === "string") {
    expect(textValue, field).toContain(String(property.maxLength));
  }
}

describe("existing-02 field specifications and adapter contracts", () => {
  it("exposes coordinate and server-fallback positioning modes for energy_pulse", () => {
    const definition = definitions().get("energy_pulse")!;
    const schema = definition.parameterSchema as unknown as {
      readonly properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    };
    expect(schema.properties.centerMode?.enum).toEqual([
      "coordinates", "brightest", "subject_center", "subject_left", "subject_right", "subject_top", "subject_bottom"
    ]);
  });

  it("maps exactly the assigned 20 snake_case tools to one independent Markdown file", async () => {
    const byToolName = definitions();
    expect([...byToolName.keys()].sort()).toEqual(TOOL_NAMES);
    expect(await readdir(SPEC_DIRECTORY).then((files) => files.filter((name) => name.endsWith(".md")).sort()))
      .toEqual(TOOL_NAMES.map((toolName) => `${toolName}.md`));

    for (const toolName of TOOL_NAMES) {
      const descriptor = getEffectFieldSpec(toolName);
      expect(descriptor).toEqual({ toolName, relativePath: `existing-02/${toolName}.md` });
      expect(await loadEffectFieldSpec(toolName))
        .toBe(await readFile(resolve(SPEC_DIRECTORY, `${toolName}.md`), "utf8"));
    }
  });

  it("matches each Registry Schema, default, range, step, enum and input-slot contract", async () => {
    const byToolName = definitions();
    for (const toolName of TOOL_NAMES) {
      const definition = byToolName.get(toolName)!;
      const expected = EXPECTED[toolName]!;
      const schema = definition.parameterSchema as {
        readonly additionalProperties: unknown;
        readonly required: readonly string[];
        readonly properties: Readonly<Record<string, PropertyContract>>;
      };
      expect(definition.effectId, toolName).toBe(expected.effectId);
      expect(schema.additionalProperties, toolName).toBe(false);
      expect(schema.properties, toolName).toEqual(expected.properties);
      expect(schema.required, toolName).toEqual(Object.keys(expected.properties));
      expect(definition.defaults, toolName).toEqual(Object.fromEntries(
        Object.entries(expected.properties).map(([name, property]) => [name, property.default])
      ));
      expect(definition.inputSlots.map((slot) => [slot.name, slot.kind]), toolName)
        .toEqual(expected.slots);
      expect(definition.inputSlots.every((slot) => slot.required && slot.cardinality === "one"), toolName)
        .toBe(true);
      expect(Object.keys(schema.properties).some((name) => FORBIDDEN_RESOURCE_FIELDS.has(name)), toolName)
        .toBe(false);

      const markdown = await loadEffectFieldSpec(toolName);
      expect(markdown, toolName).toContain(expected.effectId);
      for (const term of DOC_INPUT_TERMS[toolName]!) expect(markdown, toolName).toContain(term);
      const fields = tableFields(markdown);
      expect([...fields.keys()], toolName).toEqual(Object.keys(expected.properties));
      for (const [field, property] of Object.entries(expected.properties)) {
        expectDocumentedProperty(field, property, fields.get(field)!);
      }
      const blocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gu)];
      expect(blocks, toolName).toHaveLength(1);
      const envelope = JSON.parse(blocks[0]![1]!) as { type: string; data: Record<string, unknown> };
      expect(envelope, toolName).toEqual({ type: toolName, data: definition.defaults });
      expect(validateAndNormalizeEffectEnvelope(definition, toolName, envelope).data, toolName)
        .toEqual(definition.defaults);
    }
  });

  it("rejects unknown parameters and resource injection for all 20 tools before render", async () => {
    for (const definition of definitions().values()) {
      for (const [data, code] of [
        [{ ...definition.defaults, surprise: true }, "PARAMETER_INVALID"],
        [{ ...definition.defaults, assetId: "asset_0123456789abcdef" }, "RESOURCE_INJECTION"]
      ] as const) {
        const observed = observedDefinition(definition);
        await expect(executeSelectedEffectTool(
          observed.definition,
          definition.toolName,
          { type: definition.toolName, data },
          contextFor(definition, inputsFor(definition))
        ), definition.toolName).rejects.toMatchObject({ code });
        expect(observed.calls.value, definition.toolName).toBe(0);
      }
    }
  });

  it("keeps wrong owner, kind and lock state out of render for all 20 tools", async () => {
    for (const definition of definitions().values()) {
      const firstSlot = definition.inputSlots[0]!;
      const valid = inputsFor(definition) as Record<string, Record<string, unknown>>;
      const wrongKind: EffectInputKind = firstSlot.kind === "image" ? "data" : "image";
      for (const replacement of [
        { ...valid[firstSlot.name]!, tenantId: "another-tenant" },
        { ...valid[firstSlot.name]!, kind: wrongKind },
        { ...valid[firstSlot.name]!, locked: false }
      ]) {
        const observed = observedDefinition(definition);
        await expect(executeSelectedEffectTool(
          observed.definition,
          definition.toolName,
          { type: definition.toolName, data: definition.defaults },
          contextFor(definition, { ...valid, [firstSlot.name]: replacement } as AuthorizedEffectInputs)
        ), definition.toolName).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
        expect(observed.calls.value, definition.toolName).toBe(0);
      }
    }
  });

  it("reports every missing required server resource instead of entering render", async () => {
    for (const definition of definitions().values()) {
      for (const slot of definition.inputSlots) {
        const inputs = { ...inputsFor(definition) } as Record<string, unknown>;
        delete inputs[slot.name];
        const observed = observedDefinition(definition);
        await expect(executeSelectedEffectTool(
          observed.definition,
          definition.toolName,
          { type: definition.toolName, data: definition.defaults },
          contextFor(definition, inputs as AuthorizedEffectInputs)
        ), `${definition.toolName}:${slot.name}`).rejects.toThrow(`Required input slot ${slot.name} is not bound`);
        expect(observed.calls.value, definition.toolName).toBe(0);
      }
    }
  });

  it.todo("gives package-level authorized bindings a stable identity so direct callers can reject cross-slot reuse", async () => {
    const affected = [
      "brush_reveal", "wipe", "radial_wipe", "liquid_wipe", "pixel_dissolve",
      "mask_reveal", "track_matte", "blend", "displacement_map"
    ];
    for (const toolName of affected) {
      const definition = definitions().get(toolName)!;
      const sharedBinding = { serverResourceKey: `${toolName}:same-resource` };
      const inputs = Object.fromEntries(definition.inputSlots.map((slot) => [slot.name, {
        slot: slot.name,
        kind: slot.kind,
        tenantId: "tenant-existing-02",
        userId: "user-existing-02",
        locked: true as const,
        binding: sharedBinding
      }]));
      const observed = observedDefinition(definition);
      await expect(executeSelectedEffectTool(
        observed.definition,
        toolName,
        { type: toolName, data: definition.defaults },
        contextFor(definition, inputs)
      ), toolName).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
      expect(observed.calls.value, toolName).toBe(0);
    }
  });
});
