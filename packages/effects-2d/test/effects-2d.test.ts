import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateContract } from "@codemotion/schema";
import {
  TIME_CONTRACT_VERSION,
  type EffectDefinition,
  type EffectInstance,
  type EffectTimeSample,
  type JsonObject,
  type NullLayer,
  type TransformDefinition
} from "@codemotion/core";
import {
  resolveEffectTimeSample,
  resolveLayerTimeSample,
  resolveProjectTimeSample
} from "@codemotion/timeline";
import type {
  DualInputTextures,
  LayerRasterizationInput,
  LayerRasterizationOutput,
  TemporalEffectRenderContext,
  TextureHandle
} from "@codemotion/renderer-api";
import { WebGLRendererAdapter } from "@codemotion/renderer-webgl";
import type { TextExtrude3DEffectDefinition } from "@codemotion/effects-3d";
import { FakeWebGL2Context } from "../../renderer-webgl/test/fake-webgl.js";
import {
  GROUP_2_BLUEPRINTS,
  GROUP_2_P0_EFFECTS,
  P0_EFFECTS,
  P0_EFFECTS_BY_ID,
  convertPixelSurface,
  createCatalogWebGLPass,
  createGroup2P0Effects,
  hashPixelSurface,
  makeBrushCoverage,
  makeEffectTimeSample,
  makeMaskSurface,
  makePreviewInput,
  makeRealInputFixture,
  makeTextExtrudeCatalogFixture,
  normalizeEffectParams,
  parseSvgPathData,
  type ParameterSpec,
  type P0EffectDefinition,
  type PixelSurface,
  verifyGroup3TextExtrudeInterface
} from "../src/index.js";

const golden = JSON.parse(readFileSync(
  new URL("./fixtures/golden-frames.json", import.meta.url),
  "utf8"
)) as {
  schemaVersion: string;
  width: number;
  height: number;
  t08Source: {
    width: number;
    height: number;
    text: string;
    effectInstanceId: string;
    seed: number;
    quality: "final";
  };
  frames: Record<string, Record<string, string>>;
};

const definitionKeys = [
  "schemaVersion", "effectId", "version", "displayName", "category", "description",
  "tags", "inputTypes", "outputType", "parameterSchema", "uiSchema", "defaultPreset",
  "renderBackends", "preferredBackend", "fallbackBackend", "deterministic", "supportsAlpha",
  "supportsMask", "supportsKeyframes", "supportsExpressions", "performanceClass",
  "qualityLevels", "validationRules", "migrations"
] as const;

function contractView(effect: EffectDefinition): EffectDefinition {
  return Object.fromEntries(definitionKeys.map((key) => [key, effect[key]])) as unknown as EffectDefinition;
}

function extremes(effectId: string): JsonObject {
  const blueprint = GROUP_2_BLUEPRINTS.find((item) => item.effectId === effectId);
  if (!blueprint) throw new Error(effectId);
  const values: JsonObject = {};
  for (const parameter of blueprint.parameters) {
    values[parameter.name] = parameter.kind === "number" ? Number.POSITIVE_INFINITY
      : parameter.kind === "vector2" ? [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
          : parameter.kind === "enum" ? "__invalid__"
          : parameter.kind === "boolean" ? "__invalid__"
            : parameter.default;
  }
  return values;
}

function parameterCandidates(spec: ParameterSpec): readonly unknown[] {
  if (spec.kind === "number") {
    const span = spec.max - spec.min;
    return [
      spec.min,
      spec.max,
      spec.min + span * 0.25,
      spec.min + span * 0.73
    ].filter((value) => Math.abs(value - spec.default) > Number.EPSILON);
  }
  if (spec.kind === "enum") return spec.options.filter((value) => value !== spec.default);
  if (spec.kind === "boolean") return [!spec.default];
  if (spec.kind === "text") {
    if (spec.name === "path" || spec.name === "fromPath" || spec.name === "toPath") {
      return [
        "M0.05,0.2 C0.25,0.95 0.7,0.05 0.95,0.8",
        "M0.1,0.1 L0.9,0.2 L0.6,0.9 Z"
      ];
    }
    if (spec.name === "beatMap" || spec.name === "scaleMap") {
      return ["0.15,0.9,0.2,1", "1.4,0.6,1.1"];
    }
    if (spec.name === "sourceText" || spec.name === "targetText") return ["动效A", "Motion中"];
    if (spec.name === "charset") return ["中文AB12", "△○□◇"];
    if (spec.name === "mask" || spec.name === "matteLayer" || spec.name === "map") {
      return ["missing.layer"];
    }
    if (spec.name === "brushTexture") return ["asset://brush/missing"];
    return [
      `${spec.default}-semantic-variant`.slice(0, spec.maxLength),
      "alternate-source".slice(0, spec.maxLength),
      "Z9".slice(0, spec.maxLength)
    ].filter((value) => value !== spec.default && value.length >= spec.minLength);
  }
  return [
    [spec.min, spec.max],
    [spec.max, spec.min],
    [spec.min + (spec.max - spec.min) * 0.27, spec.min + (spec.max - spec.min) * 0.71]
  ];
}

function surfaceData(surface: PixelSurface): number[] {
  return Array.from(surface.data);
}

function premultiplySurface(surface: PixelSurface): PixelSurface {
  const data = new Uint8ClampedArray(surface.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    const alpha = surface.data[offset + 3]!;
    data[offset] = Math.round(surface.data[offset]! * alpha / 255);
    data[offset + 1] = Math.round(surface.data[offset + 1]! * alpha / 255);
    data[offset + 2] = Math.round(surface.data[offset + 2]! * alpha / 255);
    data[offset + 3] = alpha;
  }
  return { ...surface, data, alphaMode: "premultiplied" };
}

function makeForegroundShape(width = 32, height = 24): PixelSurface {
  const data = new Uint8ClampedArray(width * height * 4);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const normalizedX = (x - centerX) / (width * 0.32);
      const normalizedY = (y - centerY) / (height * 0.36);
      const distance = Math.hypot(normalizedX, normalizedY);
      if (distance > 1) continue;
      const offset = (y * width + x) * 4;
      data[offset] = 238;
      data[offset + 1] = 92 + Math.round(80 * x / Math.max(1, width - 1));
      data[offset + 2] = 48;
      data[offset + 3] = Math.round(255 * Math.min(1, (1 - distance) * 5));
    }
  }
  return { width, height, data, colorSpace: "srgb", alphaMode: "straight" };
}

function realKind(effect: P0EffectDefinition): "text" | "vector" | "media" {
  return effect.category === "text" ? "text"
    : effect.category === "vector" || effect.category === "draw" ? "vector"
      : "media";
}

