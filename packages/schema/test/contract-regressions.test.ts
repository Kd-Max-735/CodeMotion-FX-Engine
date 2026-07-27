import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  EFFECT_DEFINITION_SCHEMA_VERSION,
  EngineError,
  ERROR_CODES,
  PROJECT_SCHEMA_VERSION,
  type EffectDefinition,
  type JsonObject,
  type JsonSchema,
  type MotionProject
} from "@codemotion/core";
import {
  loadProject,
  migrateProject,
  validateContract,
  type ProjectMigration
} from "../src/index.js";

async function exampleProject(): Promise<MotionProject> {
  const source = await readFile(new URL("../../../examples/minimal-project.json", import.meta.url), "utf8");
  return loadProject(source);
}

function cloneProject(project: MotionProject): MotionProject {
  return structuredClone(project);
}

function currentLayer(project: MotionProject) {
  const layer = project.compositions[0]?.layers[0];
  if (layer === undefined) throw new Error("Example layer missing.");
  return layer;
}

function setTransform(project: MotionProject, field: string, animatable: unknown): void {
  const transform = currentLayer(project).transform as unknown as Record<string, unknown>;
  transform[field] = animatable;
}

function expectInvalidProject(project: MotionProject): void {
  expect(validateContract("MotionProject", project)).toMatchObject({ valid: false });
  expect(() => loadProject(project)).toThrowError(
    expect.objectContaining({ code: ERROR_CODES.SCHEMA_INVALID })
  );
}

function effectDefinition(parameterSchema: JsonSchema): EffectDefinition {
  return {
    schemaVersion: EFFECT_DEFINITION_SCHEMA_VERSION,
    effectId: "fx.motion.contractTest",
    version: "1.0.0",
    displayName: "Contract Test",
    category: "motion",
    description: "",
    tags: [],
    inputTypes: [],
    outputType: "texture",
    parameterSchema,
    uiSchema: {},
    defaultPreset: {},
    renderBackends: ["webgl"],
    preferredBackend: "webgl",
    deterministic: true,
    supportsAlpha: true,
    supportsMask: true,
    supportsKeyframes: true,
    supportsExpressions: true,
    performanceClass: "light",
    qualityLevels: [],
    validationRules: [],
    migrations: []
  };
}

function legacyProject(project: MotionProject): JsonObject {
  return { ...(project as unknown as JsonObject), schemaVersion: "0.9.0" };
}

function captureEngineError(run: () => unknown): EngineError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(EngineError);
    return error as EngineError;
  }
  throw new Error("Expected EngineError.");
}

