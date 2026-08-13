import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type { JsonObject, LayerDefinition } from "@codemotion/core";
import type { LayerRasterizationInput, LayerRasterSource } from "@codemotion/renderer-api";
import * as EffectsRoot from "../src/index.js";
import {
  FORMAL_2D_RASTER_ADAPTER_VERSION,
  Formal2dRasterErrorV1,
  rasterizeLayerInput,
  resolveFormal2dRasterSourceV1,
  type Formal2dRasterRequestV1
} from "../src/index.js";

const transform = {
  anchorPoint: { mode: "constant" as const, value: { x: 0, y: 0, z: 0 } },
  position: { mode: "constant" as const, value: { x: 0, y: 0, z: 0 } },
  scale: { mode: "constant" as const, value: { x: 100, y: 100, z: 100 } },
  rotation: { mode: "constant" as const, value: { x: 0, y: 0, z: 0 } }
};

function layer(type: LayerDefinition["type"], properties: JsonObject): LayerDefinition {
  return {
    id: `layer.${type}`,
    type,
    name: `Formal ${type}`,
    visible: true,
    locked: false,
    solo: false,
    startTime: 0,
    endTime: 2,
    inPoint: 0,
    outPoint: 2,
    zIndex: 0,
    transform,
    opacity: { mode: "constant", value: 1 },
    blendMode: "normal",
    masks: [],
    effects: [],
    properties,
    ...((type === "image" || type === "video") ? { source: { assetId: "asset.uploaded" } } : {})
  } as LayerDefinition;
}

function request(
  candidate: LayerDefinition,
  overrides: Partial<Omit<Formal2dRasterRequestV1, "layer">> = {}
): Formal2dRasterRequestV1 {
  return {
    layer: candidate,
    compositionWidth: 640,
    compositionHeight: 360,
    renderWidth: 320,
    renderHeight: 180,
    projectSeed: 20260803,
    projectTime: 1,
    layerTime: 1,
    ...overrides
  };
}

function rasterInput(source: LayerRasterSource, width: number, height: number): LayerRasterizationInput {
  return {
    layerId: `layer.${source.kind}`,
    layerType: source.kind,
    source,
    time: {
      contractVersion: "1.1.0",
      layerId: `layer.${source.kind}`,
      active: true,
      projectTime: 1,
      localTime: 1,
      sourceTime: 1,
      deltaTime: 1 / 30
    },
    transform: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], anchor: [0, 0] },
    opacity: 1,
    masks: [],
    target: { width, height, format: "rgba8", colorSpace: "srgb", samples: 1, usage: "input" }
  };
}

function expectCode(action: () => unknown, code: Formal2dRasterErrorV1["code"]): void {
  try {
    action();
    throw new Error("formal raster unexpectedly succeeded");
  } catch (error) {
    expect(error).toBeInstanceOf(Formal2dRasterErrorV1);
    expect((error as Formal2dRasterErrorV1).code).toBe(code);
    expect((error as Formal2dRasterErrorV1).status).toBe(code === "RASTER_BUDGET_EXCEEDED" ? 413 : 422);
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect((error as Error).message).not.toMatch(/CodeMotion|private|path|script/iu);
  }
}

function resolveUnknown(value: unknown): LayerRasterSource | undefined {
  return (resolveFormal2dRasterSourceV1 as unknown as (
    candidate: unknown
  ) => LayerRasterSource | undefined)(value);
}