const officialTransform: TransformDefinition = {
  anchorPoint: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
  position: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
  scale: { mode: "constant", value: { x: 100, y: 100, z: 100 } },
  rotation: { mode: "constant", value: { x: 0, y: 0, z: 0 } }
};

function resolvedTime(
  effect: Pick<EffectDefinition, "effectId" | "version" | "defaultPreset">,
  effectInstanceId: string,
  effectTime = 0.5,
  duration = 1
) {
  const instance: EffectInstance = {
    id: effectInstanceId,
    effectId: effect.effectId,
    version: effect.version,
    enabled: true,
    startTime: 0,
    endTime: duration,
    mix: { mode: "constant", value: 1 },
    params: effect.defaultPreset
  };
  const layer: NullLayer = {
    id: `layer.${effectInstanceId}`,
    type: "null",
    name: "G2 official time fixture",
    visible: true,
    locked: false,
    solo: false,
    startTime: 37,
    endTime: 37 + duration,
    inPoint: 0,
    outPoint: duration,
    zIndex: 0,
    transform: officialTransform,
    opacity: { mode: "constant", value: 1 },
    blendMode: "normal",
    masks: [],
    effects: [instance],
    properties: {}
  };
  const project = resolveProjectTimeSample({
    projectTime: layer.startTime + effectTime,
    previousProjectTime: layer.startTime + Math.max(0, effectTime - 1 / 60),
    fps: 60
  });
  const layerTime = resolveLayerTimeSample(layer, project);
  return {
    instance,
    layer,
    project,
    layerTime,
    time: resolveEffectTimeSample(instance, layerTime, project, duration)
  } as const;
}

function textExtrudeFixture(
  effect: TextExtrude3DEffectDefinition,
  effectInstanceId: string,
  effectTime: number,
  width: number,
  height: number
) {
  if (effect.effectId !== "fx.text.textExtrude3D") {
    throw new TypeError("T08 aggregate fixture effectId mismatch.");
  }
  return makeTextExtrudeCatalogFixture({
    effectId: "fx.text.textExtrude3D",
    effectInstanceId,
    text: "FX",
    width,
    height,
    effectTime,
    duration: 1,
    fps: 60,
    projectStart: 37
  });
}

function rasterOutput(
  input: LayerRasterizationInput,
  texture: TextureHandle
): LayerRasterizationOutput {
  return {
    texture,
    sourceKind: input.source.kind,
    contentBounds: { x: 0, y: 0, width: input.target.width, height: input.target.height },
    coveredPixelCount: input.target.width * input.target.height,
    contentDigest: `${input.layerId}:${input.source.kind}`,
    alphaMode: "premultiplied",
    usedSolidFallback: false
  };
}

function dualInputTextures(
  sourceInput: LayerRasterizationInput,
  secondaryInput: LayerRasterizationInput,
  backend: TextureHandle["backend"] = "canvas2d"
): DualInputTextures {
  const makeTexture = (id: string, input: LayerRasterizationInput): TextureHandle => ({
    id,
    backend,
    descriptor: input.target
  });
  return {
    source: rasterOutput(sourceInput, makeTexture(`texture.${sourceInput.layerId}`, sourceInput)),
    secondary: rasterOutput(
      secondaryInput,
      makeTexture(`texture.${secondaryInput.layerId}`, secondaryInput)
    )
  };
}

function realFixture(
  effect: P0EffectDefinition,
  effectInstanceId: string,
  progress: number,
  width = 64,
  height = 36,
  colorSpace: PixelSurface["colorSpace"] = "srgb",
  seed = 20260728,
  quality: "draft" | "preview" | "final" = "final",
  projectStart = 0,
  fps = 30,
  duration = 1
) {
  const time = makeEffectTimeSample(
    effect.effectId,
    effectInstanceId,
    progress * duration,
    duration,
    projectStart,
    fps,
    1 / fps
  );
  const source = makeRealInputFixture(
    effect.effectId,
    realKind(effect),
    width,
    height,
    false,
    colorSpace,
    time
  );
  const secondary = makeRealInputFixture(
    effect.effectId,
    "media",
    width,
    height,
    true,
    colorSpace,
    time
  );
  return {
    time,
    source,
    secondary,
    options: {
      time,
      seed,
      quality,
      rasterInput: source.input,
      secondaryRasterInput: secondary.input,
      secondary: secondary.surface,
      dualInputTextures: dualInputTextures(source.input, secondary.input),
      brushCoverage: makeBrushCoverage(),
      brushAssetId: "builtin://brush/round"
    }
  } as const;
}

function fixtureAtTime(
  effect: P0EffectDefinition,
  time: EffectTimeSample,
  width = 48,
  height = 27,
  seed = 20260728
) {
  const source = makeRealInputFixture(
    effect.effectId,
    realKind(effect),
    width,
    height,
    false,
    "srgb",
    time
  );
  const secondary = makeRealInputFixture(
    effect.effectId,
    "media",
    width,
    height,
    true,
    "srgb",
    time
  );
  return {
    source,
    secondary,
    options: {
      time,
      seed,
      quality: "final" as const,
      rasterInput: source.input,
      secondaryRasterInput: secondary.input,
      secondary: secondary.surface,
      dualInputTextures: dualInputTextures(source.input, secondary.input),
      brushCoverage: makeBrushCoverage(),
      brushAssetId: "builtin://brush/round"
    }
  } as const;
}

function recolorRasterInput(
  input: LayerRasterizationInput,
  surface: PixelSurface
): LayerRasterizationInput {
  const source = input.source.kind === "image" || input.source.kind === "video"
    ? {
        ...input.source,
        pixels: {
          ...input.source.pixels,
          data: surface.data,
          colorSpace: surface.colorSpace,
          alphaMode: surface.alphaMode
        }
      }
    : input.source;
  return {
    ...input,
    source,
    target: { ...input.target, colorSpace: surface.colorSpace }
  };
}

function colorFixture(
  effect: P0EffectDefinition,
  progress: number,
  colorSpace: PixelSurface["colorSpace"]
) {
  const base = realFixture(effect, `test.color.${effect.sourceId}`, progress, 32, 18);
  const sourceSurface = convertPixelSurface(base.source.surface, colorSpace);
  const secondarySurface = convertPixelSurface(base.secondary.surface, colorSpace);
  const sourceInput = recolorRasterInput(base.source.input, sourceSurface);
  const secondaryInput = recolorRasterInput(base.secondary.input, secondarySurface);
  return {
    source: { input: sourceInput, surface: sourceSurface },
    secondary: { input: secondaryInput, surface: secondarySurface },
    options: {
      ...base.options,
      rasterInput: sourceInput,
      secondaryRasterInput: secondaryInput,
      secondary: secondarySurface,
      dualInputTextures: dualInputTextures(sourceInput, secondaryInput)
    }
  };
}

