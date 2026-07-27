import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  EFFECT_DEFINITION_SCHEMA_VERSION,
  EngineError,
  ERROR_CODES,
  PROJECT_SCHEMA_VERSION,
  type EffectGraphDefinition,
  type JsonObject,
  type MotionProject
} from "@codemotion/core";
import {
  loadProject,
  migrateProject,
  saveProject,
  validateContract,
  type ProjectMigration
} from "../src/index.js";

async function exampleProject(): Promise<MotionProject> {
  const source = await readFile(new URL("../../../examples/minimal-project.json", import.meta.url), "utf8");
  return loadProject(source);
}

describe("project serialization", () => {
  it("loads the checked-in example and saves canonical JSON", async () => {
    const project = await exampleProject();
    const first = saveProject(project);
    const second = saveProject(loadProject(first));

    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(second).toBe(first);
  });

  it("preserves prototype-sensitive JSON keys without prototype pollution", async () => {
    const pollutionKey = "cmfxS1PrototypePollutionSentinel";
    const prototypeValueBefore = Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey);
    expect(prototypeValueBefore).toBeUndefined();
    expect(({} as Record<string, unknown>)[pollutionKey]).toBeUndefined();

    const project = await exampleProject();
    project.metadata = JSON.parse(`{
      "__proto__": { "${pollutionKey}": "top" },
      "constructor": { "kind": "top-constructor" },
      "prototype": "top-prototype",
      "nested": {
        "__proto__": { "${pollutionKey}": "nested" },
        "constructor": "nested-constructor",
        "prototype": { "kind": "nested-prototype" }
      },
      "items": [
        {
          "__proto__": { "${pollutionKey}": "array" },
          "constructor": ["array-constructor"],
          "prototype": null
        }
      ]
    }`) as JsonObject;

    const saved = saveProject(loadProject(project));
    const parsed = JSON.parse(saved) as { metadata: Record<string, unknown> };
    const nested = parsed.metadata.nested as Record<string, unknown>;
    const item = (parsed.metadata.items as Array<Record<string, unknown>>)[0];
    if (item === undefined) throw new Error("Array metadata item missing.");

    for (const [container, expected] of [
      [parsed.metadata, { [pollutionKey]: "top" }],
      [nested, { [pollutionKey]: "nested" }],
      [item, { [pollutionKey]: "array" }]
    ] as const) {
      expect(Object.hasOwn(container, "__proto__")).toBe(true);
      expect(container.__proto__).toEqual(expected);
      expect(Object.hasOwn(container, "constructor")).toBe(true);
      expect(Object.hasOwn(container, "prototype")).toBe(true);
    }
    expect(parsed.metadata.constructor).toEqual({ kind: "top-constructor" });
    expect(parsed.metadata.prototype).toBe("top-prototype");
    expect(nested.constructor).toBe("nested-constructor");
    expect(nested.prototype).toEqual({ kind: "nested-prototype" });
    expect(item.constructor).toEqual(["array-constructor"]);
    expect(item.prototype).toBeNull();

    const secondSave = saveProject(loadProject(saved));
    expect(secondSave).toBe(saved);
    expect((loadProject(secondSave).metadata as Record<string, unknown>)).toEqual(parsed.metadata);
    expect(Object.getOwnPropertyDescriptor(Object.prototype, pollutionKey)).toBeUndefined();
    expect(({} as Record<string, unknown>)[pollutionKey]).toBeUndefined();
  });

  it("reports parse, size, and schema failures with stable codes", async () => {
    expect(() => loadProject("{")) .toThrowError(expect.objectContaining({ code: ERROR_CODES.PARSE_ERROR }));
    expect(() => loadProject("{}", { maxInputBytes: 1 })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.INPUT_TOO_LARGE })
    );

    const project = await exampleProject();
    expect(() => loadProject({ ...project, width: 0 })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.SCHEMA_INVALID })
    );
  });

  it("executes only explicit migration steps", async () => {
    const current = await exampleProject();
    const legacy = { ...current, schemaVersion: "0.9.0" } as unknown as JsonObject;
    const migration: ProjectMigration = {
      fromVersion: "0.9.0",
      toVersion: PROJECT_SCHEMA_VERSION,
      migrate(project) {
        return { ...project, schemaVersion: PROJECT_SCHEMA_VERSION };
      }
    };

    expect(migrateProject(legacy, [migration]).schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(() => migrateProject(legacy)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION })
    );
  });

  it("migrates the frozen Stage 1 project schema without rewriting data", async () => {
    const current = await exampleProject();
    const stageOne = {
      ...(current as unknown as JsonObject),
      schemaVersion: "1.0.0"
    };
    const migrated = loadProject(stageOne);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.metadata).toEqual(current.metadata);
    expect(migrated.compositions).toEqual(current.compositions);
  });

  it("migrates the Stage 2 schema to Stage 3 without rewriting data", async () => {
    const current = await exampleProject();
    const stageTwo = { ...(current as unknown as JsonObject), schemaVersion: "1.1.0" };
    const migrated = loadProject(stageTwo);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(migrated.compositions).toEqual(current.compositions);
    expect(migrated.metadata).toEqual(current.metadata);
  });
});

