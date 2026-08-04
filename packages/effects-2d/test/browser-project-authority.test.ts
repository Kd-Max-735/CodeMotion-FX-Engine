import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  PROJECT_SCHEMA_VERSION,
  type Animatable,
  type JsonValue,
  type MotionProject,
  type Vector3
} from "@codemotion/core";
import * as EffectsRoot from "../src/index.js";
import {
  P0_BROWSER_PROJECT_AUTHORITY_V1,
  P0_EFFECTS,
  P0_EFFECTS_BY_ID
} from "../src/index.js";
import {
  BROWSER_PROJECT_CONTRACT,
  type BrowserProjectConstraintsV1,
  type BrowserProjectEnvelopeV1,
  type TransportValidationResultV1
} from "@codemotion/schema";

const constant = <T extends JsonValue>(value: T): Animatable<T> => ({ mode: "constant", value });
const vector = (x: number, y: number, z = 0): Animatable<Vector3> => constant({ x, y, z });
const constraints: BrowserProjectConstraintsV1 = {
  style: [],
  brand: {
    colors: [],
    tone: [],
    requiredText: ["CodeMotion"],
    forbiddenContent: [],
    logoAssetIds: []
  }
};

function envelope(effectIndex = 0): BrowserProjectEnvelopeV1 {
  const definition = P0_EFFECTS[effectIndex]!;
  const project: MotionProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    id: "project.authority",
    name: "Authority project",
    width: 640,
    height: 360,
    fps: 30,
    duration: 2,
    background: { type: "transparent" },
    colorSpace: "srgb",
    seed: 7,
    assets: [],
    compositions: [{
      id: "composition.main",
      name: "Main",
      width: 640,
      height: 360,
      duration: 2,
      layers: [{
        id: "layer.text",
        type: "text",
        name: "CodeMotion",
        visible: true,
        locked: false,
        solo: false,
        startTime: 0,
        endTime: 2,
        inPoint: 0,
        outPoint: 2,
        zIndex: 0,
        transform: {
          anchorPoint: vector(0, 0),
          position: vector(0, 0),
          scale: vector(100, 100, 100),
          rotation: vector(0, 0, 0)
        },
        opacity: constant(1),
        blendMode: "normal",
        masks: [],
        effects: [{
          id: `effect.${definition.sourceId}`,
          effectId: definition.effectId,
          version: definition.version,
          enabled: true,
          mix: constant(1),
          params: structuredClone(definition.defaultPreset)
        }],
        properties: {
          text: "CodeMotion",
          fontFamily: "Codemotion Planner Unicode Bitmap",
          fontSize: 64
        }
      }]
    }],
    fonts: [{ id: "font.codemotion.unicode-bitmap-v1", family: "Codemotion Planner Unicode Bitmap" }],
    audioTracks: [],
    renderPresets: [],
    metadata: { timeContractVersion: "1.1.0" }
  };
  return { contract: BROWSER_PROJECT_CONTRACT, project, constraints: structuredClone(constraints) };
}

function validateWithExtraArgument(
  value: unknown,
  injected: unknown
): TransportValidationResultV1<BrowserProjectEnvelopeV1> {
  const method = P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope as unknown as (
    candidate: unknown,
    replacement: unknown
  ) => TransportValidationResultV1<BrowserProjectEnvelopeV1>;
  return method(value, injected);
}