function fallbackContext(
  effect: P0EffectDefinition,
  effectInstanceId: string,
  params: Readonly<Record<string, unknown>>,
  progress: number,
  duration = 1,
  projectStart = 0,
  fps = 30,
  width = 64,
  height = 36
): TemporalEffectRenderContext {
  const fixture = realFixture(
    effect,
    effectInstanceId,
    progress,
    width,
    height,
    "srgb",
    20260728,
    "final",
    projectStart,
    fps,
    duration
  );
  const { time, source, secondary } = fixture;
  const frame = {
    time: time.projectTime,
    projectTime: time.projectTime,
    deltaTime: time.deltaTime,
    frame: time.frame,
    fps: time.fps,
    width: source.surface.width,
    height: source.surface.height,
    seed: 20260728,
    quality: "final" as const,
    colorSpace: "srgb" as const
  };
  return {
    ...frame,
    inputTextures: [],
    params,
    renderer: { backend: "canvas2d" } as TemporalEffectRenderContext["renderer"],
    timing: {
      frame,
      layerTime: source.input.time,
      effectTime: time
    },
    data: {
      effectId: effect.effectId,
      pixelSurface: { ...source.surface, data: surfaceData(source.surface) },
      secondarySurface: { ...secondary.surface, data: surfaceData(secondary.surface) },
      rasterInput: source.input,
      secondaryRasterInput: secondary.input,
      dualInputTextures: fixture.options.dualInputTextures,
      brushCoverage: fixture.options.brushCoverage,
      brushAssetId: "builtin://brush/round"
    }
  };
}