describe("formal deterministic text raster source", () => {
  it("normalizes supported Unicode graphemes and rejects missing font glyphs explicitly", () => {
    const first = resolveFormal2dRasterSourceV1(request(layer("text", {
      text: "中文 Ae\u0301",
      fontFamily: "Codemotion Planner Unicode Bitmap",
      fontSize: 48
    })));
    const second = resolveFormal2dRasterSourceV1(request(layer("text", {
      text: "中文 Aé",
      fontFamily: "Codemotion Planner Unicode Bitmap",
      fontSize: 48
    })));
    expect(first?.kind).toBe("text");
    expect(second?.kind).toBe("text");
    expect(first).toEqual(second);
    if (first?.kind !== "text") return;
    expect(first.text).toBe("中文 Aé");
    expect(first.glyphs.length).toBeGreaterThanOrEqual(5);
    expect(first.font).toMatchObject({
      fontId: "font.codemotion.unicode-bitmap-v1",
      assetId: "font.codemotion.unicode-bitmap-v1",
      family: "Codemotion Planner Unicode Bitmap",
      missingGlyphPolicy: "error"
    });
    expect(Object.isFrozen(first)).toBe(true);
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("text", {
      text: "👩‍💻",
      fontFamily: "Codemotion Planner Unicode Bitmap",
      fontSize: 48
    }))), "FONT_UNAVAILABLE");
  });

  it("uses explicit/default RGBA including Alpha without applying layer opacity", () => {
    const explicit = resolveFormal2dRasterSourceV1(request(layer("text", {
      text: "A",
      fontFamily: "Codemotion Planner Unicode Bitmap",
      fontSize: 48,
      color: "#FF000080"
    })));
    const fallback = resolveFormal2dRasterSourceV1(request(layer("text", {
      text: "A",
      fontFamily: "Codemotion Planner Unicode Bitmap",
      fontSize: 48
    })));
    expect(explicit?.kind === "text" && explicit.fillRgba).toEqual([1, 0, 0, 128 / 255]);
    expect(fallback?.kind === "text" && fallback.fillRgba).toEqual([1, 1, 1, 1]);
    if (explicit?.kind !== "text") return;
    const pixels = rasterizeLayerInput(rasterInput(explicit, 320, 180));
    expect(pixels.data.some((value, index) => index % 4 === 0 && value === 255)).toBe(true);
    expect(pixels.data.reduce(
      (maximum, value, index) => index % 4 === 3 ? Math.max(maximum, value) : maximum,
      0
    )).toBe(128);
  });

  it("keys coverage by requested dimensions and seed with byte-identical reruns", () => {
    const text = layer("text", {
      text: "Deterministic 中文",
      fontFamily: "Codemotion Planner Unicode Bitmap",
      fontSize: 42
    });
    const first = resolveFormal2dRasterSourceV1(request(text));
    const again = resolveFormal2dRasterSourceV1(request(text));
    const larger = resolveFormal2dRasterSourceV1(request(text, { renderWidth: 640, renderHeight: 360 }));
    const otherSeed = resolveFormal2dRasterSourceV1(request(text, { projectSeed: 9 }));
    expect(first).toEqual(again);
    expect(larger).not.toEqual(first);
    expect(otherSeed).not.toEqual(first);
    if (first?.kind === "text" && again?.kind === "text") {
      expect(first.glyphs.map((glyph) => [...glyph.coverage.data]))
        .toEqual(again.glyphs.map((glyph) => [...glyph.coverage.data]));
    }
  });

  it("enforces font, glyph, color, scalar, fontSize, coverage, and abort limits", () => {
    const base = { text: "A", fontFamily: "Codemotion Planner Unicode Bitmap", fontSize: 32 };
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("text", {
      ...base, fontFamily: "Arial"
    }))), "FONT_UNAVAILABLE");
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("text", {
      ...base, text: "\u0378"
    }))), "FONT_UNAVAILABLE");
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("text", {
      ...base, color: "red"
    }))), "FONT_UNAVAILABLE");
    for (const fontSize of [0, 8_193, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectCode(() => resolveFormal2dRasterSourceV1(request(layer("text", {
        ...base, fontSize
      }))), "FONT_UNAVAILABLE");
    }
    expect(resolveFormal2dRasterSourceV1(request(layer("text", {
      ...base, text: "A".repeat(4_096), fontSize: 1
    })))?.kind).toBe("text");
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("text", {
      ...base, text: "A".repeat(4_097), fontSize: 1
    }))), "RASTER_BUDGET_EXCEEDED");
    expect(resolveFormal2dRasterSourceV1(request(layer("text", {
      ...base, fontSize: 8_192
    }), { compositionWidth: 8_192, compositionHeight: 8_192, renderWidth: 1, renderHeight: 1 }))?.kind)
      .toBe("text");
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("text", {
      ...base, text: "A".repeat(4_096), fontSize: 100
    }), { compositionWidth: 100, compositionHeight: 100, renderWidth: 100, renderHeight: 100 })),
    "RASTER_BUDGET_EXCEEDED");
    const controller = new AbortController();
    controller.abort();
    expect(() => resolveFormal2dRasterSourceV1(request(layer("text", base), {
      signal: controller.signal
    }))).toThrow(/abort/iu);
  });

  it("counts valid raw Unicode scalars before NFC and rejects isolated surrogates", () => {
    const base = { fontFamily: "Codemotion Planner Unicode Bitmap", fontSize: 1 };
    const exactRawLimit = "e\u0301".repeat(2_048);
    const accepted = resolveFormal2dRasterSourceV1(request(layer("text", {
      ...base, text: exactRawLimit
    }), { compositionWidth: 8_192, compositionHeight: 8_192, renderWidth: 1, renderHeight: 1 }));
    expect(accepted?.kind === "text" && accepted.text).toBe("é".repeat(2_048));
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("text", {
      ...base, text: `${exactRawLimit}e`
    }), { compositionWidth: 8_192, compositionHeight: 8_192, renderWidth: 1, renderHeight: 1 })),
    "RASTER_BUDGET_EXCEEDED");
    for (const text of ["\ud800", "\udc00", "A\ud800B"]) {
      expectCode(() => resolveFormal2dRasterSourceV1(request(layer("text", { ...base, text }))),
        "FONT_UNAVAILABLE");
    }
  });
});