describe("versioned contract schemas", () => {
  it("validates the versioned Effect Graph contract and Composition field", async () => {
    const graph: EffectGraphDefinition = {
      version: "1.0.0",
      outputNodeId: "output",
      nodes: [
        { id: "input", kind: "input", inputs: {}, outputs: { image: { valueType: "texture", width: 1, height: 1 } }, config: {} },
        { id: "output", kind: "output", inputs: { source: { valueType: "texture", width: 1, height: 1 } }, outputs: {}, config: {} }
      ],
      edges: [{ fromNode: "input", fromPort: "image", toNode: "output", toPort: "source" }]
    };
    expect(validateContract("EffectGraphDefinition", graph)).toMatchObject({ valid: true });
    expect(validateContract("EffectGraphDefinition", { ...graph, version: "0.9.0" })).toMatchObject({ valid: false });

    const project = await exampleProject();
    const composition = project.compositions[0];
    if (composition === undefined) throw new Error("Example composition missing.");
    expect(validateContract("CompositionDefinition", { ...composition, effectGraph: graph })).toMatchObject({ valid: true });
    expect(validateContract("Animatable", {
      mode: "expression",
      expression: {
        language: "cmfx-expression",
        source: "clamp(value, 0, 1)",
        ast: {
          type: "call",
          name: "clamp",
          arguments: [{ type: "variable", name: "value" }, { type: "literal", value: 0 }, { type: "literal", value: 1 }]
        },
        fallback: 0
      }
    })).toMatchObject({ valid: true });
  });

  it("validates every layer discriminator", async () => {
    const project = await exampleProject();
    const base = project.compositions[0]?.layers[0];
    if (base === undefined) throw new Error("Example layer missing.");

    const variants: Array<[string, JsonObject, boolean]> = [
      ["text", { text: "Title", fontFamily: "sans-serif", fontSize: 64 }, false],
      ["shape", { shapes: [] }, false],
      ["image", { fit: "cover" }, true],
      ["video", { loop: false, muted: true }, true],
      ["audio", { volume: { mode: "constant", value: 1 } }, true],
      ["svg", { svg: "<svg/>" }, false],
      ["canvas", { commands: [] }, false],
      ["particle", { emitter: {} }, false],
      ["model3d", {}, true],
      ["camera", { projection: "perspective", zoom: { mode: "constant", value: 50 } }, false],
      ["light", { lightType: "point", intensity: { mode: "constant", value: 1 }, color: { mode: "constant", value: "#fff" } }, false],
      ["adjustment", {}, false],
      ["null", {}, false],
      ["data", { data: { total: 1 } }, false],
      ["composition", { compositionId: "composition.child" }, false],
      ["custom", { pluginId: "plugin.example", data: {} }, false]
    ];

    for (const [type, properties, needsSource] of variants) {
      const layer: JsonObject = {
        ...(base as unknown as JsonObject),
        id: `layer.${type}`,
        type,
        properties
      };
      if (needsSource) layer.source = { assetId: "asset.test" };
      expect(validateContract("LayerDefinition", layer), type).toMatchObject({ valid: true });
    }
  });

  it("validates composition, animatable, keyframe, effect instance, and effect definition contracts", async () => {
    const project = await exampleProject();
    const composition = project.compositions[0];
    const layer = composition?.layers[0];
    if (composition === undefined || layer === undefined) throw new Error("Example contract missing.");

    expect(validateContract("CompositionDefinition", composition)).toMatchObject({ valid: true });
    expect(validateContract("Animatable", layer.opacity)).toMatchObject({ valid: true });
    expect(validateContract("Keyframe", { time: 1, value: 1, interpolation: "linear" })).toMatchObject({ valid: true });
    expect(validateContract("EffectInstance", {
      id: "effect.instance",
      effectId: "fx.motion.fade",
      version: "1.0.0",
      enabled: true,
      mix: { mode: "constant", value: 1 },
      params: {}
    })).toMatchObject({ valid: true });
    expect(validateContract("EffectDefinition", {
      schemaVersion: EFFECT_DEFINITION_SCHEMA_VERSION,
      effectId: "fx.motion.fade",
      version: "1.0.0",
      displayName: "Fade",
      category: "motion",
      description: "",
      tags: ["motion"],
      inputTypes: ["texture"],
      outputType: "texture",
      parameterSchema: { type: "object" },
      uiSchema: {},
      defaultPreset: {},
      renderBackends: ["webgl"],
      preferredBackend: "webgl",
      fallbackBackend: "canvas2d",
      deterministic: true,
      supportsAlpha: true,
      supportsMask: true,
      supportsKeyframes: true,
      supportsExpressions: true,
      performanceClass: "light",
      qualityLevels: [{ quality: "preview", settings: {} }],
      validationRules: [],
      migrations: []
    })).toMatchObject({ valid: true });
    expect(validateContract("EffectDefinition", {
      schemaVersion: EFFECT_DEFINITION_SCHEMA_VERSION,
      effectId: "fx.motion.invalid",
      version: "1.0.0",
      displayName: "Invalid",
      category: "motion",
      description: "",
      tags: [],
      inputTypes: [],
      outputType: "texture",
      parameterSchema: { type: "not-a-json-schema-type" },
      uiSchema: {},
      defaultPreset: {},
      renderBackends: ["webgl"],
      preferredBackend: "webgl",
      deterministic: true,
      supportsAlpha: true,
      supportsMask: false,
      supportsKeyframes: false,
      supportsExpressions: false,
      performanceClass: "light",
      qualityLevels: [],
      validationRules: [],
      migrations: []
    })).toMatchObject({ valid: false });
  });

  it("rejects an unknown layer type", async () => {
    const project = await exampleProject();
    const layer = project.compositions[0]?.layers[0];
    expect(validateContract("LayerDefinition", { ...layer, type: "unknown" })).toMatchObject({ valid: false });
  });
});
