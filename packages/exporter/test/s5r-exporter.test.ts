import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  Animatable,
  EffectInstance,
  JsonObject,
  LayerDefinition,
  MotionProject,
  TransformDefinition
} from "@codemotion/core";
import {
  P0_EFFECTS,
  makeBrushCoverage,
  makeEffectTimeSample,
  makeRealInputFixture,
  makeTextExtrudeCatalogFixture,
  type P0CatalogEffectDefinition,
  type RealInputKind
} from "@codemotion/effects-2d";
import {
  createTextExtrude3DWebGLPass,
  createTextExtrusionGeometry,
  normalizeTextExtrude3DParams
} from "@codemotion/effects-3d";
import type { LayerRasterSource } from "@codemotion/renderer-api";
import {
  createProjectFrameProducer,
  exportFixedFrames,
  migrateProjectEffectTiming,
  type ExportPreset,
  type FrameRequest
} from "../src/index.js";

const WIDTH = 32;
const HEIGHT = 24;
const FPS = 47;
const EFFECT_START = 0.25;
const EFFECT_END = 1.25;
const LAYER_START = 2;

function constant<T extends JsonObject | number>(value: T): Animatable<T> {
  return { mode: "constant", value };
}

function transform(positionX = 0): TransformDefinition {
  return {
    anchorPoint: constant({ x: 0, y: 0, z: 0 }),
    position: constant({ x: positionX, y: 0, z: 0 }),
    scale: constant({ x: 100, y: 100, z: 100 }),
    rotation: constant({ x: 0, y: 0, z: 0 })
  };
}

function inputKind(effect: P0CatalogEffectDefinition): RealInputKind {
  if (effect.sourceId.startsWith("T")) return "text";
  if (effect.sourceId.startsWith("V") || effect.sourceId.startsWith("D")) return "vector";
  return "media";
}

function layerType(kind: RealInputKind): "text" | "svg" | "image" {
  return kind === "text" ? "text" : kind === "vector" ? "svg" : "image";
}

function layer(
  id: string,
  kind: RealInputKind,
  effect?: EffectInstance,
  positionX = 0,
  opacity: Animatable<number> = constant(1)
): LayerDefinition {
  const common = {
    id,
    type: layerType(kind),
    name: id,
    visible: true,
    locked: false,
    solo: false,
    startTime: LAYER_START,
    endTime: LAYER_START + 2,
    inPoint: 0,
    outPoint: 2,
    zIndex: id === "secondary" ? 0 : 1,
    transform: transform(positionX),
    opacity,
    blendMode: "normal" as const,
    masks: [],
    effects: effect === undefined ? [] : [effect],
    properties: kind === "text"
      ? { text: "FX", fontFamily: "fixture", fontSize: 12 }
      : kind === "vector" ? { svg: "fixture" } : { fit: "fill" as const }
  };
  return (kind === "media"
    ? { ...common, source: { assetId: `${id}.asset` } }
    : common) as LayerDefinition;
}

function projectFor(
  effect: P0CatalogEffectDefinition,
  source: LayerRasterSource,
  secondary: LayerRasterSource
): { project: MotionProject; sources: ReadonlyMap<string, LayerRasterSource> } {
  const instance: EffectInstance = {
    id: `instance.${effect.sourceId}`,
    effectId: effect.effectId,
    version: effect.version,
    enabled: true,
    startTime: EFFECT_START,
    endTime: EFFECT_END,
    mix: {
      mode: "keyframes",
      keyframes: [
        { time: 0, value: 0, interpolation: "linear" },
        { time: 1, value: 1, interpolation: "linear" }
      ]
    },
    params: {}
  };
  const kind = inputKind(effect);
  const primary = layer("primary", kind, instance);
  if (primary.type === "text" && source.kind === "text") {
    primary.properties.text = source.text;
    primary.properties.fontFamily = source.font.family;
    primary.properties.fontSize = Math.max(
      1,
      ...source.glyphs.map((glyph) => glyph.bounds.height)
    );
  }
  const secondaryLayer = layer("secondary", "media");
  return {
    project: {
      schemaVersion: "1.2.0",
      engineVersion: "0.3.0",
      id: `project.${effect.sourceId}`,
      name: effect.effectId,
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      duration: 8,
      background: { type: "transparent" },
      colorSpace: "srgb",
      seed: 0x12345678,
      assets: [],
      compositions: [{
        id: "main",
        name: "main",
        width: WIDTH,
        height: HEIGHT,
        duration: 8,
        fps: FPS,
        layers: [secondaryLayer, primary]
      }],
      fonts: [],
      audioTracks: [],
      renderPresets: [],
      metadata: { timeContractVersion: "1.1.0" }
    },
    sources: new Map([["primary", source], ["secondary", secondary]])
  };
}