describe("Group 2 P0 catalog", () => {
  it("contains exactly the 39 frozen Group 2 IDs and excludes Group 3 T08", () => {
    expect(GROUP_2_P0_EFFECTS).toHaveLength(39);
    expect(new Set(GROUP_2_P0_EFFECTS.map((effect) => effect.effectId)).size).toBe(39);
    expect(new Set(GROUP_2_P0_EFFECTS.map((effect) => effect.sourceId)).size).toBe(39);
    expect(GROUP_2_P0_EFFECTS.some((effect) => effect.effectId === "fx.text.textExtrude3D")).toBe(false);
    expect(GROUP_2_P0_EFFECTS.map((effect) => effect.effectId))
      .toEqual(GROUP_2_BLUEPRINTS.map((effect) => effect.effectId));
  });

  it("aggregates exactly 40 unique non-placeholder effects in frozen slot order", () => {
    expect(P0_EFFECTS).toHaveLength(40);
    expect(P0_EFFECTS_BY_ID.size).toBe(40);
    expect(new Set(P0_EFFECTS.map((effect) => effect.effectId)).size).toBe(40);
    expect(new Set(P0_EFFECTS.map((effect) => effect.sourceId)).size).toBe(40);
    expect(P0_EFFECTS[15]?.sourceId).toBe("T08");
    expect(P0_EFFECTS[15]?.effectId).toBe("fx.text.textExtrude3D");
    expect(P0_EFFECTS[16]?.sourceId).toBe("V01");
    for (const effect of P0_EFFECTS) {
      expect(effect.description.length).toBeGreaterThan(10);
      expect(effect.description).not.toMatch(/placeholder|stub|todo/iu);
      expect(typeof effect.render).toBe("function");
      expect(typeof effect.renderPixels).toBe("function");
      expect(typeof effect.dispose).toBe("function");
      expect(effect.presets).toHaveLength(3);
      expect(effect.preview.asset).toContain(effect.sourceId);
    }
    const canonicalRegistry = JSON.stringify(P0_EFFECTS.map((effect, index) => ({
      slot: index + 1,
      sourceId: effect.sourceId,
      effectId: effect.effectId,
      version: effect.version,
      owner: effect.implementationOwner
    })));
    expect(createHash("sha256").update(canonicalRegistry).digest("hex")).toMatch(/^[a-f0-9]{64}$/u);
  });

  it.each(GROUP_2_P0_EFFECTS)("$sourceId $effectId has a valid complete definition", (effect) => {
    const result = validateContract("EffectDefinition", contractView(effect));
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    expect(effect.version).toBe("1.1.0");
    expect(effect.preferredBackend).toBe("webgl");
    expect(effect.fallbackBackend).toBe("canvas2d");
    expect(effect.qualityLevels.map((level) => level.quality)).toEqual(["draft", "preview", "final"]);
    expect(effect.performanceClass).toMatch(/^(light|medium|heavy|extreme)$/u);
    expect(effect.documentation.readme).toContain("README.md");
    expect(effect.documentation.changelog).toContain("CHANGELOG.md");
    expect(effect.preview.asset).toContain(effect.sourceId);
    expect(effect.preview.asset).not.toContain("#");
  });

  it.each(GROUP_2_P0_EFFECTS)("$sourceId $effectId has constrained params, UI and 3 usable presets", (effect) => {
    const schema = effect.parameterSchema as JsonObject;
    const ui = effect.uiSchema;
    const required = schema.required as string[];
    const properties = schema.properties as JsonObject;
    const fields = ui.fields as JsonObject;
    expect(required.length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(properties)).toEqual(required);
    expect(Object.keys(fields)).toEqual(required);
    expect(effect.presets).toHaveLength(3);
    expect(new Set(effect.presets.map((preset) => preset.presetId)).size).toBe(3);
    for (const preset of effect.presets) {
      expect(preset.effectId).toBe(effect.effectId);
      expect(preset.version).toBe(effect.version);
      expect(normalizeEffectParams(effect.effectId, preset.params)).toEqual(preset.params);
      expect(preset.previewAsset).toContain(effect.sourceId);
      expect(preset.previewAsset).not.toContain("#");
    }
  });

  it.each(GROUP_2_P0_EFFECTS)(
    "$sourceId $effectId gives every declared parameter observable CPU and Canvas2D-fallback semantics",
    async (effect) => {
      const blueprint = GROUP_2_BLUEPRINTS.find((item) => item.effectId === effect.effectId)!;
      for (const parameter of blueprint.parameters) {
        const effectInstanceId = `test.parameter.${effect.sourceId}.${parameter.name}`;
        let observation: {
          readonly progress: number;
          readonly value: unknown;
          readonly rejected: boolean;
        } | undefined;
        for (const progress of [0.23, 0.51, 0.77]) {
          const fixture = realFixture(
            effect,
            effectInstanceId,
            progress
          );
          const baseline = effect.renderPixels(
            fixture.source.surface,
            effect.defaultPreset,
            fixture.options
          );
          const baselineHash = hashPixelSurface(baseline);
          for (const value of parameterCandidates(parameter)) {
            try {
              const candidate = effect.renderPixels(fixture.source.surface, {
                ...effect.defaultPreset,
                [parameter.name]: value
              }, fixture.options);
              if (hashPixelSurface(candidate) !== baselineHash) {
                observation = { progress, value, rejected: false };
                break;
              }
            } catch {
              observation = { progress, value, rejected: true };
              break;
            }
          }
          if (observation) break;
        }
        expect(
          observation,
          `${effect.sourceId} ${effect.effectId}.${parameter.name} did not change any tested frame`
        ).toBeDefined();
        const baselineFallback = await effect.render(fallbackContext(
          effect,
          effectInstanceId,
          effect.defaultPreset,
          observation!.progress
        ));
        expect(baselineFallback.type).toBe("frame");
        const candidateContext = fallbackContext(
          effect,
          effectInstanceId,
          { ...effect.defaultPreset, [parameter.name]: observation!.value },
          observation!.progress
        );
        if (observation!.rejected) {
          await expect(effect.render(candidateContext)).rejects.toThrow();
        } else {
          const candidateFallback = await effect.render(candidateContext);
          expect(candidateFallback.type).toBe("frame");
          if (baselineFallback.type !== "frame" || candidateFallback.type !== "frame") continue;
          expect(
            candidateFallback.data.pixels,
            `${effect.sourceId} ${effect.effectId}.${parameter.name} fallback remained unchanged`
          ).not.toEqual(baselineFallback.data.pixels);
        }
      }
    }
  );

  it("M01 duration is seconds across a fixed six-second range and holds after completion", async () => {
    const effect = GROUP_2_P0_EFFECTS.find((entry) => entry.sourceId === "M01")!;
    const uiFields = effect.uiSchema.fields as JsonObject;
    const durationField = uiFields.duration as JsonObject;
    expect(effect.defaultPreset.duration).toBe(1);
    expect(durationField.unit).toBe("seconds");

    for (const seconds of [0, 0.25, 1, 3, 5.9]) {
      const progress = seconds / 6;
      const source = realFixture(
        effect,
        `test.duration.${effect.sourceId}`,
        progress,
        64,
        36,
        "srgb",
        20260728,
        "final",
        0,
        30,
        6
      )
        .source.surface;
      const output = await effect.render(fallbackContext(
        effect,
        `test.duration.${effect.sourceId}`,
        { ...effect.defaultPreset, duration: 1, easing: "linear" },
        progress,
        6
      ));
      expect(output.type).toBe("frame");
      if (output.type !== "frame") continue;
      const pixels = output.data.pixels as number[];
      const fraction = Math.min(1, seconds);
      for (let offset = 3; offset < pixels.length; offset += 4) {
        expect(pixels[offset], `alpha@${seconds}s pixel ${offset / 4}`)
          .toBe(Math.round(source.data[offset]! * fraction));
      }
      if (seconds >= 1) expect(pixels).toEqual(surfaceData(source));
    }
  });

  it("uses elapsed seconds for every declared second/rate parameter in the first 40 effects", async () => {
    const cases = [
      ["M01", "duration", "seconds", { duration: 1, easing: "linear" }],
      ["M05", "gravity", "m/s2", { gravity: 9.8, height: 0.4, bounces: 3 }],
      ["M06", "period", "seconds", { period: 0.31, decay: 0.2 }],
      ["M07", "frequency", "hertz", { frequency: 1.3 }],
      ["M08", "frequency", "hertz", { frequency: 12.5, decay: 0.4, intensity: 0.3 }],
      ["T01", "speed", "glyphs/s", { speed: 12 }],
      ["T02", "stagger", "seconds", { stagger: 0.04 }],
      ["T06", "speed", "glyphs/s", { speed: 23.7 }],
      ["L02", "speed", "cycles/s", { speed: 0.8 }]
    ] as const;
    for (const [sourceId, parameter, unit, overrides] of cases) {
      const effect = GROUP_2_P0_EFFECTS.find((entry) => entry.sourceId === sourceId)!;
      const blueprint = GROUP_2_BLUEPRINTS.find((entry) => entry.sourceId === sourceId)!;
      expect(blueprint.parameters.find((entry) => entry.name === parameter)?.unit).toBe(unit);
      const params = { ...effect.defaultPreset, ...overrides };
      const early = await effect.render(fallbackContext(
        effect,
        `test.time-unit.${sourceId}.${parameter}`,
        params,
        0.23 / 2,
        2
      ));
      const later = await effect.render(fallbackContext(
        effect,
        `test.time-unit.${sourceId}.${parameter}`,
        params,
        1.23 / 2,
        2
      ));
      expect(early.type).toBe("frame");
      expect(later.type).toBe("frame");
      if (early.type === "frame" && later.type === "frame") {
        expect(
          later.data.pixels,
          `${sourceId}.${parameter} ignored elapsed seconds`
        ).not.toEqual(early.data.pixels);
      }
    }
  });

  it("renders every G2 effect directly from the official resolveEffectTimeSample output", () => {
    for (const effect of GROUP_2_P0_EFFECTS) {
      const resolved = resolvedTime(
        effect,
        `official.resolve.${effect.sourceId}.instance`,
        0.43,
        1.75
      );
      expect(resolved.time.effectId).toBe(effect.effectId);
      expect(resolved.time.effectInstanceId).toBe(resolved.instance.id);
      const fixture = fixtureAtTime(effect, resolved.time);
      expect(() => effect.renderPixels(
        fixture.source.surface,
        effect.defaultPreset,
        fixture.options
      )).not.toThrow();
    }
  });

  it("rejects missing, empty, or mismatched effect identities instead of inferring them", () => {
    const effect = GROUP_2_P0_EFFECTS.find((entry) => entry.sourceId === "M01")!;
    expect(() => makeEffectTimeSample(effect.effectId, "", 0.5)).toThrow(/effectInstanceId/u);
    const fixture = realFixture(effect, "test.identity.M01", 0.5);
    expect(() => effect.renderPixels(
      fixture.source.surface,
      effect.defaultPreset,
      {
        ...fixture.options,
        time: { ...fixture.time, effectInstanceId: "" }
      }
    )).toThrow(/effectInstanceId/u);
    expect(() => effect.renderPixels(
      fixture.source.surface,
      effect.defaultPreset,
      {
        ...fixture.options,
        time: { ...fixture.time, effectId: "fx.motion.slide" }
      }
    )).toThrow(/effectId/u);
  });

  it("isolates same-type random effects by instance ID and is three-run deterministic", () => {
    const randomSourceIds = new Set(["M08", "T06", "T07", "D02", "D04", "L01"]);
    const randomParams: Record<string, Readonly<Record<string, unknown>>> = {
      M08: { intensity: 0.5, frequency: 13, decay: 0, seedOffset: 0 },
      T06: { speed: 31, lockChance: 0, charset: "ALPHA中文", progress: 0.37 },
      T07: { distance: 0.6, angle: 37, gravity: 0.2, grouping: "word" },
      D02: {
        brushTexture: "builtin://brush/round",
        size: 0.12,
        roughness: 1,
        progress: 0.37
      },
      D04: { grain: 0.8, scatter: 0.9, opacity: 1, progress: 0.37 },
      L01: { color: "#42C8FF", radius: 0.08, intensity: 2, flicker: 1 }
    };
    for (const effect of GROUP_2_P0_EFFECTS.filter((entry) => randomSourceIds.has(entry.sourceId))) {
      const firstTime = resolvedTime(
        effect,
        `random.${effect.sourceId}.instance-a`,
        0.371,
        1
      ).time;
      const secondTime = resolvedTime(
        effect,
        `random.${effect.sourceId}.instance-b`,
        0.371,
        1
      ).time;
      const firstFixture = fixtureAtTime(effect, firstTime, 64, 36, 0x79ab31cf);
      const secondFixture = fixtureAtTime(effect, secondTime, 64, 36, 0x79ab31cf);
      const renderHashes = (fixture: ReturnType<typeof fixtureAtTime>) =>
        Array.from({ length: 3 }, () => hashPixelSurface(effect.renderPixels(
          fixture.source.surface,
          { ...effect.defaultPreset, ...randomParams[effect.sourceId] },
          fixture.options
        )));
      const firstHashes = renderHashes(firstFixture);
      const secondHashes = renderHashes(secondFixture);
      expect(new Set(firstHashes).size, `${effect.sourceId} instance-a determinism`).toBe(1);
      expect(new Set(secondHashes).size, `${effect.sourceId} instance-b determinism`).toBe(1);
      expect(firstHashes[0], `${effect.sourceId} instance streams collided`)
        .not.toBe(secondHashes[0]);
    }
  });

  it("renders the aggregate T08 consumer from official time and a real TextRasterSource", () => {
    const t08 = P0_EFFECTS.find(
      (effect): effect is TextExtrude3DEffectDefinition => effect.sourceId === "T08"
    );
    expect(t08).toBeDefined();
    const fixture = textExtrudeFixture(
      t08!,
      "test.aggregate.T08.official",
      0.43,
      64,
      36
    );
    expect(fixture.time.contractVersion).toBe(TIME_CONTRACT_VERSION);
    expect(fixture.time.effectId).toBe(t08!.effectId);
    expect(fixture.time.effectInstanceId).toBe("test.aggregate.T08.official");
    expect(fixture.input.rasterInput.source.kind).toBe("text");
    expect(fixture.input.rasterInput.source.text.length).toBeGreaterThan(0);
    expect(fixture.input.rasterInput.source.glyphs.every(
      (glyph) => glyph.coverage.data.some((value) => value > 0)
    )).toBe(true);
    const rendered = t08!.renderPixels(fixture.input, t08!.defaultPreset, {
      time: fixture.time,
      seed: 20260728,
      quality: "preview"
    });
    expect(rendered.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(() => t08!.renderPixels(fixture.input.surface as never, t08!.defaultPreset, {
      time: fixture.time,
      seed: 20260728,
      quality: "preview"
    })).toThrow(/TextRasterSource|rasterInput/u);
  });

  it("keeps all 40 Golden effects in frozen P0 order", () => {
    expect(golden.schemaVersion).toBe("1.1.0");
    expect(Object.keys(golden.frames)).toHaveLength(40);
    expect(P0_EFFECTS).toHaveLength(40);
    expect(P0_EFFECTS[0]?.sourceId).toBe("M01");
    expect(P0_EFFECTS[15]?.sourceId).toBe("T08");
    expect(P0_EFFECTS[39]?.sourceId).toBe("H04");
    expect(new Set(Object.keys(golden.frames)))
      .toEqual(new Set(P0_EFFECTS.map((effect) => effect.effectId)));
  });

  it.each(P0_EFFECTS)(
    "$sourceId $effectId matches Golden Frames at 0/25/50/75/100%",
    (effect) => {
      const expected = golden.frames[effect.effectId];
      expect(expected).toBeDefined();
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        if (effect.sourceId === "T08") {
          const fixture = textExtrudeFixture(
            effect,
            golden.t08Source.effectInstanceId,
            progress,
            golden.t08Source.width,
            golden.t08Source.height
          );
          expect(fixture.time.effectId).toBe(effect.effectId);
          expect(fixture.time.effectInstanceId).toBe(golden.t08Source.effectInstanceId);
          expect(fixture.input.rasterInput.source.kind).toBe("text");
          expect(fixture.input.rasterInput.source.text).toBe(golden.t08Source.text);
          expect(fixture.input.rasterInput.source.glyphs.length).toBeGreaterThan(0);
          const rendered = effect.renderPixels(
            fixture.input,
            effect.defaultPreset,
            {
              time: fixture.time,
              seed: golden.t08Source.seed,
              quality: golden.t08Source.quality
            }
          );
          expect(hashPixelSurface(rendered), `T08@${progress}`)
            .toBe(expected![String(progress)]);
          continue;
        }
        const fixture = realFixture(
          effect,
          `golden.cpu.${effect.sourceId}`,
          progress,
          golden.width,
          golden.height
        );
        const rendered = effect.renderPixels(
          fixture.source.surface,
          effect.defaultPreset,
          fixture.options
        );
        expect(hashPixelSurface(rendered), `${effect.effectId}@${progress}`)
          .toBe(expected![String(progress)]);
      }
    }
  );

  it.each(GROUP_2_P0_EFFECTS)("$sourceId $effectId is deterministic and clamps extreme/null-like params", (effect) => {
    const fixture = realFixture(
      effect,
      `test.extreme.${effect.sourceId}`,
      0.5,
      20,
      12,
      "srgb",
      99,
      "draft"
    );
    const normalized = normalizeEffectParams(effect.effectId, {
      ...extremes(effect.effectId),
      ...Object.fromEntries(Object.keys(effect.defaultPreset).map((key) => [key, null]))
    });
    const first = effect.renderPixels(fixture.source.surface, normalized, fixture.options);
    const second = effect.renderPixels(fixture.source.surface, normalized, fixture.options);
    expect(first.data).toEqual(second.data);
    expect(first.data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)).toBe(true);
  });

  it.each(GROUP_2_P0_EFFECTS)("$sourceId $effectId preserves transparent Alpha and obeys a zero mask", (effect) => {
    const fixture = realFixture(
      effect,
      `test.alpha-mask.${effect.sourceId}`,
      0.5,
      10,
      6,
      "srgb",
      7,
      "draft"
    );
    const transparent = { ...fixture.source.surface, data: new Uint8ClampedArray(10 * 6 * 4) };
    transparent.data.fill(0);
    const secondary = { ...fixture.secondary.surface, data: new Uint8ClampedArray(10 * 6 * 4) };
    secondary.data.fill(0);
    const zeroMask = makeMaskSurface(10, 6);
    zeroMask.data.fill(0);
    const unmasked = effect.renderPixels(transparent, effect.defaultPreset, {
      ...fixture.options,
      secondary
    });
    if (effect.category !== "vector" && effect.category !== "draw") {
      for (let offset = 3; offset < unmasked.data.length; offset += 4) expect(unmasked.data[offset]).toBe(0);
    }
    for (let offset = 0; offset < unmasked.data.length; offset += 4) {
      if (unmasked.data[offset + 3] === 0) {
        expect(unmasked.data.slice(offset, offset + 3)).toEqual(new Uint8ClampedArray([0, 0, 0]));
      }
    }
    const masked = effect.renderPixels(fixture.source.surface, effect.defaultPreset, {
      ...fixture.options,
      mask: zeroMask
    });
    for (let offset = 3; offset < masked.data.length; offset += 4) expect(masked.data[offset]).toBe(0);
  });

  it.each(GROUP_2_P0_EFFECTS)(
    "$sourceId $effectId keeps straight and premultiplied fallback output equivalent",
    (effect) => {
      const fixture = realFixture(
        effect,
        `test.alpha-mode.${effect.sourceId}`,
        0.51,
        32,
        18
      );
      const straight = fixture.source.surface;
      const secondaryStraight = fixture.secondary.surface;
      const premultiplied = premultiplySurface(straight);
      const secondaryPremultiplied = premultiplySurface(secondaryStraight);
      const straightOutput = effect.renderPixels(straight, effect.defaultPreset, {
        ...fixture.options,
        secondary: secondaryStraight
      });
      const premultipliedOutput = effect.renderPixels(premultiplied, effect.defaultPreset, {
        ...fixture.options,
        secondary: secondaryPremultiplied
      });
      let maxDelta = 0;
      for (let offset = 0; offset < straightOutput.data.length; offset += 4) {
        expect(premultipliedOutput.data[offset + 3]).toBe(straightOutput.data[offset + 3]);
        const alpha = straightOutput.data[offset + 3]!;
        for (let channel = 0; channel < 3; channel += 1) {
          const expected = Math.round(straightOutput.data[offset + channel]! * alpha / 255);
          maxDelta = Math.max(
            maxDelta,
            Math.abs(expected - premultipliedOutput.data[offset + channel]!)
          );
        }
        if (alpha === 0) {
          expect(premultipliedOutput.data.slice(offset, offset + 3))
            .toEqual(new Uint8ClampedArray([0, 0, 0]));
        }
      }
      expect(maxDelta, `${effect.effectId} exceeded 8-bit associate/unassociate error`).toBeLessThanOrEqual(8);
    }
  );

  it.each(GROUP_2_P0_EFFECTS.filter((effect) => effect.category === "transition"))(
    "$sourceId $effectId maps progress endpoints exactly to A/B without a mask",
    (effect) => {
      const start = realFixture(
        effect,
        `test.endpoint.${effect.sourceId}`,
        0,
        12,
        8,
        "srgb",
        1
      );
      expect(effect.renderPixels(
        start.source.surface,
        effect.defaultPreset,
        start.options
      ).data).toEqual(start.source.surface.data);
      const end = realFixture(
        effect,
        `test.endpoint.${effect.sourceId}`,
        1,
        12,
        8,
        "srgb",
        1
      );
      expect(effect.renderPixels(
        end.source.surface,
        effect.defaultPreset,
        end.options
      ).data).toEqual(end.secondary.surface.data);
    }
  );

  it.each(GROUP_2_P0_EFFECTS)(
    "$sourceId $effectId is invariant to project/layer translation and FPS at equal effect-local samples",
    (effect) => {
      const base = realFixture(
        effect,
        `test.translation.${effect.sourceId}`,
        0.37,
        40,
        24,
        "srgb",
        0x12345678,
        "final",
        0,
        24,
        2
      );
      const shifted = realFixture(
        effect,
        `test.translation.${effect.sourceId}`,
        0.37,
        40,
        24,
        "srgb",
        0x12345678,
        "final",
        137.25,
        120,
        2
      );
      const first = effect.renderPixels(base.source.surface, effect.defaultPreset, base.options);
      const second = effect.renderPixels(shifted.source.surface, effect.defaultPreset, shifted.options);
      expect(hashPixelSurface(second)).toBe(hashPixelSurface(first));
      expect(shifted.time.projectTime).not.toBe(base.time.projectTime);
      expect(shifted.time.frame).not.toBe(base.time.frame);
      expect(shifted.time.effectTime).toBe(base.time.effectTime);
      expect(shifted.time.progress).toBe(base.time.progress);
    }
  );

  it.each(GROUP_2_P0_EFFECTS)(
    "$sourceId $effectId is three-run deterministic across sizes, seeds, and quality grades",
    (effect) => {
      for (const [width, height] of [[24, 14], [40, 22]] as const) {
        for (const seed of [1, 0xfedcba98]) {
          for (const quality of ["draft", "preview", "final"] as const) {
            const fixture = realFixture(
              effect,
              `test.determinism.${effect.sourceId}.${width}x${height}.${seed}.${quality}`,
              0.63,
              width,
              height,
              "srgb",
              seed,
              quality
            );
            const hashes = Array.from({ length: 3 }, () => hashPixelSurface(
              effect.renderPixels(fixture.source.surface, effect.defaultPreset, fixture.options)
            ));
            expect(new Set(hashes).size, `${effect.effectId}/${width}x${height}/${seed}/${quality}`).toBe(1);
          }
        }
      }
    }
  );

  it.each(GROUP_2_P0_EFFECTS)(
    "$sourceId $effectId is consistent for equivalent sRGB, linear-sRGB, and Display-P3 CPU inputs",
    (effect) => {
      const outputs = (["srgb", "linear-srgb", "display-p3"] as const).map((colorSpace) => {
        const fixture = colorFixture(effect, 0.58, colorSpace);
        const output = effect.renderPixels(
          fixture.source.surface,
          effect.defaultPreset,
          fixture.options
        );
        return convertPixelSurface(output, "linear-srgb", "premultiplied");
      });
      for (const candidate of outputs.slice(1)) {
        let maxDelta = 0;
        for (let index = 0; index < candidate.data.length; index += 1) {
          maxDelta = Math.max(maxDelta, Math.abs(candidate.data[index]! - outputs[0]!.data[index]!));
        }
        expect(maxDelta, `${effect.effectId} color-space conformance delta`).toBeLessThanOrEqual(10);
      }
    }
  );

  it.each(GROUP_2_P0_EFFECTS)(
    "$sourceId $effectId applies partial, feathered, inverted, and translated masks",
    (effect) => {
      const fixture = realFixture(
        effect,
        `test.mask-variants.${effect.sourceId}`,
        0.61,
        40,
        24
      );
      const masks = [
        makeMaskSurface(40, 24, 0, false),
        makeMaskSurface(40, 24, 0.2, false),
        makeMaskSurface(40, 24, 0, true)
      ];
      const hashes = masks.map((mask) => hashPixelSurface(effect.renderPixels(
        fixture.source.surface,
        effect.defaultPreset,
        { ...fixture.options, mask }
      )));
      expect(new Set(hashes).size, `${effect.effectId} mask variants`).toBe(3);
    }
  );

  it.each(GROUP_2_P0_EFFECTS)(
    "$sourceId $effectId rejects missing time or raster provenance",
    (effect) => {
      const fixture = realFixture(
        effect,
        `test.invalid-input.${effect.sourceId}`,
        0.5,
        20,
        12
      );
      expect(() => effect.renderPixels(
        fixture.source.surface,
        effect.defaultPreset,
        { ...fixture.options, time: undefined } as never
      )).toThrow(/time/u);
      expect(() => effect.renderPixels(
        fixture.source.surface,
        effect.defaultPreset,
        { ...fixture.options, rasterInput: undefined } as never
      )).toThrow(/rasterInput/u);
    }
  );

  it("uses real multilingual glyph coverage, SVG geometry, decoded media, and explicit brush coverage", () => {
    const textEffect = GROUP_2_P0_EFFECTS.find((effect) => effect.sourceId === "T01")!;
    const text = realFixture(textEffect, "test.real-input.T01", 0.5).source.input.source;
    expect(text.kind).toBe("text");
    if (text.kind === "text") {
      expect(text.text).toMatch(/[A-Za-z]/u);
      expect(text.text).toMatch(/[\u3400-\u9fff]/u);
      expect(text.glyphs.some((glyph) =>
        Array.from(glyph.coverage.data).some((value) => value > 0 && value < 255))).toBe(true);
    }
    const vectorEffect = GROUP_2_P0_EFFECTS.find((effect) => effect.sourceId === "V01")!;
    const vector = realFixture(vectorEffect, "test.real-input.V01", 0.5).source.input.source;
    expect(vector.kind === "shape" || vector.kind === "svg").toBe(true);
    if (vector.kind === "shape" || vector.kind === "svg") {
      expect(vector.paths.some((path) => path.commands.some((command) => command.op === "cubic"))).toBe(true);
    }
    expect(() => parseSvgPathData("not-a-path")).toThrow(/SVG path/u);
    const mediaEffect = GROUP_2_P0_EFFECTS.find((effect) => effect.sourceId === "L01")!;
    const media = realFixture(mediaEffect, "test.real-input.L01", 0.5).source.input.source;
    expect(media.kind === "image" || media.kind === "video").toBe(true);
    if (media.kind === "image" || media.kind === "video") {
      expect(media.pixels.data).toHaveLength(media.pixels.width * media.pixels.height * 4);
      expect(new Set(media.pixels.data).size).toBeGreaterThan(16);
    }
    const brush = makeBrushCoverage();
    expect(brush.data.some((value) => value > 0 && value < 255)).toBe(true);
  });

  it("provides a compilable WebGL2 path descriptor for every effect", () => {
    for (const effect of GROUP_2_P0_EFFECTS) {
      const blueprint = GROUP_2_BLUEPRINTS.find((item) => item.effectId === effect.effectId)!;
      const fixture = realFixture(
        effect,
        `test.webgl-pass.${effect.sourceId}`,
        0.5,
        16,
        9
      );
      const pass = createCatalogWebGLPass(
        blueprint,
        effect.defaultPreset,
        fixture.time,
        7,
        "preview",
        16,
        9,
        fixture.source.input
      );
      expect(pass.id).toBe(effect.effectId);
      expect(pass.fragmentSource).toContain("#version 300 es");
      expect(pass.fragmentSource).toContain("outColor");
      expect(pass.uniforms.u_progress).toBe(0.5);
    }
  });

  it("executes all 40 registered WebGL paths and releases every GPU allocation once", async () => {
    const gl = new FakeWebGL2Context();
    const adapter = new WebGLRendererAdapter({ contextFactory: () => gl });
    adapter.initialize({ width: 16, height: 9, colorSpace: "srgb", quality: "preview" });
    const descriptor = {
      width: 16,
      height: 9,
      format: "rgba8" as const,
      colorSpace: "srgb" as const,
      samples: 1,
      usage: "input" as const
    };
    const a = adapter.createTexture(descriptor);
    const b = adapter.createTexture(descriptor);
    const mask = adapter.createTexture({ ...descriptor, usage: "mask" });
    const frame = {
      time: 0.5,
      projectTime: 0.5,
      deltaTime: 1 / 30,
      frame: 15,
      fps: 30,
      width: 16,
      height: 9,
      seed: 20260728,
      quality: "preview" as const,
      colorSpace: "srgb" as const
    };
    for (const effect of P0_EFFECTS) {
      const g2 = GROUP_2_P0_EFFECTS.find((entry) => entry.effectId === effect.effectId);
      const fixture = g2
        ? realFixture(g2, `test.webgl-resource.${g2.sourceId}`, 0.5, 16, 9)
        : undefined;
      const textFixture = effect.sourceId === "T08"
        ? textExtrudeFixture(
            effect as TextExtrude3DEffectDefinition,
            "test.webgl-resource.T08",
            0.5,
            16,
            9
          )
        : undefined;
      const effectTime = fixture?.time ?? textFixture?.time;
      if (!effectTime) throw new Error(`Missing aggregate timing for ${effect.effectId}.`);
      const effectFrame = {
        ...frame,
        time: effectTime.projectTime,
        projectTime: effectTime.projectTime,
        deltaTime: effectTime.deltaTime,
        frame: effectTime.frame,
        fps: effectTime.fps
      };
      const context = {
        ...effectFrame,
        inputTextures: [a, b],
        params: effect.defaultPreset,
        mask,
        renderer: adapter,
        ...(fixture ? {
          timing: {
            frame,
            layerTime: fixture.source.input.time,
            effectTime: fixture.time
          },
          data: {
            rasterInput: fixture.source.input,
            secondaryRasterInput: fixture.secondary.input,
            dualInputTextures: {
              source: rasterOutput(fixture.source.input, a),
              secondary: rasterOutput(fixture.secondary.input, b)
            },
            brushCoverage: fixture.options.brushCoverage,
            brushAssetId: "builtin://brush/round"
          }
        } : textFixture ? {
          timing: {
            frame: effectFrame,
            layerTime: textFixture.layerTime,
            effectTime: textFixture.time
          },
          data: {
            textRaster: textFixture.input,
            rasterOutput: rasterOutput(textFixture.input.rasterInput, a)
          }
        } : {})
      };
      adapter.beginFrame(context);
      const output = await effect.render(context as never);
      expect(output.type).toBe("texture");
      if (output.type === "texture") adapter.releaseTexture(output.texture);
      adapter.endFrame(context);
    }
    adapter.releaseTexture(a);
    adapter.releaseTexture(b);
    adapter.releaseTexture(mask);
    adapter.dispose();
    expect(gl.drawCalls).toBeGreaterThanOrEqual(40);
    for (const texture of gl.createdTextures) {
      expect(gl.deletedTextures.filter((deleted) => deleted === texture)).toHaveLength(1);
    }
    for (const framebuffer of gl.createdFramebuffers) {
      expect(gl.deletedFramebuffers.filter((deleted) => deleted === framebuffer)).toHaveLength(1);
    }
  });

  it("provides 156 independently addressable effect and preset preview assets", () => {
    const assets = GROUP_2_P0_EFFECTS.flatMap((effect) => [
      effect.preview.asset,
      ...effect.presets.map((preset) => preset.previewAsset)
    ]);
    expect(assets).toHaveLength(156);
    expect(new Set(assets).size).toBe(156);
    for (const asset of assets) {
      expect(asset).not.toContain("#");
      expect(existsSync(new URL(`../${asset.replace(/^\.\//u, "")}`, import.meta.url)), asset).toBe(true);
    }
  });

  it("publishes a complete 39 by 20 S5R self-check matrix", () => {
    const matrix = JSON.parse(readFileSync(
      new URL("./fixtures/s5r-self-check.json", import.meta.url),
      "utf8"
    )) as {
      dimensions: string[];
      rows: Array<{ checks: Record<string, { status: string }> }>;
      totals: { effects: number; dimensions: number; checks: number; passed: number };
    };
    expect(new Set(matrix.dimensions).size).toBe(20);
    expect(matrix.rows).toHaveLength(39);
    expect(matrix.totals).toEqual({
      effects: 39,
      dimensions: 20,
      checks: 780,
      passed: 780
    });
    for (const row of matrix.rows) {
      expect(Object.keys(row.checks)).toEqual(matrix.dimensions);
      expect(Object.values(row.checks).every((check) => check.status === "PASS")).toBe(true);
    }
  });

  it("keeps package 1.2.0 independent from 1.1.0 definitions and presets", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    expect(packageJson.version).toBe("1.2.0");
    expect(readme).toContain("1.1.0");
    expect(changelog).toContain("1.1.0");
    for (const effect of GROUP_2_P0_EFFECTS) {
      expect(effect.version).toBe("1.1.0");
      expect(effect.presets.every((preset) => preset.version === "1.1.0")).toBe(true);
      expect(effect.migrationHandlers).toContainEqual(expect.objectContaining({
        fromVersion: "1.0.0",
        toVersion: "1.1.0"
      }));
    }
  });

  it("documents every effect in README and CHANGELOG", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    for (const effect of GROUP_2_P0_EFFECTS) {
      expect(readme).toContain(effect.effectId);
      expect(readme).toContain(`id="${effect.sourceId.toLowerCase()}-${effect.effectId.replaceAll(".", "").toLowerCase()}"`);
      expect(changelog).toContain(`### ${effect.sourceId}`);
      expect(changelog).toContain(effect.effectId);
    }
  });

  it("releases each effect instance through dispose", () => {
    const effects = createGroup2P0Effects();
    for (const effect of effects) {
      const source = makePreviewInput(
        effect.effectId,
        `test.dispose.${effect.sourceId}`,
        4,
        4
      );
      effect.dispose();
      expect(() => effect.renderPixels(source)).toThrow(/disposed/u);
    }
  });

  it("recognizes the delivered Group 3 T08 frozen interface and acceptance metadata", () => {
    const t08 = P0_EFFECTS_BY_ID.get("fx.text.textExtrude3D");
    expect(t08).toBeDefined();
    expect(verifyGroup3TextExtrudeInterface(t08)).toEqual({
      effectId: "fx.text.textExtrude3D",
      available: true,
      compatible: true,
      missing: []
    });
    expect(t08!.version).toBe("1.0.0");
    expect(t08!.implementationOwner).toBe("Group 3");
    expect(validateContract("EffectDefinition", contractView(t08!)).valid).toBe(true);
    const schema = t08!.parameterSchema as JsonObject;
    const required = schema.required as string[];
    const properties = schema.properties as JsonObject;
    const fields = t08!.uiSchema.fields as JsonObject;
    for (const name of ["depth", "bevel", "material", "light"]) {
      expect(required).toContain(name);
      expect(properties[name]).toBeDefined();
      expect(fields[name]).toBeDefined();
    }
    expect(t08!.presets).toHaveLength(3);
    expect(t08!.preferredBackend).toBe("webgl");
    expect(t08!.fallbackBackend).toBe("canvas2d");
    expect(t08!.qualityLevels.map((level) => level.quality)).toEqual(["draft", "preview", "final"]);
    expect(t08!.performanceClass).toBe("heavy");
    expect(t08!.benchmarkBudgetMs).toBeGreaterThan(0);
    expect(t08!.supportsAlpha).toBe(true);
    expect(t08!.supportsMask).toBe(true);
    expect(t08!.deterministic).toBe(true);
  });
});