describe("P0 browser project production authority", () => {
  it("binds and freezes the one real 40-entry authority at module initialization", async () => {
    expect(P0_EFFECTS).toHaveLength(40);
    expect(P0_EFFECTS_BY_ID.size).toBe(40);
    expect(P0_EFFECTS[0]?.sourceId).toBe("M01");
    expect(P0_EFFECTS[15]?.sourceId).toBe("T08");
    expect(P0_EFFECTS[15]?.effectId).toBe("fx.text.textExtrude3D");
    expect(P0_EFFECTS[39]?.sourceId).toBe("H04");
    for (const definition of P0_EFFECTS) {
      expect(P0_EFFECTS_BY_ID.get(definition.effectId)).toBe(definition);
      expect(definition.version).toMatch(/^\d+\.\d+\.\d+$/u);
      expect(definition.parameterSchema).toBeDefined();
    }
    expect(Object.isFrozen(P0_BROWSER_PROJECT_AUTHORITY_V1)).toBe(true);
    for (const method of Object.values(P0_BROWSER_PROJECT_AUTHORITY_V1)) {
      expect(Object.isFrozen(method)).toBe(true);
    }
    const first = await import("../src/index.js");
    const second = await import("../src/index.js");
    expect(first.P0_BROWSER_PROJECT_AUTHORITY_V1).toBe(P0_BROWSER_PROJECT_AUTHORITY_V1);
    expect(second.P0_BROWSER_PROJECT_AUTHORITY_V1).toBe(P0_BROWSER_PROJECT_AUTHORITY_V1);
  });

  it("uses every exact real effect ID, version, and parameter Schema", () => {
    P0_EFFECTS.forEach((definition) => {
      const bound = P0_EFFECTS_BY_ID.get(definition.effectId);
      expect(bound).toBe(definition);
      expect(bound?.version).toBe(definition.version);
      expect(bound?.parameterSchema).toBe(definition.parameterSchema);
    });
    for (const index of [0, 15, 39]) {
      expect(P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope(envelope(index)).valid)
        .toBe(true);
      const stale = envelope(index);
      stale.project.compositions[0]!.layers[0]!.effects[0]!.version = "0.0.0";
      expect(P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope(stale).valid).toBe(false);
      const invalid = envelope(index);
      invalid.project.compositions[0]!.layers[0]!.effects[0]!.params = {};
      expect(P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope(invalid).valid).toBe(false);
    }
  });

  it("has no registry/options parameters and rejects authority fields in request data", () => {
    expect(P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope).toHaveLength(1);
    expect(P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject).toHaveLength(2);
    expect(P0_BROWSER_PROJECT_AUTHORITY_V1).not.toHaveProperty("registry");
    expect(P0_BROWSER_PROJECT_AUTHORITY_V1).not.toHaveProperty("effectsById");
    for (const key of ["effectsById", "catalog", "registry", "authority", "options"]) {
      const result = P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope({
        ...envelope(),
        [key]: {}
      });
      expect(!result.valid && result.error.code).toBe("BROWSER_PROJECT_UNSAFE");
    }
    expect(() => Object.assign(P0_BROWSER_PROJECT_AUTHORITY_V1, { registry: new Map() })).toThrow();
  });

  it("cannot inject missing, cloned, reordered, replaced, or forged 40-entry Maps", () => {
    const realEntries = [...P0_EFFECTS_BY_ID];
    const variants: unknown[] = [
      new Map(realEntries.slice(0, 39)),
      new Map(realEntries),
      new Map([...realEntries].reverse()),
      new Map(realEntries.map(([id, definition]) => [id, { ...definition }]))
    ];
    const first = P0_EFFECTS[0]!;
    const replaced = new Map<string, unknown>(realEntries);
    replaced.set(first.effectId, { ...first, parameterSchema: { type: "object", additionalProperties: true } });
    variants.push(replaced);
    const forged = new Map<string, unknown>(realEntries);
    forged.delete(first.effectId);
    forged.set("fx.forged.permissive", {
      ...first,
      sourceId: "FORGED",
      effectId: "fx.forged.permissive",
      parameterSchema: { type: "object", additionalProperties: true }
    });
    variants.push(forged);

    for (const variant of variants) {
      expect(validateWithExtraArgument(envelope(), variant).valid).toBe(true);
      const forgedProject = envelope();
      const effect = forgedProject.project.compositions[0]!.layers[0]!.effects[0]!;
      effect.effectId = "fx.forged.permissive";
      effect.version = first.version;
      effect.params = { arbitrary: "accepted only by forged Schema" };
      expect(validateWithExtraArgument(forgedProject, variant).valid).toBe(false);
    }
  });

  it("exports only the pre-bound adapter and never the internal builder or a second catalog", () => {
    for (const key of [
      "createBrowserProjectAuthorityV1",
      "createP0BrowserProjectAuthorityV1",
      "rebindBrowserProjectAuthorityV1",
      "BrowserProjectValidationOptionsV1"
    ]) expect(EffectsRoot).not.toHaveProperty(key);
    const adapterSource = readFileSync(
      new URL("../src/browser-project-authority.ts", import.meta.url),
      "utf8"
    );
    expect(adapterSource.match(/createBrowserProjectAuthorityV1\s*\(/gu)).toHaveLength(1);
    expect(adapterSource.match(/@codemotion\/schema\/internal\/browser-project-authority/gu)).toHaveLength(1);
    expect(adapterSource).toContain('import { P0_EFFECTS_BY_ID } from "./catalog.js"');
    expect(adapterSource).not.toMatch(/sha-?256|digest|new Map|fx\.motion\.fade/iu);
  });

  it("keeps its construction snapshot after the public catalog Map is mutated in an isolated process", () => {
    const script = `
      const root = await import(process.argv[1]);
      const original = JSON.parse(process.argv[2]);
      const first = root.P0_EFFECTS[0];
      if (!root.P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope(original).valid) process.exit(2);
      root.P0_EFFECTS_BY_ID.delete(first.effectId);
      root.P0_EFFECTS_BY_ID.set("fx.forged.permissive", {
        ...first,
        sourceId: "FORGED",
        effectId: "fx.forged.permissive",
        parameterSchema: { type: "object", additionalProperties: true }
      });
      if (root.P0_EFFECTS_BY_ID.has(first.effectId)) process.exit(3);
      if (!root.P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope(original).valid) process.exit(4);
      const forged = structuredClone(original);
      const effect = forged.project.compositions[0].layers[0].effects[0];
      effect.effectId = "fx.forged.permissive";
      effect.params = { arbitrary: true };
      if (root.P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope(forged).valid) process.exit(5);
    `;
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "--eval",
      script,
      new URL("../dist/index.js", import.meta.url).href,
      JSON.stringify(envelope())
    ], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });
});
