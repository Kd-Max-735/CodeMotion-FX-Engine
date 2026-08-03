import { describe, expect, it } from "vitest";
import type { LayerTimeSample } from "@codemotion/core";
import {
  BACKEND_CONFORMANCE_CONTRACT,
  BLEND_CONFORMANCE_FIXTURES,
  COLOR_CONFORMANCE_FIXTURES,
  RASTER_COORDINATE_CONTRACT,
  RASTERIZATION_CONTRACT_VERSION,
  assertDualInputTextures,
  assertLayerRasterizationInput,
  assertLayerRasterizationOutput,
  assertTemporalEffectContext,
  type LayerRasterSource,
  type LayerRasterizationInput,
  type LayerRasterizationOutput,
  type RasterSourceKind,
  type TextureDescriptor
} from "../src/index.js";

const time: LayerTimeSample = {
  contractVersion: "1.1.0",
  layerId: "layer.fixture",
  active: true,
  projectTime: 4,
  localTime: 1.25,
  sourceTime: 1.25,
  deltaTime: 0.04
};
const transform = {
  matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
  anchor: [0, 0] as const
};
const target: TextureDescriptor = {
  width: 4,
  height: 4,
  format: "rgba8",
  colorSpace: "linear-srgb",
  samples: 1,
  usage: "intermediate"
};

function sources(): readonly LayerRasterSource[] {
  const coverage = {
    width: 2,
    height: 2,
    data: new Uint8Array([0, 128, 255, 64]),
    rowOrder: "top-to-bottom" as const
  };
  const path = {
    commands: [
      { op: "move" as const, x: 0, y: 0 },
      { op: "line" as const, x: 2, y: 0 },
      { op: "line" as const, x: 1, y: 2 },
      { op: "close" as const }
    ],
    fillRule: "nonzero" as const,
    fill: "#ff0000",
    stroke: null,
    strokeWidth: 0
  };
  const pixels = {
    width: 2,
    height: 2,
    data: new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 128,
      0, 0, 255, 64, 255, 255, 255, 0
    ]),
    colorSpace: "srgb" as const,
    alphaMode: "straight" as const,
    rowOrder: "top-to-bottom" as const
  };
  return [
    {
      kind: "text",
      text: "fixture",
      font: {
        fontId: "font.fixture",
        assetId: "asset.font.fixture",
        assetHash: "sha256:font-fixture",
        family: "Fixture Sans",
        style: "normal",
        weight: 400,
        unitsPerEm: 1000,
        missingGlyphPolicy: "use-notdef",
        notdefGlyphId: 0
      },
      fillRgba: [0.2, 0.4, 0.6, 0.8],
      glyphs: [{
        glyphId: 42,
        cluster: 0,
        advance: 2,
        offsetX: 0,
        offsetY: 0,
        bounds: { x: 0, y: 0, width: 2, height: 2 },
        coverage
      }]
    },
    { kind: "shape", viewport: { x: 0, y: 0, width: 2, height: 2 }, paths: [path] },
    { kind: "svg", viewport: { x: 0, y: 0, width: 2, height: 2 }, paths: [path] },
    { kind: "image", assetId: "asset.image", assetHash: "sha256:image", frameTime: 0, pixels },
    { kind: "video", assetId: "asset.video", assetHash: "sha256:video", frameTime: 1.25, pixels }
  ];
}

function input(source: LayerRasterSource): LayerRasterizationInput {
  return {
    layerId: `layer.${source.kind}`,
    layerType: source.kind,
    source,
    time,
    transform,
    opacity: 0.8,
    masks: [{
      id: "mask.alpha",
      mode: "intersect",
      inverted: false,
      opacity: 0.5,
      coverage: {
        width: 2,
        height: 2,
        data: new Uint8Array([255, 128, 64, 0]),
        rowOrder: "top-to-bottom"
      },
      transform
    }],
    target
  };
}

function output(kind: RasterSourceKind, id: string): LayerRasterizationOutput {
  return {
    texture: { id, backend: "canvas2d", descriptor: target },
    sourceKind: kind,
    contentBounds: { x: 0, y: 0, width: 3, height: 3 },
    coveredPixelCount: 7,
    contentDigest: `sha256:${kind}`,
    alphaMode: "premultiplied",
    usedSolidFallback: false
  };
}