function requestAt(time: number): FrameRequest {
  return {
    frame: Math.floor(time * FPS),
    time,
    deltaTime: 1 / FPS,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT
  };
}

function digest(frame: Uint8Array): string {
  return createHash("sha256").update(frame).digest("hex");
}

function nonTransparent(frame: Uint8Array): number {
  let count = 0;
  for (let index = 3; index < frame.length; index += 4) {
    if (frame[index] !== 0) count += 1;
  }
  return count;
}

function averageVisibleAlpha(frame: Uint8Array): number {
  let total = 0;
  for (let index = 3; index < frame.length; index += 4) total += frame[index]!;
  return total / (frame.length / 4);
}

function qaPreset(): ExportPreset {
  return {
    id: "aggregate-qa",
    name: "aggregate QA",
    format: "png-sequence",
    quality: "final",
    settings: {
      width: 8,
      height: 8,
      fps: 4,
      alpha: true,
      audio: false
    }
  };
}

describe("S5R project exporter consumption", () => {
  it("renders all 40 P0 effects from real raster inputs at effect-local key times deterministically", async () => {
    expect(P0_EFFECTS).toHaveLength(40);
    for (const effect of P0_EFFECTS) {
      const kind = inputKind(effect);
      const sample = makeEffectTimeSample(effect.effectId, `fixture.${effect.sourceId}`, 0.5);
      const source = makeRealInputFixture(effect.effectId, kind, WIDTH, HEIGHT, false, "srgb", sample).input.source;
      const secondary = makeRealInputFixture(effect.effectId, "media", WIDTH, HEIGHT, true, "srgb", sample).input.source;
      const fixture = projectFor(effect, source, secondary);
      const producer = createProjectFrameProducer(fixture.project, new Map(), {
        rasterSources: fixture.sources,
        secondaryLayerIds: new Map([[`instance.${effect.sourceId}`, "secondary"]]),
        coverageAssets: new Map([["builtin://brush/round", makeBrushCoverage()]])
      });
      const times = [
        LAYER_START + EFFECT_START,
        LAYER_START + EFFECT_START + 0.5,
        LAYER_START + EFFECT_END - 1 / FPS
      ];
      for (const time of times) {
        const first = await producer(requestAt(time));
        const second = await producer(requestAt(time));
        expect(nonTransparent(first), `${effect.sourceId} ${time}`).toBeGreaterThan(0);
        expect(digest(second), `${effect.sourceId} deterministic ${time}`).toBe(digest(first));
      }
    }
  }, 30_000);

  it("publishes a passing 40x5x4 post-decode pixel evidence matrix", async () => {
    const evidence = JSON.parse(await readFile(
      new URL("./fixtures/s5r-export-evidence.json", import.meta.url),
      "utf8"
    )) as {
      summary: {
        effects: number;
        timepointsPerEffect: number;
        formatsPerEffect: number;
        matrixCells: number;
        passedCells: number;
        pass: boolean;
      };
      effects: Array<{
        sourceId: string;
        featureChecks: {
          deterministic: boolean;
          transformDeltaPixels: number;
          maskDeltaPixels: number;
          effectDeltaPixels: number;
          alphaPixels: number;
          textGlyphCoverage: boolean | null;
          dualInput: boolean | null;
          goldenSemantics: boolean;
          goldenDistinctFrames: number;
          previewDistinctFrames: number;
          t08Consumer: {
            input: string;
            unicodeText: string;
            threeRunDeterministic: boolean;
            cpuGoldenFrames: number;
            webglGoldenFrames: number;
            webglDistinctFrames: number;
            timeContractVersion: string;
          } | null;
        };
        formats: Array<{
          format: string;
          encodeMs: number;
          decodeMs: number;
          realtimeMultiple: number;
          fileBytes: number;
          foregroundCells: number;
          decodedDistinctFrames: number;
          pass: boolean;
          threshold: {
            rgbMae: number;
            alphaMae: number;
            maxChannelError: number;
            minForegroundPixels: number;
          };
          cells: Array<{
            progress: number;
            goldenHash: string;
            expectedBlank: boolean;
            previewSha256: string;
            decodedSha256: string;
            rgbMae: number;
            alphaMae: number;
            maxChannelError: number;
            foregroundPixels: number;
            pass: boolean;
          }>;
        }>;
        pass: boolean;
      }>;
    };
    expect(evidence.summary).toMatchObject({
      effects: 40,
      timepointsPerEffect: 5,
      formatsPerEffect: 4,
      matrixCells: 800,
      passedCells: 800,
      pass: true
    });
    expect(new Set(evidence.effects.map((effect) => effect.sourceId)).size).toBe(40);
    for (const effect of evidence.effects) {
      expect(effect.featureChecks.deterministic, effect.sourceId).toBe(true);
      expect(effect.featureChecks.transformDeltaPixels, `${effect.sourceId} transform`).toBeGreaterThan(0);
      expect(effect.featureChecks.maskDeltaPixels, `${effect.sourceId} mask`).toBeGreaterThan(0);
      expect(effect.featureChecks.effectDeltaPixels, `${effect.sourceId} effect`).toBeGreaterThan(0);
      expect(effect.featureChecks.alphaPixels, `${effect.sourceId} Alpha`).toBeGreaterThan(0);
      expect(effect.featureChecks.goldenSemantics, `${effect.sourceId} Golden`).toBe(true);
      if (effect.sourceId.startsWith("T")) {
        expect(effect.featureChecks.textGlyphCoverage, `${effect.sourceId} text`).toBe(true);
      }
      if (effect.sourceId === "T08") {
        expect(effect.featureChecks.t08Consumer).toMatchObject({
          input: "TextExtrude3DRasterInput",
          threeRunDeterministic: true,
          cpuGoldenFrames: 5,
          webglGoldenFrames: 5,
          webglDistinctFrames: 5,
          timeContractVersion: "1.1.0"
        });
        expect(effect.featureChecks.t08Consumer?.unicodeText.length).toBeGreaterThan(0);
      }
      if (effect.sourceId.startsWith("C") || effect.sourceId.startsWith("H")) {
        expect(effect.featureChecks.dualInput, `${effect.sourceId} dual input`).toBe(true);
      }
      expect(effect.formats.map((format) => format.format)).toEqual([
        "png-sequence", "gif", "webm", "mp4"
      ]);
      for (const format of effect.formats) {
        expect(format.encodeMs, `${effect.sourceId} ${format.format} encode`).toBeGreaterThan(0);
        expect(format.decodeMs, `${effect.sourceId} ${format.format} decode`).toBeGreaterThan(0);
        expect(format.realtimeMultiple, `${effect.sourceId} ${format.format} speed`).toBeGreaterThan(0);
        expect(format.fileBytes, `${effect.sourceId} ${format.format} bytes`).toBeGreaterThan(0);
        expect(format.foregroundCells, `${effect.sourceId} ${format.format} aggregate foreground`).toBeGreaterThan(0);
        if (effect.featureChecks.goldenDistinctFrames > 1) {
          expect(format.decodedDistinctFrames, `${effect.sourceId} ${format.format} observable change`)
            .toBeGreaterThan(1);
        }
        expect(format.cells.map((cell) => cell.progress)).toEqual([0, 0.25, 0.5, 0.75, 1]);
        for (const cell of format.cells) {
          expect(cell.goldenHash).toMatch(/^[0-9a-f]{8}$/);
          expect(cell.previewSha256).toMatch(/^[0-9a-f]{64}$/);
          expect(cell.decodedSha256).toMatch(/^[0-9a-f]{64}$/);
          expect(cell.rgbMae).toBeLessThanOrEqual(format.threshold.rgbMae);
          expect(cell.alphaMae).toBeLessThanOrEqual(format.threshold.alphaMae);
          expect(cell.maxChannelError).toBeLessThanOrEqual(format.threshold.maxChannelError);
          if (!cell.expectedBlank) expect(cell.foregroundPixels).toBeGreaterThan(0);
          expect(cell.pass).toBe(true);
        }
        expect(format.pass).toBe(true);
      }
      expect(effect.pass).toBe(true);
    }
    const fade = evidence.effects.find((effect) => effect.sourceId === "M01")!;
    for (const format of fade.formats) {
      expect(format.cells[0]!.expectedBlank, `${format.format} M01@0`).toBe(true);
      expect(format.cells[0]!.foregroundPixels, `${format.format} M01@0 decoded`).toBe(0);
      expect(format.cells[1]!.expectedBlank, `${format.format} M01@25`).toBe(false);
      expect(format.cells[4]!.expectedBlank, `${format.format} M01@100`).toBe(false);
    }
  });

  it("consumes T08 official Unicode raster/time input across durations, FPS and instances", async () => {
    const effect = P0_EFFECTS.find((entry) => entry.sourceId === "T08")!;
    const scenarios = [
      { text: "AΩ", instanceId: "instance.t08.export.a", duration: 2.6, fps: 23, start: 0.4 },
      { text: "FX3D", instanceId: "instance.t08.export.b", duration: 7.3, fps: 59, start: 1.1 }
    ] as const;
    const scenarioHashes: string[][] = [];
    for (const scenario of scenarios) {
      const sourceFixture = makeTextExtrudeCatalogFixture({
        effectId: "fx.text.textExtrude3D",
        effectInstanceId: scenario.instanceId,
        text: scenario.text,
        width: WIDTH,
        height: HEIGHT,
        effectTime: scenario.duration / 2,
        duration: scenario.duration,
        fps: scenario.fps,
        projectStart: scenario.start
      });
      const secondaryTime = makeEffectTimeSample(
        effect.effectId,
        `${scenario.instanceId}.secondary`,
        scenario.duration / 2,
        scenario.duration,
        scenario.start,
        scenario.fps
      );
      const secondary = makeRealInputFixture(
        effect.effectId,
        "media",
        WIDTH,
        HEIGHT,
        true,
        "srgb",
        secondaryTime
      ).input.source;
      const fixture = projectFor(effect, sourceFixture.input.rasterInput.source, secondary);
      const primary = fixture.project.compositions[0]!.layers.find((entry) => entry.id === "primary")!;
      primary.startTime = scenario.start;
      primary.endTime = scenario.start + scenario.duration + 0.5;
      primary.inPoint = 0;
      primary.outPoint = scenario.duration + 0.5;
      const instance = primary.effects[0]!;
      instance.id = scenario.instanceId;
      instance.startTime = 0;
      instance.endTime = scenario.duration + 1e-6;
      instance.mix = constant(1);
      fixture.project.fps = scenario.fps;
      fixture.project.duration = scenario.start + scenario.duration + 1;
      fixture.project.compositions[0]!.fps = scenario.fps;
      fixture.project.compositions[0]!.duration = fixture.project.duration;
      const producer = createProjectFrameProducer(fixture.project, new Map(), {
        rasterSources: fixture.sources
      });
      const hashes: string[] = [];
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        const time = scenario.start + scenario.duration * progress;
        const request: FrameRequest = {
          frame: Math.floor(time * scenario.fps),
          time,
          deltaTime: progress === 0 ? 0 : 1 / scenario.fps,
          fps: scenario.fps,
          width: WIDTH,
          height: HEIGHT
        };
        const runs = await Promise.all([
          producer(request),
          producer(request),
          producer(request)
        ]);
        expect(new Set(runs.map(digest)).size, `${scenario.instanceId}@${progress}`).toBe(1);
        expect(nonTransparent(runs[0]!), `${scenario.instanceId}@${progress}`).toBeGreaterThan(0);
        hashes.push(digest(runs[0]!));

        const official = makeTextExtrudeCatalogFixture({
          effectId: "fx.text.textExtrude3D",
          effectInstanceId: scenario.instanceId,
          text: scenario.text,
          width: WIDTH,
          height: HEIGHT,
          effectTime: scenario.duration * progress,
          duration: scenario.duration,
          fps: scenario.fps,
          projectStart: scenario.start
        });
        expect(official.time).toMatchObject({
          contractVersion: "1.1.0",
          effectId: effect.effectId,
          effectInstanceId: scenario.instanceId,
          fps: scenario.fps
        });
        expect(official.time.progress).toBeCloseTo(progress, 12);
        const params = normalizeTextExtrude3DParams(effect.defaultPreset);
        const geometry = createTextExtrusionGeometry(official.input, params, "final");
        const webgl = createTextExtrude3DWebGLPass(params, official.time, "final", geometry);
        expect(webgl.uniforms.u_progress).toBeCloseTo(progress, 12);
        expect(webgl.geometry.indices.length).toBeGreaterThan(0);
      }
      expect(new Set(hashes).size, scenario.instanceId).toBe(5);
      scenarioHashes.push(hashes);
    }
    expect(scenarioHashes[0]).not.toEqual(scenarioHashes[1]);
  });

  it("applies transform and Alpha while preserving legal production blank frames", async () => {
    const effect = P0_EFFECTS.find((entry) => entry.sourceId === "M01")!;
    const sample = makeEffectTimeSample(effect.effectId, "fixture.transform", 0.5);
    const source = makeRealInputFixture(effect.effectId, "media", WIDTH, HEIGHT, false, "display-p3", sample).input.source;
    const fixture = projectFor(effect, source, source);
    fixture.project.compositions[0]!.layers = [
      layer("primary", "media", undefined, 5, constant(0.5))
    ];
    const producer = createProjectFrameProducer(fixture.project, new Map(), {
      rasterSources: new Map([["primary", source]])
    });
    const frame = await producer(requestAt(LAYER_START + 0.5));
    expect(frame.slice(0, 5 * 4).every((byte) => byte === 0)).toBe(true);
    expect(Array.from(frame).some((byte, index) => index % 4 === 3 && byte > 0 && byte < 255)).toBe(true);

    fixture.project.compositions[0]!.layers = [];
    const backgroundOnly = createProjectFrameProducer(fixture.project, new Map());
    expect(nonTransparent(await backgroundOnly(requestAt(0.5)))).toBe(0);
    const strictAcceptance = createProjectFrameProducer(fixture.project, new Map(), {
      rejectBackgroundOnlyFrames: true
    });
    await expect(strictAcceptance(requestAt(0.5))).rejects.toThrow(/only the project background/);
  });

  it("preserves M01 blank/partial/complete Golden semantics and legal layer delay", async () => {
    const effect = P0_EFFECTS.find((entry) => entry.sourceId === "M01")!;
    const sample = makeEffectTimeSample(effect.effectId, "fixture.fade", 0.5);
    const source = makeRealInputFixture(effect.effectId, "media", WIDTH, HEIGHT, false, "srgb", sample).input.source;
    const secondary = makeRealInputFixture(effect.effectId, "media", WIDTH, HEIGHT, true, "srgb", sample).input.source;
    const fixture = projectFor(effect, source, secondary);
    const primary = fixture.project.compositions[0]!.layers.find((entry) => entry.id === "primary")!;
    const auxiliary = fixture.project.compositions[0]!.layers.find((entry) => entry.id === "secondary")!;
    auxiliary.visible = false;
    primary.effects[0]!.mix = constant(1);
    const producer = createProjectFrameProducer(fixture.project, new Map(), {
      rasterSources: fixture.sources,
      secondaryLayerIds: new Map([["instance.M01", "secondary"]])
    });
    const start = await producer(requestAt(LAYER_START + EFFECT_START));
    const quarter = await producer(requestAt(LAYER_START + EFFECT_START + 0.25));
    const complete = await producer(requestAt(LAYER_START + EFFECT_END - 1e-7));
    expect(nonTransparent(start)).toBe(0);
    expect(nonTransparent(quarter)).toBeGreaterThan(0);
    expect(averageVisibleAlpha(quarter)).toBeGreaterThan(0);
    expect(averageVisibleAlpha(quarter)).toBeLessThan(averageVisibleAlpha(complete));

    primary.effects = [];
    primary.startTime = 0.5;
    primary.endTime = 1.5;
    const delayed = createProjectFrameProducer(fixture.project, new Map(), {
      rasterSources: fixture.sources
    });
    expect(nonTransparent(await delayed(requestAt(0.25)))).toBe(0);
    expect(nonTransparent(await delayed(requestAt(0.75)))).toBeGreaterThan(0);
  });

  it("uses explicit aggregate QA to allow delayed blanks and reject an all-background segment", async () => {
    const blank = new Uint8Array(8 * 8 * 4);
    const visible = new Uint8Array(blank);
    for (let index = 0; index < visible.length; index += 4) {
      visible[index] = 80;
      visible[index + 1] = 190;
      visible[index + 2] = 240;
      visible[index + 3] = 255;
    }
    const isBackgroundFrame = (frame: Uint8Array) => frame.every((byte) => byte === 0);
    const legal = await exportFixedFrames({
      preset: qaPreset(),
      duration: 3 / 4,
      outputPath: resolve("tmp/s5r-blank-qa/legal"),
      renderFrame(request) {
        return request.frame < 2 ? blank : visible;
      },
      qa: { isBackgroundFrame }
    });
    expect(legal.qa).toEqual({
      activeFrames: 3,
      backgroundFrames: 2,
      foregroundFrames: 1,
      distinctFrames: 2,
      passed: true
    });
    await expect(exportFixedFrames({
      preset: qaPreset(),
      duration: 3 / 4,
      outputPath: resolve("tmp/s5r-blank-qa/all-background"),
      renderFrame() {
        return blank;
      },
      qa: { isBackgroundFrame }
    })).rejects.toThrow(/Aggregate QA rejected/);
  });

  it("migrates legacy absolute effect windows without mutating the source instance", () => {
    const effect: EffectInstance = {
      id: "legacy",
      effectId: "fx.motion.position",
      version: "1.1.0",
      enabled: true,
      startTime: 2.25,
      endTime: 3.25,
      mix: constant(1),
      params: {}
    };
    const owner = layer("primary", "media", effect);
    const migrated = migrateProjectEffectTiming(effect, owner, "0.0.0");
    expect(migrated.startTime).toBe(0.25);
    expect(migrated.endTime).toBe(1.25);
    expect(effect.startTime).toBe(2.25);
    expect(migrateProjectEffectTiming(effect, owner, "1.1.0")).toBe(effect);
  });
});