describe("typed Animatable schema alignment", () => {
  it("rejects string position and string opacity", async () => {
    const source = await exampleProject();
    const invalidPosition = cloneProject(source);
    setTransform(invalidPosition, "position", { mode: "constant", value: "center" });
    expectInvalidProject(invalidPosition);

    const invalidOpacity = cloneProject(source);
    (currentLayer(invalidOpacity) as unknown as Record<string, unknown>).opacity = {
      mode: "constant",
      value: "opaque"
    };
    expectInvalidProject(invalidOpacity);
  });

  it("rejects incorrect Vector2 and Vector3 dimensions", async () => {
    const source = await exampleProject();
    const missingVector3Axis = cloneProject(source);
    setTransform(missingVector3Axis, "position", { mode: "constant", value: { x: 0, y: 0 } });
    expectInvalidProject(missingVector3Axis);

    const extraVector2Axis = cloneProject(source);
    setTransform(extraVector2Axis, "skew", { mode: "constant", value: { x: 0, y: 0, z: 0 } });
    expectInvalidProject(extraVector2Axis);
  });

  it("rejects incorrectly typed keyframe values", async () => {
    const source = await exampleProject();
    const invalidPositionKeyframe = cloneProject(source);
    setTransform(invalidPositionKeyframe, "position", {
      mode: "keyframes",
      keyframes: [{ time: 0, value: 1 }]
    });
    expectInvalidProject(invalidPositionKeyframe);

    const invalidOpacityKeyframe = cloneProject(source);
    (currentLayer(invalidOpacityKeyframe) as unknown as Record<string, unknown>).opacity = {
      mode: "keyframes",
      keyframes: [{ time: 0, value: "opaque" }]
    };
    expectInvalidProject(invalidOpacityKeyframe);
  });

  it("accepts constant, keyframes, expression, and binding for typed values", async () => {
    const source = await exampleProject();
    const positionVariants: unknown[] = [
      { mode: "constant", value: { x: 1, y: 2, z: 3 } },
      { mode: "keyframes", keyframes: [{ time: 0, value: { x: 1, y: 2, z: 3 } }] },
      { mode: "expression", expression: { language: "cmfx-expression", source: "valueAtTime(0)" } },
      { mode: "binding", source: { source: "scene", path: "camera.position" } }
    ];
    const numberVariants: unknown[] = [
      { mode: "constant", value: 1 },
      { mode: "keyframes", keyframes: [{ time: 0, value: 0 }, { time: 1, value: 1 }] },
      { mode: "expression", expression: { language: "cmfx-expression", source: "clamp(time, 0, 1)" } },
      { mode: "binding", source: { source: "variable", path: "opacity" } }
    ];

    for (const position of positionVariants) {
      const project = cloneProject(source);
      setTransform(project, "position", position);
      expect(validateContract("MotionProject", project)).toMatchObject({ valid: true });
    }
    for (const opacity of numberVariants) {
      const project = cloneProject(source);
      (currentLayer(project) as unknown as Record<string, unknown>).opacity = opacity;
      expect(validateContract("MotionProject", project)).toMatchObject({ valid: true });
    }
  });

  it("enforces every strongly typed Animatable call site", async () => {
    const source = await exampleProject();

    for (const field of ["anchorPoint", "scale", "rotation"]) {
      const project = cloneProject(source);
      setTransform(project, field, { mode: "constant", value: "invalid" });
      expectInvalidProject(project);
    }

    const maskProject = cloneProject(source);
    (currentLayer(maskProject) as unknown as Record<string, unknown>).masks = [{
      id: "mask.test",
      name: "Mask",
      enabled: true,
      mode: "add",
      inverted: false,
      path: { mode: "constant", value: "M0 0" },
      opacity: { mode: "constant", value: "invalid" },
      feather: { mode: "constant", value: { x: 0, y: 0 } }
    }];
    expectInvalidProject(maskProject);

    const featherProject = cloneProject(source);
    (currentLayer(featherProject) as unknown as Record<string, unknown>).masks = [{
      id: "mask.test",
      name: "Mask",
      enabled: true,
      mode: "add",
      inverted: false,
      path: { mode: "constant", value: "M0 0" },
      opacity: { mode: "constant", value: 1 },
      feather: { mode: "constant", value: { x: 0, y: 0, z: 0 } }
    }];
    expectInvalidProject(featherProject);

    const effectProject = cloneProject(source);
    (currentLayer(effectProject) as unknown as Record<string, unknown>).effects = [{
      id: "effect.test",
      effectId: "fx.motion.fade",
      version: "1.0.0",
      enabled: true,
      mix: { mode: "constant", value: "invalid" },
      params: {}
    }];
    expectInvalidProject(effectProject);

    const audioTrackProject = cloneProject(source);
    (audioTrackProject.audioTracks as unknown as unknown[]).push({
      id: "audio.test",
      assetId: "asset.audio",
      startTime: 0,
      endTime: 1,
      volume: { mode: "constant", value: "invalid" }
    });
    expectInvalidProject(audioTrackProject);

    const base = currentLayer(source) as unknown as JsonObject;
    const typedLayerCases: unknown[] = [
      { ...base, type: "audio", source: { assetId: "asset.audio" }, properties: { volume: { mode: "constant", value: "invalid" } } },
      { ...base, type: "camera", properties: { projection: "perspective", zoom: { mode: "constant", value: "invalid" } } },
      { ...base, type: "light", properties: { lightType: "point", intensity: { mode: "constant", value: "invalid" }, color: { mode: "constant", value: "#fff" } } },
      { ...base, type: "light", properties: { lightType: "point", intensity: { mode: "constant", value: 1 }, color: { mode: "constant", value: 42 } } }
    ];
    for (const layer of typedLayerCases) {
      expect(validateContract("LayerDefinition", layer)).toMatchObject({ valid: false });
    }
  });
});