describe("public layer rasterization conformance", () => {
  it("accepts real glyph, Shape/SVG path, image, video, Alpha, mask, and transform inputs", () => {
    for (const source of sources()) {
      const request = input(source);
      expect(() => assertLayerRasterizationInput(request)).not.toThrow();
      expect(() => assertLayerRasterizationOutput(request, output(source.kind, `texture.${source.kind}`))).not.toThrow();
    }
    expect(RASTER_COORDINATE_CONTRACT).toMatchObject({
      contractVersion: "1.1.0",
      origin: "top-left",
      pixelBounds: "half-open",
      pixelCenterOffset: 0.5,
      outputAlphaMode: "premultiplied"
    });
    expect(RASTERIZATION_CONTRACT_VERSION).toBe("1.1.0");
  });

  it("validates optional text fillRgba while preserving legacy omission", () => {
    const text = sources()[0];
    if (text?.kind !== "text") throw new Error("Text fixture missing.");
    const { fillRgba: _fillRgba, ...legacy } = text;
    expect(() => assertLayerRasterizationInput(input(legacy))).not.toThrow();
    for (const fillRgba of [
      [0, 0, 0] as unknown as readonly [number, number, number, number],
      [0, 0, 0, 2] as const,
      [0, 0, 0, Number.NaN] as const,
      [0, 0, 0, Number.POSITIVE_INFINITY] as const
    ]) {
      expect(() => assertLayerRasterizationInput(input({ ...text, fillRgba }))).toThrow(/fillRgba/);
    }
  });

  it("rejects non-content vector fallback and aliased dual inputs", () => {
    const invalid = input({
      kind: "shape",
      viewport: { x: 0, y: 0, width: 1, height: 1 },
      paths: []
    });
    expect(() => assertLayerRasterizationInput(invalid)).toThrow(/real path/);

    const source = output("image", "texture.same");
    expect(() => assertDualInputTextures({ source, secondary: source })).toThrow(/independently materialized/);
    expect(() => assertDualInputTextures({
      source: output("image", "texture.a"),
      secondary: output("video", "texture.b")
    })).not.toThrow();
  });

  it("rejects inconsistent public time channels", () => {
    const frame = {
      time: 4,
      projectTime: 4,
      deltaTime: 0.04,
      frame: 100,
      fps: 25,
      width: 4,
      height: 4,
      seed: 1,
      quality: "preview" as const,
      colorSpace: "linear-srgb" as const
    };
    const effectTime = {
      contractVersion: "1.1.0" as const,
      effectId: [time.layerId, frame.fps.toString(36)].join(":"),
      effectInstanceId: [time.layerId, frame.frame.toString(36)].join(":"),
      active: true,
      projectTime: 4,
      layerTime: time.localTime,
      effectTime: 0.25,
      progress: 0.5,
      deltaTime: 0.04,
      fps: 25,
      frame: 100
    };
    expect(() => assertTemporalEffectContext({ frame, layerTime: time, effectTime })).not.toThrow();
    expect(() => assertTemporalEffectContext({
      frame,
      layerTime: time,
      effectTime: { ...effectTime, layerTime: time.localTime + 1 }
    })).toThrow(/inconsistent/);
  });
});

describe("public color and backend fixtures", () => {
  it("freezes conversion, Alpha association, blend, and backend tolerances", () => {
    expect(COLOR_CONFORMANCE_FIXTURES.map((fixture) => fixture.id)).toEqual([
      "srgb-straight-to-linear-premultiplied",
      "display-p3-to-srgb"
    ]);
    expect(BLEND_CONFORMANCE_FIXTURES).toHaveLength(1);
    expect(BACKEND_CONFORMANCE_CONTRACT).toMatchObject({
      workingColorSpace: "linear-srgb",
      rgba8ChannelTolerance: 1,
      unsupportedBehavior: "report-capability-or-fail-never-silent-approximation"
    });
  });
});