describe("formal raster request and layer boundary", () => {
  it("enforces exact dimensions, pixel product, seed, and time semantics", () => {
    const candidate = layer("svg", { svg: "M0 0 L1 1" });
    for (const key of ["compositionWidth", "compositionHeight", "renderWidth", "renderHeight"] as const) {
      expect(resolveFormal2dRasterSourceV1(request(candidate, { [key]: 1 }))?.kind).toBe("svg");
      expect(resolveFormal2dRasterSourceV1(request(candidate, { [key]: 8_192 }))?.kind).toBe("svg");
      for (const value of [0, 1.5, 8_193, Number.NaN, Number.POSITIVE_INFINITY]) {
        expectCode(() => resolveFormal2dRasterSourceV1(request(candidate, { [key]: value })),
          "RASTER_BUDGET_EXCEEDED");
      }
    }
    expect(resolveFormal2dRasterSourceV1(request(candidate, {
      renderWidth: 8_192, renderHeight: 4_096
    }))?.kind).toBe("svg");
    expectCode(() => resolveFormal2dRasterSourceV1(request(candidate, {
      renderWidth: 8_192, renderHeight: 4_097
    })), "RASTER_BUDGET_EXCEEDED");
    for (const projectSeed of [0, 0xffff_ffff]) {
      expect(resolveFormal2dRasterSourceV1(request(candidate, { projectSeed }))?.kind).toBe("svg");
    }
    for (const projectSeed of [-1, 1.5, 0x1_0000_0000, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectCode(() => resolveFormal2dRasterSourceV1(request(candidate, { projectSeed })),
        "INLINE_SVG_INVALID");
    }
    for (const projectTime of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expectCode(() => resolveFormal2dRasterSourceV1(request(candidate, { projectTime })),
        "INLINE_SVG_INVALID");
    }
    for (const layerTime of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectCode(() => resolveFormal2dRasterSourceV1(request(candidate, { layerTime })),
        "INLINE_SVG_INVALID");
    }
  });

  it("rejects extra request/layer authority, path, pixels, commands, and typed-array fields", () => {
    const base = request(layer("svg", { svg: "M0 0 L1 1" })) as unknown as Record<string, unknown>;
    for (const key of ["registry", "catalog", "effectsById", "authority", "options", "path", "uri",
      "pixels", "canvasCommands"]) {
      expectCode(() => resolveUnknown({ ...base, [key]: key === "pixels" ? new Uint8Array(4) : {} }),
        "INLINE_SVG_INVALID");
    }
    for (const [key, value] of [
      ["canvasCommands", []], ["pixels", new Uint8Array(4)], ["registry", new Map()], ["path", "C:/private/x"]
    ] as const) {
      expectCode(() => resolveUnknown({ ...base, layer: { ...(base.layer as object), [key]: value } }),
        "INLINE_SVG_INVALID");
    }
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("svg", {
      svg: "M0 0 L1 1", pixels: new Uint8Array(4)
    } as unknown as JsonObject))), "INLINE_SVG_INVALID");
  });

  it("rejects undefined, primitives, arrays, inherited objects, Proxies, getters, and polluted data", () => {
    for (const value of [undefined, null, true, 1, "request", [], new Uint8Array(4)]) {
      expectCode(() => resolveUnknown(value), "INLINE_SVG_INVALID");
    }
    const valid = request(layer("svg", { svg: "M0 0 L1 1" }));
    expectCode(() => resolveUnknown(Object.create(valid)), "INLINE_SVG_INVALID");
    expectCode(() => resolveUnknown(new Proxy(valid, {})), "INLINE_SVG_INVALID");
    expectCode(() => resolveUnknown(new Proxy(valid, {
      getPrototypeOf(): never { throw new Error("secret file:///C:/private/proxy"); }
    })), "INLINE_SVG_INVALID");
    const getter = { ...valid } as Record<string, unknown>;
    Object.defineProperty(getter, "projectSeed", {
      enumerable: true,
      get(): never { throw new Error("secret C:/private/getter"); }
    });
    expectCode(() => resolveUnknown(getter), "INLINE_SVG_INVALID");
    const polluted = { ...valid } as Record<string, unknown>;
    Object.defineProperty(polluted, "__proto__", { value: {}, enumerable: true });
    expectCode(() => resolveUnknown(polluted), "INLINE_SVG_INVALID");
  });

  it("maps arbitrary exceptions and abort reasons to fixed non-sensitive public errors", () => {
    const secret = "secret C:/private/token?uri=file:///owner/hash";
    const controller = new AbortController();
    controller.abort(new Error(secret));
    let aborted: unknown;
    try {
      resolveFormal2dRasterSourceV1(request(layer("svg", { svg: "M0 0 L1 1" }), {
        signal: controller.signal
      }));
    } catch (error) {
      aborted = error;
    }
    expect(aborted).toMatchObject({ name: "AbortError", code: "ABORT_ERR" });
    expect((aborted as Error).message).toBe("Formal raster operation aborted.");
    expect((aborted as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(aborted)).not.toContain(secret);

    const throwingLayer = layer("svg", { svg: "M0 0 L1 1" }) as unknown as Record<string, unknown>;
    Object.defineProperty(throwingLayer, "properties", {
      enumerable: true,
      get(): never { throw new Error(secret); }
    });
    let mapped: unknown;
    try {
      resolveUnknown({ ...request(layer("svg", { svg: "M0 0 L1 1" })), layer: throwingLayer });
    } catch (error) {
      mapped = error;
    }
    expect(mapped).toBeInstanceOf(Formal2dRasterErrorV1);
    expect(mapped).toMatchObject({
      name: "Formal2dRasterErrorV1", code: "INLINE_SVG_INVALID", status: 422
    });
    expect((mapped as Error).message).toBe("Formal vector raster input is invalid.");
    expect((mapped as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(mapped)).not.toContain(secret);

    const hostileController = new AbortController();
    Object.defineProperty(hostileController.signal, "aborted", {
      get(): never { throw new Error(secret); }
    });
    let signalFailure: unknown;
    try {
      resolveFormal2dRasterSourceV1(request(layer("svg", { svg: "M0 0 L1 1" }), {
        signal: hostileController.signal
      }));
    } catch (error) {
      signalFailure = error;
    }
    expect(signalFailure).toMatchObject({
      name: "Formal2dRasterErrorV1", code: "INLINE_SVG_INVALID", status: 422
    });
    expect((signalFailure as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(signalFailure)).not.toContain(secret);
  });
});

describe("formal raster own-property isolation", () => {
  it("ignores inherited raster properties and rejects own accessors in an isolated process", () => {
    const pollutedKeys = [
      "canvasCommands", "color", "svg", "fill", "stroke", "strokeWidth", "fillRule",
      "text", "fontFamily", "fontSize", "shapes", "path"
    ];
    for (const key of pollutedKeys) expect(Object.hasOwn(Object.prototype, key)).toBe(false);
    const script = `
      const root = await import(process.argv[1]);
      const fail = (message) => { throw new Error(message); };
      const transform = {
        anchorPoint: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
        position: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
        scale: { mode: "constant", value: { x: 100, y: 100, z: 100 } },
        rotation: { mode: "constant", value: { x: 0, y: 0, z: 0 } }
      };
      const layer = (type, properties) => ({
        id: "layer." + type, type, name: "Formal " + type, visible: true, locked: false, solo: false,
        startTime: 0, endTime: 2, inPoint: 0, outPoint: 2, zIndex: 0, transform,
        opacity: { mode: "constant", value: 1 }, blendMode: "normal", masks: [], effects: [], properties
      });
      const request = (candidate) => ({
        layer: candidate, compositionWidth: 640, compositionHeight: 360,
        renderWidth: 320, renderHeight: 180, projectSeed: 7, projectTime: 1, layerTime: 1
      });
      const textLayer = () => layer("text", {
        text: "Safe", fontFamily: "Codemotion Planner Unicode Bitmap", fontSize: 32
      });
      const shapeLayer = () => layer("shape", { shapes: [{ path: "M0 0 L1 1" }] });
      const svgLayer = () => layer("svg", { svg: "M0 0 L1 1" });
      const assertDefaults = (expectedCommands) => {
        const text = root.resolveFormal2dRasterSourceV1(request(textLayer()));
        const shape = root.resolveFormal2dRasterSourceV1(request(shapeLayer()));
        const svg = root.resolveFormal2dRasterSourceV1(request(svgLayer()));
        if (text.kind !== "text" || JSON.stringify(text.fillRgba) !== "[1,1,1,1]") fail("text default");
        if (shape.kind !== "shape" || shape.paths[0].fill !== "#FFFFFFFF") fail("shape default");
        if (svg.kind !== "svg" || svg.paths[0].fill !== "#FFFFFFFF"
          || svg.paths[0].stroke !== null || svg.paths[0].strokeWidth !== 0
          || svg.paths[0].fillRule !== "nonzero") fail("svg default");
        if (expectedCommands !== undefined && svg.paths[0].commands !== expectedCommands) fail("cache identity");
        return svg.paths[0].commands;
      };
      const baselineCommands = assertDefaults();
      const pollution = new Map([
        ["canvasCommands", [{ op: "secret" }]], ["color", "invalid-color"],
        ["svg", "<script>secret</script>"], ["fill", "invalid-fill"], ["stroke", "invalid-stroke"],
        ["strokeWidth", 7], ["fillRule", "invalid-rule"], ["text", "inherited text"],
        ["fontFamily", "Arial"], ["fontSize", 8192], ["shapes", []], ["path", "M16 16 L16 16"]
      ]);
      for (const [key, value] of pollution) {
        Object.defineProperty(Object.prototype, key, { configurable: true, writable: true, value });
        try { assertDefaults(baselineCommands); } finally { delete Object.prototype[key]; }
      }
      for (const key of ["color", "fill", "stroke", "strokeWidth", "fillRule"]) {
        Object.defineProperty(Object.prototype, key, { configurable: true, writable: true, value: undefined });
        try { assertDefaults(baselineCommands); } finally { delete Object.prototype[key]; }
      }
      for (const value of [NaN, Infinity]) {
        Object.defineProperty(Object.prototype, "strokeWidth", { configurable: true, writable: true, value });
        try { assertDefaults(baselineCommands); } finally { delete Object.prototype.strokeWidth; }
      }
      for (const [key, value] of [
        ["color", "bad"], ["fill", "bad"], ["stroke", "bad"], ["fillRule", "bad"]
      ]) {
        Object.defineProperty(Object.prototype, key, { configurable: true, writable: true, value });
        try { assertDefaults(baselineCommands); } finally { delete Object.prototype[key]; }
      }
      for (const [key, makeLayer] of [
        ["color", textLayer], ["fill", shapeLayer], ["stroke", svgLayer],
        ["strokeWidth", svgLayer], ["fillRule", svgLayer]
      ]) {
        let reads = 0;
        Object.defineProperty(Object.prototype, key, {
          configurable: true,
          get() { reads += 1; throw new Error("secret C:/private/inherited"); }
        });
        try {
          root.resolveFormal2dRasterSourceV1(request(makeLayer()));
          if (reads !== 0) fail("inherited getter executed");
        } finally { delete Object.prototype[key]; }
      }
      const accessorCases = [
        ["color", textLayer, null, "INLINE_SVG_INVALID"],
        ["fill", shapeLayer, null, "INLINE_SVG_INVALID"],
        ["fill", shapeLayer, 0, "INLINE_SVG_INVALID"],
        ["fill", svgLayer, null, "INLINE_SVG_INVALID"],
        ["stroke", svgLayer, null, "INLINE_SVG_INVALID"],
        ["strokeWidth", svgLayer, null, "INLINE_SVG_INVALID"],
        ["fillRule", svgLayer, null, "INLINE_SVG_INVALID"]
      ];
      for (const [key, makeLayer, shapeIndex, code] of accessorCases) {
        const candidate = makeLayer();
        const target = shapeIndex === 0 ? candidate.properties.shapes[0] : candidate.properties;
        let reads = 0;
        Object.defineProperty(target, key, {
          enumerable: true,
          get() { reads += 1; throw new Error("secret file:///C:/private/own"); }
        });
        try {
          root.resolveFormal2dRasterSourceV1(request(candidate));
          fail("own accessor accepted");
        } catch (error) {
          if (!(error instanceof root.Formal2dRasterErrorV1) || error.code !== code
            || error.cause !== undefined || JSON.stringify(error).includes("private") || reads !== 0) {
            fail("own accessor error boundary: " + key + "/" + String(shapeIndex)
              + "/" + String(error.code) + "/reads=" + String(reads));
          }
        }
      }
      for (const [key, makeLayer, shapeIndex] of accessorCases.map(([key, makeLayer, shapeIndex]) =>
        [key, makeLayer, shapeIndex])) {
        const candidate = makeLayer();
        const target = shapeIndex === 0 ? candidate.properties.shapes[0] : candidate.properties;
        Object.defineProperty(target, key, { enumerable: true, writable: true, value: undefined });
        try { root.resolveFormal2dRasterSourceV1(request(candidate)); fail("own undefined accepted"); }
        catch (error) { if (!(error instanceof root.Formal2dRasterErrorV1)) throw error; }
      }
      const legalText = textLayer(); legalText.properties.color = "#10203040";
      const legalShape = shapeLayer(); legalShape.properties.fill = "#11223344";
      legalShape.properties.shapes[0].fill = "#55667788";
      const legalSvg = svgLayer(); Object.assign(legalSvg.properties, {
        fill: "#01020304", stroke: "#AABBCCDD", strokeWidth: 0.5, fillRule: "evenodd"
      });
      if (root.resolveFormal2dRasterSourceV1(request(legalText)).fillRgba[3] !== 64 / 255) fail("own text");
      if (root.resolveFormal2dRasterSourceV1(request(legalShape)).paths[0].fill !== "#55667788") fail("own shape");
      const styled = root.resolveFormal2dRasterSourceV1(request(legalSvg)).paths[0];
      if (styled.fill !== "#01020304" || styled.stroke !== "#AABBCCDD"
        || styled.strokeWidth !== 0.5 || styled.fillRule !== "evenodd") fail("own svg");
      for (const [candidate, code] of [
        [Object.assign(textLayer(), { properties: { ...textLayer().properties, color: "bad" } }), "FONT_UNAVAILABLE"],
        [Object.assign(shapeLayer(), { properties: { ...shapeLayer().properties, fill: "bad" } }), "INLINE_SVG_INVALID"],
        [Object.assign(svgLayer(), { properties: { ...svgLayer().properties, strokeWidth: NaN } }), "INLINE_SVG_INVALID"]
      ]) {
        try { root.resolveFormal2dRasterSourceV1(request(candidate)); fail("own invalid accepted"); }
        catch (error) { if (!(error instanceof root.Formal2dRasterErrorV1) || error.code !== code) throw error; }
      }
    `;
    const result = spawnSync(process.execPath, [
      "--input-type=module", "--eval", script,
      new URL("../dist/index.js", import.meta.url).href
    ], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    for (const key of pollutedKeys) expect(Object.hasOwn(Object.prototype, key)).toBe(false);
  });
});

describe("formal request own-property snapshot isolation", () => {
  it("ignores inherited signal and closes request validation/use TOCTOU in an isolated process", () => {
    expect(Object.hasOwn(Object.prototype, "signal")).toBe(false);
    const script = `
      const root = await import(process.argv[1]);
      const fail = (message) => { throw new Error(message); };
      const transform = {
        anchorPoint: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
        position: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
        scale: { mode: "constant", value: { x: 100, y: 100, z: 100 } },
        rotation: { mode: "constant", value: { x: 0, y: 0, z: 0 } }
      };
      const textLayer = () => ({
        id: "layer.text", type: "text", name: "Formal text", visible: true, locked: false, solo: false,
        startTime: 0, endTime: 2, inPoint: 0, outPoint: 2, zIndex: 0, transform,
        opacity: { mode: "constant", value: 1 }, blendMode: "normal", masks: [], effects: [],
        properties: { text: "Snapshot", fontFamily: "Codemotion Planner Unicode Bitmap", fontSize: 32 }
      });
      const makeRequest = () => ({
        layer: textLayer(), compositionWidth: 640, compositionHeight: 360,
        renderWidth: 320, renderHeight: 180, projectSeed: 7, projectTime: 1, layerTime: 1
      });
      const render = (candidate) => root.resolveFormal2dRasterSourceV1(candidate);
      const baseline = render(makeRequest());
      const baselineJson = JSON.stringify(baseline);
      const assertBaseline = (candidate, label) => {
        if (JSON.stringify(render(candidate)) !== baselineJson) fail(label);
      };
      const assertSanitized = (callback, label) => {
        try { callback(); fail(label + " accepted"); }
        catch (error) {
          if (!(error instanceof root.Formal2dRasterErrorV1)
            || error.code !== "INLINE_SVG_INVALID" || error.cause !== undefined
            || JSON.stringify(error).includes("private") || String(error).includes("private")) {
            fail(label + " boundary");
          }
        }
      };

      const inheritedAborted = new AbortController();
      inheritedAborted.abort(new Error("secret C:/private/inherited-reason"));
      Object.defineProperty(Object.prototype, "signal", {
        configurable: true, writable: true, value: inheritedAborted.signal
      });
      try { assertBaseline(makeRequest(), "inherited aborted signal"); }
      finally { delete Object.prototype.signal; }

      let inheritedReads = 0;
      Object.defineProperty(Object.prototype, "signal", {
        configurable: true,
        get() { inheritedReads += 1; throw new Error("secret C:/private/inherited-getter"); }
      });
      try {
        assertBaseline(makeRequest(), "inherited getter signal");
        if (inheritedReads !== 0) fail("inherited signal getter executed");
      } finally { delete Object.prototype.signal; }

      const inheritedProxy = new Proxy({}, {
        getPrototypeOf() { throw new Error("secret C:/private/inherited-proxy"); }
      });
      for (const value of [{ aborted: true }, inheritedProxy, NaN, "C:/private/inherited-signal"]) {
        Object.defineProperty(Object.prototype, "signal", { configurable: true, writable: true, value });
        try { assertBaseline(makeRequest(), "inherited hostile signal"); }
        finally { delete Object.prototype.signal; }
      }

      const active = new AbortController();
      const activeRequest = makeRequest();
      activeRequest.signal = active.signal;
      assertBaseline(activeRequest, "own active signal");

      const aborted = new AbortController();
      aborted.abort(new Error("secret C:/private/own-reason"));
      const abortedRequest = makeRequest();
      abortedRequest.signal = aborted.signal;
      try { render(abortedRequest); fail("own aborted signal accepted"); }
      catch (error) {
        if (error.name !== "AbortError" || error.code !== "ABORT_ERR"
          || error.message !== "Formal raster operation aborted." || error.cause !== undefined
          || JSON.stringify(error).includes("private") || String(error).includes("private")) {
          fail("abort boundary");
        }
      }

      const accessorRequest = makeRequest();
      let ownSignalReads = 0;
      Object.defineProperty(accessorRequest, "signal", {
        enumerable: true,
        get() { ownSignalReads += 1; throw new Error("secret C:/private/own-getter"); }
      });
      assertSanitized(() => render(accessorRequest), "own signal accessor");
      if (ownSignalReads !== 0) fail("own signal getter executed");

      const fakeRequest = makeRequest();
      fakeRequest.signal = { aborted: false };
      assertSanitized(() => render(fakeRequest), "own fake signal");
      const proxyRequest = makeRequest();
      proxyRequest.signal = new Proxy(active.signal, {
        getPrototypeOf() { throw new Error("secret C:/private/own-proxy"); }
      });
      assertSanitized(() => render(proxyRequest), "own proxy signal");

      const required = [
        "layer", "compositionWidth", "compositionHeight", "renderWidth", "renderHeight",
        "projectSeed", "projectTime", "layerTime"
      ];
      for (const key of required) {
        const inheritedRequest = makeRequest();
        const legalValue = inheritedRequest[key];
        delete inheritedRequest[key];
        Object.defineProperty(Object.prototype, key, { configurable: true, writable: true, value: legalValue });
        try { assertSanitized(() => render(inheritedRequest), "inherited required " + key); }
        finally { delete Object.prototype[key]; }

        const inheritedAccessorRequest = makeRequest();
        delete inheritedAccessorRequest[key];
        let inheritedRequiredReads = 0;
        Object.defineProperty(Object.prototype, key, {
          configurable: true,
          get() { inheritedRequiredReads += 1; throw new Error("secret C:/private/required-inherited"); }
        });
        try {
          assertSanitized(() => render(inheritedAccessorRequest), "inherited required accessor " + key);
          if (inheritedRequiredReads !== 0) fail("inherited required getter executed " + key);
        } finally { delete Object.prototype[key]; }

        const ownAccessorRequest = makeRequest();
        let ownRequiredReads = 0;
        Object.defineProperty(ownAccessorRequest, key, {
          enumerable: true,
          get() { ownRequiredReads += 1; throw new Error("secret C:/private/required-own"); }
        });
        assertSanitized(() => render(ownAccessorRequest), "own required accessor " + key);
        if (ownRequiredReads !== 0) fail("own required getter executed " + key);

        const ownDataRequest = makeRequest();
        const ownValue = ownDataRequest[key];
        Object.defineProperty(ownDataRequest, key, {
          configurable: true, enumerable: true, writable: true, value: ownValue
        });
        assertBaseline(ownDataRequest, "own required data " + key);
      }

      const toctouRequest = makeRequest();
      const toctouSignal = new AbortController().signal;
      let checks = 0;
      Object.defineProperty(toctouSignal, "aborted", {
        configurable: true,
        get() {
          checks += 1;
          if (checks === 1) Object.assign(toctouRequest, {
            layer: null, compositionWidth: "changed", compositionHeight: "changed",
            renderWidth: "changed", renderHeight: "changed", projectSeed: "changed",
            projectTime: "changed", layerTime: "changed", signal: { aborted: true }
          });
          return false;
        }
      });
      toctouRequest.signal = toctouSignal;
      assertBaseline(toctouRequest, "request snapshot TOCTOU");
      if (checks < 2) fail("captured signal not reused");
    `;
    const result = spawnSync(process.execPath, [
      "--input-type=module", "--eval", script,
      new URL("../dist/index.js", import.meta.url).href
    ], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(Object.hasOwn(Object.prototype, "signal")).toBe(false);
  }, 15_000);
});

describe("formal shape and inline-SVG raster sources", () => {
  it("parses multiple closed shape paths with exact fills and canvas viewport", () => {
    const source = resolveFormal2dRasterSourceV1(request(layer("shape", {
      shapes: [
        { path: "M0 0 L640 0 L640 360 L0 360 Z", fill: "#11223344" },
        { path: "m10 10 c20 0 20 20 40 20 z" }
      ],
      fill: "#AABBCC"
    })));
    expect(source).toMatchObject({
      kind: "shape",
      viewport: { x: 0, y: 0, width: 640, height: 360 }
    });
    if (source?.kind !== "shape") return;
    expect(source.paths).toHaveLength(2);
    expect(source.paths[0]?.fill).toBe("#11223344");
    expect(source.paths[1]?.fill).toBe("#AABBCC");
    expect(source.paths[1]?.commands.some((command) => command.op === "cubic")).toBe(true);
  });

  it("supports exact inline styles, defaults, relative commands, and isolated cache keys", () => {
    const path = "m0.1 0.1 l0.8 0 c0 0.2 0 0.6 0 0.8 z";
    const styled = resolveFormal2dRasterSourceV1(request(layer("svg", {
      svg: path,
      fill: "#10203040",
      stroke: "#FFEEDDCC",
      strokeWidth: 0.025,
      fillRule: "evenodd"
    })));
    const fallback = resolveFormal2dRasterSourceV1(request(layer("svg", { svg: path })));
    const restyled = resolveFormal2dRasterSourceV1(request(layer("svg", {
      svg: path, fill: "#000000", stroke: "#FFFFFF", strokeWidth: 1, fillRule: "nonzero"
    })));
    expect(styled).toMatchObject({ kind: "svg", viewport: { x: 0, y: 0, width: 1, height: 1 } });
    expect(styled?.kind === "svg" && styled.paths[0]).toMatchObject({
      fill: "#10203040", stroke: "#FFEEDDCC", strokeWidth: 0.025, fillRule: "evenodd"
    });
    expect(fallback?.kind === "svg" && fallback.paths[0]).toMatchObject({
      fill: "#FFFFFFFF", stroke: null, strokeWidth: 0, fillRule: "nonzero"
    });
    expect(restyled?.kind === "svg" && restyled.paths[0]).toMatchObject({
      fill: "#000000", stroke: "#FFFFFF", strokeWidth: 1, fillRule: "nonzero"
    });
  });

  it("bounds the private deterministic LRU by entry count and total key bytes", () => {
    const initialPath = "M0 0 L1 0.999";
    const initial = resolveFormal2dRasterSourceV1(request(layer("svg", { svg: initialPath })));
    if (initial?.kind !== "svg") return;
    const initialCommands = initial.paths[0]!.commands;
    for (let index = 0; index < 129; index += 1) {
      resolveFormal2dRasterSourceV1(request(layer("svg", {
        svg: `M0 0 L1 ${String(index / 1_000)}`
      })));
    }
    const afterEntryEviction = resolveFormal2dRasterSourceV1(request(layer("svg", { svg: initialPath })));
    expect(afterEntryEviction?.kind === "svg" && afterEntryEviction.paths[0]!.commands)
      .not.toBe(initialCommands);
    expect(afterEntryEviction?.kind === "svg" && afterEntryEviction.paths[0]!.commands)
      .toEqual(initialCommands);

    const largePath = (suffix: number): string => `M0 0 L1 ${String(suffix / 100)}`
      + " ".repeat(60 * 1024);
    const largeInitial = resolveFormal2dRasterSourceV1(request(layer("svg", { svg: largePath(90) })));
    if (largeInitial?.kind !== "svg") return;
    const largeCommands = largeInitial.paths[0]!.commands;
    for (let index = 0; index < 10; index += 1) {
      resolveFormal2dRasterSourceV1(request(layer("svg", { svg: largePath(index) })));
    }
    const afterByteEviction = resolveFormal2dRasterSourceV1(request(layer("svg", { svg: largePath(90) })));
    expect(afterByteEviction?.kind === "svg" && afterByteEviction.paths[0]!.commands)
      .not.toBe(largeCommands);
    expect(afterByteEviction?.kind === "svg" && afterByteEviction.paths[0]!.commands)
      .toEqual(largeCommands);
    expect(Object.keys(EffectsRoot)).not.toContain("resetFormal2dRasterCache");
  });

  it("rasterizes each requested size directly instead of scaling a 160x90 cache", () => {
    const svg = layer("svg", { svg: "M0 0 L1 0 L1 1 L0 1 Z" });
    const small = resolveFormal2dRasterSourceV1(request(svg, { renderWidth: 160, renderHeight: 90 }));
    const large = resolveFormal2dRasterSourceV1(request(svg, { renderWidth: 320, renderHeight: 180 }));
    expect(small).not.toBe(large);
    if (small === undefined || large === undefined) return;
    const smallPixels = rasterizeLayerInput(rasterInput(small, 160, 90));
    const largePixels = rasterizeLayerInput(rasterInput(large, 320, 180));
    expect(smallPixels).toMatchObject({ width: 160, height: 90 });
    expect(largePixels).toMatchObject({ width: 320, height: 180 });
    expect(smallPixels.data).toHaveLength(160 * 90 * 4);
    expect(largePixels.data).toHaveLength(320 * 180 * 4);
  });

  it("rejects XML, executable/resource syntax, unsupported commands, malformed numbers, and extra fields", () => {
    const unsafe = [
      "<svg><path d='M0 0L1 1'/></svg>",
      "&lt;svg&gt;",
      "<script>alert(1)</script>",
      "<style>path{fill:url(x)}</style>",
      "url(https://example.invalid/a.svg)",
      "onclick=alert(1)",
      "<animate />",
      "M0 0 H1",
      "M0 0 Q1 1 2 2",
      "M0 0 A1 1 0 0 0 1 1",
      "M0 0 LNaN 1",
      "M0 0 LInfinity 1",
      "M0..1 0 L1 1"
    ];
    for (const svg of unsafe) {
      expectCode(() => resolveFormal2dRasterSourceV1(request(layer("svg", { svg }))),
        "INLINE_SVG_INVALID");
    }
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("svg", {
      svg: "M0 0 L1 1", pixels: new Uint8Array(4)
    } as unknown as JsonObject))), "INLINE_SVG_INVALID");
    const polluted = { svg: "M0 0 L1 1" } as Record<string, unknown>;
    Object.defineProperty(polluted, "__proto__", { value: {}, enumerable: true });
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("svg", polluted as JsonObject))),
      "INLINE_SVG_INVALID");
  });

  it("enforces coordinate, byte, command, shape aggregate, and pixel budgets at both sides", () => {
    expect(resolveFormal2dRasterSourceV1(request(layer("svg", {
      svg: "M-16 16 L16 -16"
    })))?.kind).toBe("svg");
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("svg", {
      svg: "M-16.01 0 L1 1"
    }))), "INLINE_SVG_INVALID");
    expect(resolveFormal2dRasterSourceV1(request(layer("shape", {
      shapes: [{ path: "M-8192 8192 L8192 -8192" }]
    })))?.kind).toBe("shape");
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("shape", {
      shapes: [{ path: "M-8193 0 L1 1" }]
    }))), "INLINE_SVG_INVALID");

    const exactBytes = "M0 0 L1 1" + " ".repeat(64 * 1024 - "M0 0 L1 1".length);
    expect(resolveFormal2dRasterSourceV1(request(layer("svg", { svg: exactBytes })))?.kind).toBe("svg");
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("svg", {
      svg: `${exactBytes} `
    }))), "RASTER_BUDGET_EXCEEDED");
    const exactCommands = `M0 0 ${"L0 0 ".repeat(4_095)}`;
    expect(resolveFormal2dRasterSourceV1(request(layer("svg", { svg: exactCommands })))?.kind).toBe("svg");
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("svg", {
      svg: `${exactCommands}L0 0`
    }))), "RASTER_BUDGET_EXCEEDED");
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("shape", {
      shapes: [{ path: exactCommands }, { path: "M0 0 L1 1" }]
    }))), "RASTER_BUDGET_EXCEEDED");
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("svg", {
      svg: "M0 0 L1 1"
    }), { renderWidth: 8_192, renderHeight: 8_192 })), "RASTER_BUDGET_EXCEEDED");
  });

  it("observes abort before and during parsing and raster work", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => resolveFormal2dRasterSourceV1(request(layer("svg", {
      svg: "M0 0 L1 1"
    }), { signal: controller.signal }))).toThrow(/abort/iu);

    let checks = 0;
    const duringController = new AbortController();
    Object.defineProperty(duringController.signal, "aborted", {
      get(): boolean { checks += 1; return checks >= 3; }
    });
    expect(() => resolveFormal2dRasterSourceV1(request(layer("svg", {
      svg: `M0 0 ${"L0 0 ".repeat(200)}`
    }), { signal: duringController.signal }))).toThrow(/abort/iu);
  });

  it("returns undefined for image, video, uploaded SVG media, and unrelated layer types", () => {
    expect(resolveFormal2dRasterSourceV1(request(layer("image", { fit: "contain" })))).toBeUndefined();
    expect(resolveFormal2dRasterSourceV1(request(layer("video", { loop: true, muted: true })))).toBeUndefined();
    const uploadedSvg = layer("image", { fit: "contain" });
    expect(resolveFormal2dRasterSourceV1(request(uploadedSvg))).toBeUndefined();
    expect(resolveFormal2dRasterSourceV1(request(layer("composition", {
      compositionId: "composition.nested"
    })))).toBeUndefined();
    expectCode(() => resolveFormal2dRasterSourceV1(request(layer("null", {}))), "INLINE_SVG_INVALID");
    expect(FORMAL_2D_RASTER_ADAPTER_VERSION).toBe("1.0.0");
  });
});
