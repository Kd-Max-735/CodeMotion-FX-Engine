import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  PROJECT_SCHEMA_VERSION,
  type Animatable,
  type JsonObject,
  type JsonValue,
  type LayerDefinition,
  type MotionProject,
  type Vector3
} from "@codemotion/core";
import { P0_EFFECTS, P0_EFFECTS_BY_ID } from "@codemotion/effects-2d";
import { evaluateAnimatable } from "@codemotion/timeline";
import * as SchemaRoot from "@codemotion/schema";
import {
  BrowserProjectAuthorityConfigurationError,
  createBrowserProjectAuthorityV1
} from "@codemotion/schema/internal/browser-project-authority";
import {
  AI_PLAN_RESULT_CONTRACT,
  APPLICATION_SCOPES,
  BROWSER_ASSET_URI,
  BROWSER_PROJECT_CONTRACT,
  BROWSER_PROJECT_LIMITS,
  EXPORT_REQUEST_CONTRACT,
  EXPORT_TASK_CONTRACT,
  PREVIEW_REQUEST_CONTRACT,
  inspectTransportJsonV1,
  isApplicationScope,
  validateApplicationScopes,
  type BrowserProjectConstraintsV1,
  type BrowserProjectEnvelopeV1
} from "@codemotion/schema";

const constant = <T extends JsonValue>(value: T): Animatable<T> => ({ mode: "constant", value });
const vector = (x: number, y: number, z = 0): Animatable<Vector3> => constant({ x, y, z });

const authority = createBrowserProjectAuthorityV1(P0_EFFECTS_BY_ID, evaluateAnimatable);

const constraints: BrowserProjectConstraintsV1 = {
  style: ["editorial"],
  brand: {
    colors: ["#112233", "#abcdef80"],
    tone: ["calm"],
    requiredText: ["CodeMotion"],
    forbiddenContent: [],
    logoAssetIds: ["asset.image"]
  }
};

function baseLayer(id: string, type: LayerDefinition["type"], properties: JsonObject): LayerDefinition {
  return {
    id,
    type,
    name: id,
    visible: true,
    locked: false,
    solo: false,
    startTime: 0,
    endTime: 4,
    inPoint: 0,
    outPoint: 4,
    zIndex: 0,
    transform: {
      anchorPoint: vector(0, 0, 0),
      position: {
        mode: "keyframes",
        keyframes: [
          { time: 0, value: { x: 0, y: 0, z: 0 }, interpolation: "linear" },
          { time: 4, value: { x: 10, y: 5, z: 0 }, interpolation: "linear" }
        ]
      },
      scale: vector(100, 100, 100),
      rotation: vector(0, 0, 0)
    },
    opacity: constant(1),
    blendMode: "normal",
    masks: [],
    effects: [],
    properties
  } as LayerDefinition;
}