describe("JsonSchema public type alignment", () => {
  it("accepts true, false, and object parameter schemas", () => {
    const typedSchemas: EffectDefinition["parameterSchema"][] = [true, false, { type: "object" }];
    const publicSchemas: JsonSchema[] = typedSchemas;

    for (const parameterSchema of publicSchemas) {
      expect(validateContract("EffectDefinition", effectDefinition(parameterSchema))).toMatchObject({ valid: true });
    }
  });

  it("does not widen uiSchema or defaultPreset to booleans", () => {
    expect(validateContract("EffectDefinition", { ...effectDefinition({}), uiSchema: true })).toMatchObject({ valid: false });
    expect(validateContract("EffectDefinition", { ...effectDefinition({}), defaultPreset: false })).toMatchObject({ valid: false });
  });
});

describe("migration failure normalization", () => {
  it("wraps ordinary and EngineError callback failures", async () => {
    const legacy = legacyProject(await exampleProject());
    const ordinaryCause = new Error("sensitive ordinary failure");
    const engineCause = new EngineError(ERROR_CODES.SCHEMA_INVALID, "sensitive engine failure");

    for (const cause of [ordinaryCause, engineCause]) {
      const migration: ProjectMigration = {
        fromVersion: "0.9.0",
        toVersion: PROJECT_SCHEMA_VERSION,
        migrate() {
          throw cause;
        }
      };
      const error = captureEngineError(() => migrateProject(legacy, [migration]));
      expect(error.code).toBe(ERROR_CODES.MIGRATION_FAILED);
      expect(error.cause).toBe(cause);
    }
  });

  it("rejects non-object callback results as migration failures", async () => {
    const legacy = legacyProject(await exampleProject());
    for (const result of [null, [], 7, "invalid"]) {
      const migration: ProjectMigration = {
        fromVersion: "0.9.0",
        toVersion: PROJECT_SCHEMA_VERSION,
        migrate: () => result as unknown as JsonObject
      };
      expect(captureEngineError(() => migrateProject(legacy, [migration])).code).toBe(
        ERROR_CODES.MIGRATION_FAILED
      );
    }
  });

  it("rejects missing, non-string, and unexpected result versions", async () => {
    const legacy = legacyProject(await exampleProject());
    for (const resultVersion of [undefined, 7, "0.8.0"]) {
      const migration: ProjectMigration = {
        fromVersion: "0.9.0",
        toVersion: PROJECT_SCHEMA_VERSION,
        migrate(project) {
          const result = { ...project };
          if (resultVersion === undefined) {
            delete result.schemaVersion;
          } else {
            result.schemaVersion = resultVersion;
          }
          return result;
        }
      };
      expect(captureEngineError(() => migrateProject(legacy, [migration])).code).toBe(
        ERROR_CODES.MIGRATION_FAILED
      );
    }
  });

  it("normalizes a migration chain cycle", async () => {
    const legacy = legacyProject(await exampleProject());
    const migrations: ProjectMigration[] = [
      {
        fromVersion: "0.9.0",
        toVersion: "0.8.0",
        migrate: (project) => ({ ...project, schemaVersion: "0.8.0" })
      },
      {
        fromVersion: "0.8.0",
        toVersion: "0.9.0",
        migrate: (project) => ({ ...project, schemaVersion: "0.9.0" })
      }
    ];

    expect(captureEngineError(() => migrateProject(legacy, migrations)).code).toBe(
      ERROR_CODES.MIGRATION_FAILED
    );
  });

  it("keeps an unregistered input version as unsupported", async () => {
    const legacy = legacyProject(await exampleProject());
    expect(captureEngineError(() => migrateProject(legacy)).code).toBe(
      ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION
    );
  });
});