function browserProject(): BrowserProjectEnvelopeV1 {
  const definition = P0_EFFECTS[0]!;
  const text = baseLayer("layer.text", "text", {
    text: "CodeMotion",
    fontFamily: "Codemotion Planner Unicode Bitmap",
    fontSize: 64,
    color: "#ffffffff"
  });
  const shape = baseLayer("layer.shape", "shape", {
    shapes: [{ path: "M 0 0 L 100 0 L 100 100 L 0 100 Z", fill: "#ff0000" }],
    fill: "#ff0000"
  });
  shape.effects = [{
    id: "effect.p0",
    effectId: definition.effectId,
    version: definition.version,
    enabled: true,
    mix: constant(1),
    params: structuredClone(definition.defaultPreset)
  }];
  const image = baseLayer("layer.image", "image", { fit: "cover" });
  image.source = { assetId: "asset.image" };
  const video = baseLayer("layer.video", "video", { loop: true, muted: false });
  video.source = { assetId: "asset.video" };
  const svg = baseLayer("layer.svg", "svg", {
    svg: "M 0 0 L 1 0 L 1 1 L 0 1 Z",
    fill: "#00ff00",
    fillRule: "nonzero"
  });
  const nested = baseLayer("layer.composition", "composition", {
    compositionId: "composition.nested",
    timeOffset: 0,
    timeRemap: constant(0) as unknown as JsonValue,
    timeLoop: "none"
  });
  const project: MotionProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    id: "project.browser.safe",
    name: "Browser safe project",
    width: 640,
    height: 360,
    fps: 30,
    duration: 4,
    background: { type: "transparent" },
    colorSpace: "srgb",
    seed: 7,
    assets: [
      { id: "asset.image", type: "image", uri: BROWSER_ASSET_URI, metadata: {} },
      { id: "asset.video", type: "video", uri: BROWSER_ASSET_URI, metadata: {} },
      { id: "asset.audio", type: "audio", uri: BROWSER_ASSET_URI, metadata: {} }
    ],
    compositions: [
      {
        id: "composition.main",
        name: "Main",
        width: 640,
        height: 360,
        duration: 4,
        fps: 30,
        layers: [text, shape, image, video, svg, nested],
        markers: [{ id: "marker.one", time: 1, name: "One", color: "#ffffff" }],
        effects: []
      },
      {
        id: "composition.nested",
        name: "Nested",
        width: 640,
        height: 360,
        duration: 4,
        layers: [],
        effects: []
      }
    ],
    fonts: [{ id: "font.codemotion.unicode-bitmap-v1", family: "Codemotion Planner Unicode Bitmap" }],
    audioTracks: [{ id: "audio.main", assetId: "asset.audio", startTime: 0, endTime: 4, volume: constant(1) }],
    renderPresets: [],
    metadata: { timeContractVersion: "1.1.0" }
  };
  return { contract: BROWSER_PROJECT_CONTRACT, project, constraints: structuredClone(constraints) };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function expectUnsafe(value: unknown): void {
  const result = authority.validateBrowserProjectEnvelope(value);
  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.error.code).toBe("BROWSER_PROJECT_UNSAFE");
    expect(result.error.message).toBe("Browser project is not safe.");
    expect(JSON.stringify(result.error)).not.toContain("shaderSource");
  }
}

function expectAuthorityConfigurationFailure(registry: unknown, evaluator: unknown): void {
  try {
    createBrowserProjectAuthorityV1(registry, evaluator);
    throw new Error("authority unexpectedly constructed");
  } catch (error) {
    expect(error).toBeInstanceOf(BrowserProjectAuthorityConfigurationError);
    expect((error as Error).name).toBe("BrowserProjectAuthorityConfigurationError");
    expect((error as Error).message).toBe("Browser project authority configuration failed.");
    expect((error as Error).message).not.toMatch(/effect|schema|registry|TypeError/i);
  }
}

describe("browser project authority boundary", () => {
  it("keeps registry construction off the package root and freezes the closure authority", () => {
    for (const unsafeExport of [
      "createBrowserProjectAuthorityV1", "BrowserProjectValidationOptionsV1",
      "validateBrowserProjectEnvelopeV1", "sanitizeBrowserProjectV1",
      "validateAiPlanCompletedResultV2", "validateEditorPreviewRequestV1", "validateExportCreateRequestV1"
    ]) expect(SchemaRoot).not.toHaveProperty(unsafeExport);
    expect(Object.isFrozen(authority)).toBe(true);
    for (const method of Object.values(authority)) expect(Object.isFrozen(method)).toBe(true);
    expect(authority).not.toHaveProperty("effectsById");
    expect(authority).not.toHaveProperty("registry");
    expect(authority.validateBrowserProjectEnvelope).toHaveLength(1);
    expect(authority.sanitizeBrowserProject).toHaveLength(2);
    expect(authority.classifyBrowserProjectAssetReferences).toHaveLength(1);
  });

  it("fails closed with one fixed configuration error for missing or damaged authority inputs", () => {
    for (const registry of [undefined, null, {}, [], "registry", new Map(),
      new Map([...P0_EFFECTS_BY_ID].slice(0, 39))]) {
      expectAuthorityConfigurationFailure(registry, evaluateAnimatable);
    }
    expectAuthorityConfigurationFailure(new Proxy(new Map(P0_EFFECTS_BY_ID), {}), evaluateAnimatable);
    expectAuthorityConfigurationFailure(P0_EFFECTS_BY_ID, undefined);

    const wrongKey = new Map<string, unknown>(P0_EFFECTS_BY_ID);
    const first = P0_EFFECTS[0]!;
    wrongKey.delete(first.effectId);
    wrongKey.set("fx.forged.key", first);
    expectAuthorityConfigurationFailure(wrongKey, evaluateAnimatable);

    const duplicateSource = new Map<string, unknown>(P0_EFFECTS_BY_ID);
    const second = P0_EFFECTS[1]!;
    duplicateSource.set(second.effectId, { ...second, sourceId: first.sourceId });
    expectAuthorityConfigurationFailure(duplicateSource, evaluateAnimatable);

    const damagedSchema = new Map<string, unknown>(P0_EFFECTS_BY_ID);
    damagedSchema.set(first.effectId, { ...first, parameterSchema: { type: "not-a-json-schema-type" } });
    expectAuthorityConfigurationFailure(damagedSchema, evaluateAnimatable);
  });

  it("snapshots registry authority and rejects authority fields in request data", () => {
    const mutableRegistry = new Map(P0_EFFECTS_BY_ID);
    const isolated = createBrowserProjectAuthorityV1(mutableRegistry, evaluateAnimatable);
    mutableRegistry.clear();
    expect(isolated.validateBrowserProjectEnvelope(browserProject()).valid).toBe(true);
    for (const key of ["effectsById", "catalog", "registry", "authority"]) {
      const forged = { ...browserProject(), [key]: {} };
      const result = isolated.validateBrowserProjectEnvelope(forged);
      expect(!result.valid && result.error.code).toBe("BROWSER_PROJECT_UNSAFE");
    }
  });

  it("isolates compiled validators by authority definition identity", () => {
    const first = P0_EFFECTS[0]!;
    const rejectingRegistry = new Map<string, unknown>(P0_EFFECTS_BY_ID);
    rejectingRegistry.set(first.effectId, { ...first, parameterSchema: { not: {} } });
    const rejectingAuthority = createBrowserProjectAuthorityV1(rejectingRegistry, evaluateAnimatable);
    expect(rejectingAuthority.validateBrowserProjectEnvelope(browserProject()).valid).toBe(false);
    expect(authority.validateBrowserProjectEnvelope(browserProject()).valid).toBe(true);
  });
});

describe("browser-project/v1 frozen safety overlay", () => {
  it("accepts all six layer families, constant/keyframe animation, P0 effects, and opaque assets", () => {
    const result = authority.validateBrowserProjectEnvelope(browserProject());
    expect(result.valid).toBe(true);
    expect(P0_EFFECTS).toHaveLength(40);
    expect(P0_EFFECTS_BY_ID.size).toBe(40);
    expect(PROJECT_SCHEMA_VERSION).toBe("1.2.0");
  });

  it("classifies only authoritative asset locations and keeps logo roles distinct", () => {
    const result = authority.classifyBrowserProjectAssetReferences(browserProject());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value.map(({ assetId, role, allowedMediaTypes }) => ({
      assetId, role, allowedMediaTypes
    }))).toEqual([
      { assetId: "asset.image", role: "image-layer-source", allowedMediaTypes: ["image", "svg"] },
      { assetId: "asset.video", role: "video-layer-source", allowedMediaTypes: ["video"] },
      { assetId: "asset.audio", role: "audio-track", allowedMediaTypes: ["audio"] },
      { assetId: "asset.image", role: "brand-logo", allowedMediaTypes: ["image", "svg"] }
    ]);
    expect(result.value.every((entry) => Object.isFrozen(entry)
      && Object.isFrozen(entry.location) && Object.isFrozen(entry.allowedMediaTypes))).toBe(true);
    expect(result.value.some((entry) => entry.location.kind === "catalog-parameter")).toBe(false);
    expect(authority.classifyBrowserProjectAssetReferences({
      ...browserProject(), registry: P0_EFFECTS_BY_ID
    }).valid).toBe(false);
  });

  it("keeps ordinary asset-shaped strings as data without changing classified roles", () => {
    const textMatch = clone(browserProject());
    const textMorph = P0_EFFECTS.find((definition) => definition.sourceId === "T05")!;
    textMatch.project.compositions[0]!.layers[1]!.effects = [{
      id: "effect.text-match",
      effectId: textMorph.effectId,
      version: textMorph.version,
      enabled: true,
      mix: constant(1),
      params: { ...structuredClone(textMorph.defaultPreset), sourceText: "asset.image" }
    }];
    expect(authority.validateBrowserProjectEnvelope(textMatch).valid).toBe(true);
    const baseline = authority.classifyBrowserProjectAssetReferences(browserProject());
    const classified = authority.classifyBrowserProjectAssetReferences(textMatch);
    expect(classified.valid).toBe(true);
    expect(classified).toEqual(baseline);
    if (classified.valid) {
      expect(classified.value.some((entry) => entry.location.kind === "catalog-parameter")).toBe(false);
    }
  });

  it("accepts every reachable D02 builtin and rejects every other brush value", () => {
    const brushReveal = P0_EFFECTS.find((definition) => definition.sourceId === "D02")!;
    const withBrush = (brushTexture: JsonValue): BrowserProjectEnvelopeV1 => {
      const project = clone(browserProject());
      project.project.compositions[0]!.layers[1]!.effects = [{
        id: "effect.brush",
        effectId: brushReveal.effectId,
        version: brushReveal.version,
        enabled: true,
        mix: constant(1),
        params: { ...structuredClone(brushReveal.defaultPreset), brushTexture }
      }];
      return project;
    };
    const validValues: JsonValue[] = [
      "builtin://brush/round",
      { mode: "constant", value: "builtin://brush/round" },
      { mode: "keyframes", keyframes: [
        { time: 0, value: "builtin://brush/round", interpolation: "hold" },
        { time: 1, value: "builtin://brush/round", interpolation: "hold" }
      ] }
    ];
    for (const value of validValues) {
      const candidate = withBrush(value);
      expect(authority.validateBrowserProjectEnvelope(candidate).valid).toBe(true);
      const classified = authority.classifyBrowserProjectAssetReferences(candidate);
      expect(classified.valid).toBe(true);
      if (classified.valid) {
        expect(classified.value.some((entry) => entry.location.kind === "catalog-parameter")).toBe(false);
      }
    }
    const invalidLiterals = [
      "asset.image",
      "asset://owner-upload",
      "https://example.invalid",
      "file:///private/brush.png",
      "builtin://brush/square",
      "ordinary-brush"
    ];
    const invalidValues: JsonValue[] = invalidLiterals.flatMap((value) => [
      value,
      { mode: "constant", value },
      { mode: "keyframes", keyframes: [
        { time: 0, value: "builtin://brush/round", interpolation: "hold" },
        { time: 1, value, interpolation: "hold" }
      ] }
    ]);
    for (const value of invalidValues) expectUnsafe(withBrush(value));
  });

  it("rejects URI and path values only at non-reference string parameter positions", () => {
    const textMorph = P0_EFFECTS.find((definition) => definition.sourceId === "T05")!;
    const withSourceText = (sourceText: JsonValue): BrowserProjectEnvelopeV1 => {
      const project = clone(browserProject());
      project.project.compositions[0]!.layers[1]!.effects = [{
        id: "effect.text-uri",
        effectId: textMorph.effectId,
        version: textMorph.version,
        enabled: true,
        mix: constant(1),
        params: { ...structuredClone(textMorph.defaultPreset), sourceText }
      }];
      return project;
    };
    expect(authority.validateBrowserProjectEnvelope(withSourceText("ordinary")).valid).toBe(true);
    expect(authority.validateBrowserProjectEnvelope(withSourceText("asset.image")).valid).toBe(true);
    for (const value of [
      "https://example.invalid",
      { mode: "constant", value: "file:///private/source.txt" },
      { mode: "keyframes", keyframes: [
        { time: 0, value: "ordinary", interpolation: "hold" },
        { time: 1, value: "../private/source.txt", interpolation: "hold" }
      ] }
    ] satisfies JsonValue[]) expectUnsafe(withSourceText(value));
  });

  it("fails closed for duplicate, unknown, and conflicting asset roles", () => {
    const duplicateLogo = clone(browserProject()) as unknown as {
      constraints: { brand: { logoAssetIds: string[] } };
    };
    duplicateLogo.constraints.brand.logoAssetIds.push("asset.image");
    expectUnsafe(duplicateLogo);

    const unknownLogo = clone(browserProject()) as unknown as {
      constraints: { brand: { logoAssetIds: string[] } };
    };
    unknownLogo.constraints.brand.logoAssetIds[0] = "asset.unknown";
    expectUnsafe(unknownLogo);

    const conflicting = clone(browserProject());
    conflicting.project.compositions[0]!.layers[3]!.source = { assetId: "asset.image" };
    conflicting.project.assets = conflicting.project.assets.filter((asset) => asset.id !== "asset.video");
    expectUnsafe(conflicting);
  });

  it("sanitizes only trusted asset authority and metadata with deterministic round trips", () => {
    const source = clone(browserProject().project);
    source.assets = source.assets.map((asset) => ({
      ...asset,
      uri: `file:///private/${asset.id}`,
      hash: `sha256:${asset.id}`,
      metadata: { storedPath: `/private/${asset.id}`, proxy: "secret" }
    }));
    source.metadata = { timeContractVersion: "1.1.0", providerId: "secret", owner: "secret" };
    const first = authority.sanitizeBrowserProject(source, constraints);
    const second = authority.sanitizeBrowserProject(source, constraints);
    expect(first).toEqual(second);
    expect(first.valid).toBe(true);
    if (!first.valid) return;
    const serialized = JSON.stringify(first.value);
    expect(serialized).not.toMatch(/file:|sha256:|storedPath|providerId|owner|proxy/);
    expect(first.value.project.assets.every((asset) => asset.uri === BROWSER_ASSET_URI
      && !Object.hasOwn(asset, "hash") && Object.keys(asset.metadata).length === 0)).toBe(true);
    expect(authority.validateBrowserProjectEnvelope(first.value).valid).toBe(true);
  });

  it("rejects forbidden layers, properties, expressions, bindings, and stale or arbitrary effects", () => {
    const forbiddenLayer = clone(browserProject());
    forbiddenLayer.project.compositions[0]!.layers[0]!.type = "custom";
    expectUnsafe(forbiddenLayer);

    const unknownProperty = clone(browserProject());
    (unknownProperty.project.compositions[0]!.layers[0]!.properties as JsonObject).commands = [];
    expectUnsafe(unknownProperty);

    for (const opacity of [
      { mode: "expression", expression: { language: "cmfx-expression", source: "1", ast: { type: "literal", value: 1 } } },
      { mode: "binding", source: { source: "time", path: "frame" } }
    ]) {
      const candidate = clone(browserProject());
      candidate.project.compositions[0]!.layers[0]!.opacity = opacity as Animatable<number>;
      expectUnsafe(candidate);
    }

    const arbitrary = clone(browserProject());
    arbitrary.project.compositions[0]!.layers[1]!.effects[0]!.effectId = "fx.custom.runtime";
    expectUnsafe(arbitrary);
    const stale = clone(browserProject());
    stale.project.compositions[0]!.layers[1]!.effects[0]!.version = "0.0.0";
    expectUnsafe(stale);
    const invalidParams = clone(browserProject());
    invalidParams.project.compositions[0]!.layers[1]!.effects[0]!.params = {};
    expectUnsafe(invalidParams);
  });

  it("validates keyframed effect snapshots through the supplied frozen evaluator", () => {
    const candidate = clone(browserProject());
    const effect = candidate.project.compositions[0]!.layers[1]!.effects[0]!;
    const firstName = Object.keys(effect.params)[0]!;
    const initial = effect.params[firstName] as JsonValue;
    effect.params[firstName] = { mode: "keyframes", keyframes: [
      { time: 0, value: initial, interpolation: "hold" },
      { time: 1, value: initial, interpolation: "hold" }
    ] };
    expect(authority.validateBrowserProjectEnvelope(candidate).valid).toBe(true);
  });

  it("recursively rejects executable/dependency/event/path and prototype-pollution structures", () => {
    for (const key of [
      "script", "shaderSource", "GLSL", "wgsl", "plugin_data", "dependencies", "import", "module", "package", "onClick",
      "downloadUrl", "serverPath"
    ]) {
      const candidate = clone(browserProject());
      (candidate.project.compositions[0]!.layers[0]!.properties as Record<string, unknown>)[key] = "secret";
      expectUnsafe(candidate);
    }
    for (const key of ["__proto__", "prototype", "constructor"]) {
      const candidate = clone(browserProject());
      const properties = candidate.project.compositions[0]!.layers[0]!.properties as Record<string, unknown>;
      Object.defineProperty(properties, key, { value: { polluted: true }, enumerable: true, configurable: true });
      expectUnsafe(candidate);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  it("enforces finite numbers and every frozen generic budget class", () => {
    const nonFinite = clone(browserProject());
    nonFinite.project.width = Number.NaN;
    expectUnsafe(nonFinite);

    const tooManyAssets = clone(browserProject());
    tooManyAssets.project.assets = Array.from({ length: BROWSER_PROJECT_LIMITS.maxAssets + 1 }, (_, index) => ({
      id: `asset.${index}`, type: "image" as const, uri: BROWSER_ASSET_URI, metadata: {}
    }));
    const assetResult = authority.validateBrowserProjectEnvelope(tooManyAssets);
    expect(!assetResult.valid && assetResult.error.code).toBe("PROJECT_TOO_LARGE");

    const tooManyCompositions = clone(browserProject());
    tooManyCompositions.project.compositions = Array.from(
      { length: BROWSER_PROJECT_LIMITS.maxCompositions + 1 },
      (_, index) => ({
        id: `composition.${index}`,
        name: `Composition ${index}`,
        width: 640,
        height: 360,
        duration: 4,
        layers: []
      })
    );
    const compositionResult = authority.validateBrowserProjectEnvelope(tooManyCompositions);
    expect(!compositionResult.valid && compositionResult.error.code).toBe("PROJECT_TOO_LARGE");

    let deep: unknown = 0;
    for (let index = 0; index <= BROWSER_PROJECT_LIMITS.maxDepth; index += 1) deep = { value: deep };
    expect(inspectTransportJsonV1(deep)).toBe("budget");
    expect(inspectTransportJsonV1(Array(BROWSER_PROJECT_LIMITS.maxGenericArray + 1).fill(0))).toBe("budget");
    expect(inspectTransportJsonV1(Object.fromEntries(Array.from(
      { length: BROWSER_PROJECT_LIMITS.maxObjectKeys + 1 }, (_, index) => [`k${index}`, index]
    )))).toBe("budget");
    const manyNodes = Object.fromEntries(Array.from({ length: 128 }, (_, index) => [
      `k${index}`,
      Array.from({ length: 256 }, () => ({ a: 1, b: 2, c: 3 }))
    ]));
    expect(inspectTransportJsonV1(manyNodes)).toBe("budget");
    expect(inspectTransportJsonV1({ value: "x".repeat(BROWSER_PROJECT_LIMITS.maxGenericStringScalars + 1) }))
      .toBe("budget");
  });

  it("rejects forged browser asset authority fields and unknown contract versions", () => {
    for (const key of ["hash", "proxy", "owner", "path", "codec"]) {
      const candidate = clone(browserProject());
      (candidate.project.assets[0] as unknown as Record<string, unknown>)[key] = "forged";
      expectUnsafe(candidate);
    }
    const uri = clone(browserProject());
    uri.project.assets[0]!.uri = "file:///forged";
    expectUnsafe(uri);
    const metadata = clone(browserProject());
    metadata.project.assets[0]!.metadata = { storedPath: "secret" };
    expectUnsafe(metadata);
    const wrong = clone(browserProject()) as unknown as Record<string, unknown>;
    wrong.contract = "browser-project/v2";
    const result = authority.validateBrowserProjectEnvelope(wrong);
    expect(!result.valid && result.error.code).toBe("UNSUPPORTED_CONTRACT");
  });
});

describe("Stage 7R public transport contracts", () => {
  it("exports the sole exact six-scope contract", () => {
    expect(APPLICATION_SCOPES).toEqual([
      "ai:plan", "assets:read", "assets:write", "project:preview", "export:create", "export:read"
    ]);
    expect(validateApplicationScopes(APPLICATION_SCOPES)).toBe(true);
    expect(validateApplicationScopes([...APPLICATION_SCOPES, "admin"])).toBe(false);
    expect(isApplicationScope("AI:PLAN")).toBe(false);
  });

  it("validates ai-plan-result/v2 without raw DSL or provider detail", () => {
    const project = browserProject();
    const definition = P0_EFFECTS[0]!;
    const result = {
      contract: AI_PLAN_RESULT_CONTRACT,
      storyboard: {
        intent: "intro",
        duration: project.project.duration,
        width: project.project.width,
        height: project.project.height,
        fps: project.project.fps,
        style: constraints.style,
        brand: constraints.brand,
        requirements: [],
        constraints: [],
        shots: [{
          id: "shot.one",
          range: { start: 0, end: 4 },
          description: "shot",
          layers: [{ id: "story.text", description: "title", type: "text", text: "CodeMotion" }],
          effects: [{
            sourceId: definition.sourceId,
            effectId: definition.effectId,
            effectVersion: definition.version,
            targetLayerId: "story.text",
            params: structuredClone(definition.defaultPreset)
          }]
        }]
      },
      editableProject: project,
      issues: [],
      preview: { width: 160, height: 90, quality: "draft", frameCount: 4, timeContractVersion: "1.1.0" }
    };
    expect(authority.validateAiPlanCompletedResult(result).valid).toBe(true);
    for (const key of ["dsl", "provider", "owner", "storedPath"]) {
      const forged = clone(result) as unknown as Record<string, unknown>;
      forged[key] = "secret";
      expect(authority.validateAiPlanCompletedResult(forged).valid).toBe(false);
    }

    for (const id of ["", "   "]) {
      const shotId = clone(result);
      shotId.storyboard.shots[0]!.id = id;
      expect(authority.validateAiPlanCompletedResult(shotId).valid).toBe(false);

      const layerId = clone(result);
      layerId.storyboard.shots[0]!.layers[0]!.id = id;
      expect(authority.validateAiPlanCompletedResult(layerId).valid).toBe(false);

      const targetId = clone(result);
      targetId.storyboard.shots[0]!.effects[0]!.targetLayerId = id;
      expect(authority.validateAiPlanCompletedResult(targetId).valid).toBe(false);
    }

    for (const field of ["sourceId", "effectId", "effectVersion"] as const) {
      for (const id of ["", "   "]) {
        const candidate = clone(result);
        const effect = candidate.storyboard.shots[0]!.effects[0]! as unknown as Record<string, unknown>;
        effect[field] = id;
        expect(authority.validateAiPlanCompletedResult(candidate).valid).toBe(false);
      }
    }

    for (const localAssetId of ["", "   "]) {
      const emptyAsset = clone(result);
      const layers = emptyAsset.storyboard.shots[0]!.layers as Array<Record<string, unknown>>;
      layers[0] = { id: "story.image", description: "image", type: "image", localAssetId };
      emptyAsset.storyboard.shots[0]!.effects[0]!.targetLayerId = "story.image";
      expect(authority.validateAiPlanCompletedResult(emptyAsset).valid).toBe(false);
    }

    const duplicateLayer = clone(result);
    duplicateLayer.storyboard.shots[0]!.layers.push(clone(duplicateLayer.storyboard.shots[0]!.layers[0]!));
    expect(authority.validateAiPlanCompletedResult(duplicateLayer).valid).toBe(false);

    const missingTarget = clone(result);
    missingTarget.storyboard.shots[0]!.effects[0]!.targetLayerId = "story.missing";
    expect(authority.validateAiPlanCompletedResult(missingTarget).valid).toBe(false);
  });

  it("validates preview/export requests and rejects raw-project or unknown contracts", () => {
    const project = browserProject();
    const preview = {
      contract: PREVIEW_REQUEST_CONTRACT,
      editableProject: project,
      frame: { time: 1, width: 640, height: 360, quality: "preview" }
    };
    expect(authority.validateEditorPreviewRequest(preview).valid).toBe(true);
    expect(authority.validateEditorPreviewRequest(project.project).valid).toBe(false);
    expect(authority.validateEditorPreviewRequest({ ...preview, contract: "preview-request/v0" }).valid)
      .toBe(false);

    const exportRequest = {
      contract: EXPORT_REQUEST_CONTRACT,
      editableProject: project,
      settings: { format: "mp4", width: 640, height: 360, fps: 30, duration: 4, alpha: false, audio: true }
    };
    expect(authority.validateExportCreateRequest(exportRequest).valid).toBe(true);
    expect(authority.validateExportCreateRequest({
      ...exportRequest, settings: { ...exportRequest.settings, alpha: true }
    }).valid).toBe(false);
  });

  it("validates closed export-task/v1 views without internal state", () => {
    const task = {
      contract: EXPORT_TASK_CONTRACT,
      id: "task.opaque",
      projectName: "Browser safe project",
      format: "mp4",
      status: "completed",
      progress: 1,
      completedFrames: 120,
      frameCount: 120,
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:01:00.000Z",
      settings: { format: "mp4", width: 640, height: 360, fps: 30, duration: 4, alpha: false, audio: true },
      video: { codec: "libx264", audioCodec: "aac", width: 640, height: 360, fps: 30, duration: 4 },
      estimatedBytes: 1024,
      outputBytes: 900,
      downloadName: "render.mp4",
      expiresAt: "2026-08-04T00:01:00.000Z"
    };
    expect(authority.validateExportTaskView(task).valid).toBe(true);
    for (const key of ["path", "owner", "hash", "tombstone", "stderr"]) {
      const forged = { ...task, [key]: "secret" };
      expect(authority.validateExportTaskView(forged).valid).toBe(false);
    }
  });
});
