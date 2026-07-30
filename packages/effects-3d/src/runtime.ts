import {
  TIME_CONTRACT_VERSION,
  type EffectTimeSample,
  type JsonObject
} from "@codemotion/core";
import { assertLayerRasterizationInput } from "@codemotion/renderer-api";
import { createTextExtrusionGeometry } from "./geometry.js";
import { qualityLayerCount } from "./shader.js";
import type {
  PixelSurface,
  TextExtrude3DParams,
  TextExtrude3DRasterInput,
  TextExtrude3DRenderOptions,
  TextLight,
  TextMaterial
} from "./types.js";

const DEFAULTS: TextExtrude3DParams = Object.freeze({
  depth: 0.28,
  bevel: 0.06,
  material: "metal",
  light: "studio",
  rotationX: 18,
  rotationY: -24,
  perspective: 0.55
});

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function enumValue<T extends string>(value: unknown, fallback: T, values: readonly T[]): T {
  return typeof value === "string" && values.includes(value as T) ? value as T : fallback;
}

export function normalizeTextExtrude3DParams(
  supplied: Readonly<Record<string, unknown>> = {}
): TextExtrude3DParams {
  return Object.freeze({
    depth: finite(supplied.depth, DEFAULTS.depth, 0, 1),
    bevel: finite(supplied.bevel, DEFAULTS.bevel, 0, 0.25),
    material: enumValue<TextMaterial>(supplied.material, DEFAULTS.material, ["matte", "metal", "glass"]),
    light: enumValue<TextLight>(supplied.light, DEFAULTS.light, ["studio", "rim", "top"]),
    rotationX: finite(supplied.rotationX, DEFAULTS.rotationX, -60, 60),
    rotationY: finite(supplied.rotationY, DEFAULTS.rotationY, -90, 90),
    perspective: finite(supplied.perspective, DEFAULTS.perspective, 0, 1)
  });
}

export function defaultTextExtrude3DParams(): JsonObject {
  return { ...DEFAULTS };
}

export function assertPixelSurface(surface: PixelSurface): void {
  if (!Number.isInteger(surface.width) || surface.width < 1
    || !Number.isInteger(surface.height) || surface.height < 1
    || surface.data.length !== surface.width * surface.height * 4) {
    throw new RangeError("Text extrusion surface must have positive dimensions and exact RGBA data.");
  }
}

export function assertTextExtrude3DTime(time: EffectTimeSample): void {
  if (time.contractVersion !== TIME_CONTRACT_VERSION) {
    throw new TypeError(`T08 requires EffectTimeSample ${TIME_CONTRACT_VERSION}.`);
  }
  if (time.effectId !== "fx.text.textExtrude3D") {
    throw new TypeError("T08 EffectTimeSample.effectId must equal fx.text.textExtrude3D.");
  }
  if (time.effectInstanceId.length === 0) {
    throw new TypeError("T08 requires an explicit effectInstanceId distinct from effectId.");
  }
  const values = [
    time.projectTime, time.layerTime, time.effectTime, time.progress,
    time.deltaTime, time.fps, time.frame
  ];
  if (!values.every(Number.isFinite) || time.progress < 0 || time.progress > 1) {
    throw new RangeError("T08 EffectTimeSample values must be finite with progress in [0, 1].");
  }
}

export function assertTextExtrude3DRasterInput(input: TextExtrude3DRasterInput): void {
  if (typeof input !== "object" || input === null
    || typeof input.rasterInput !== "object" || input.rasterInput === null
    || typeof input.surface !== "object" || input.surface === null) {
    throw new TypeError("T08 requires rasterInput and surface from a real TextRasterSource.");
  }
  assertLayerRasterizationInput(input.rasterInput);
  assertPixelSurface(input.surface);
  if (input.rasterInput.layerType !== "text" || input.rasterInput.source.kind !== "text") {
    throw new TypeError("T08 requires a real TextRasterSource; generic pixel surfaces are forbidden.");
  }
  const source = input.rasterInput.source;
  if (source.text.length === 0 || source.glyphs.length === 0) {
    throw new TypeError("T08 requires non-empty text and rasterized glyph coverage.");
  }
  if (source.glyphs.some((glyph) => !glyph.coverage.data.some((value) => value > 0))) {
    throw new TypeError("T08 requires real non-empty coverage for every rasterized glyph.");
  }
  const target = input.rasterInput.target;
  if (input.surface.width !== target.width || input.surface.height !== target.height
    || input.surface.colorSpace !== target.colorSpace) {
    throw new TypeError("T08 raster surface must match the declared text raster target.");
  }
  const [a, b, c, d, e, f] = input.rasterInput.transform.matrix;
  const inGlyphBounds = new Uint8Array(input.surface.width * input.surface.height);
  for (const glyph of source.glyphs) {
    const corners = [
      [glyph.bounds.x + glyph.offsetX, glyph.bounds.y + glyph.offsetY],
      [glyph.bounds.x + glyph.offsetX + glyph.bounds.width, glyph.bounds.y + glyph.offsetY],
      [glyph.bounds.x + glyph.offsetX, glyph.bounds.y + glyph.offsetY + glyph.bounds.height],
      [glyph.bounds.x + glyph.offsetX + glyph.bounds.width, glyph.bounds.y + glyph.offsetY + glyph.bounds.height]
    ] as const;
    const mapped = corners.map(([x, y]) => [a * x + b * y + c, d * x + e * y + f] as const);
    const minX = Math.max(0, Math.floor(Math.min(...mapped.map((point) => point[0]))));
    const maxX = Math.min(input.surface.width - 1, Math.ceil(Math.max(...mapped.map((point) => point[0]))));
    const minY = Math.max(0, Math.floor(Math.min(...mapped.map((point) => point[1]))));
    const maxY = Math.min(input.surface.height - 1, Math.ceil(Math.max(...mapped.map((point) => point[1]))));
    let overlap = false;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        inGlyphBounds[y * input.surface.width + x] = 1;
        if (input.surface.data[(y * input.surface.width + x) * 4 + 3]! > 0) overlap = true;
      }
    }
    if (!overlap) throw new TypeError(`T08 raster surface is missing glyph coverage for glyph ${glyph.glyphId}.`);
  }
  for (let pixel = 0; pixel < inGlyphBounds.length; pixel += 1) {
    if (input.surface.data[pixel * 4 + 3]! > 0 && inGlyphBounds[pixel] === 0) {
      throw new TypeError("T08 raster surface contains pixels outside declared glyph bounds.");
    }
  }
}

function emptyLike(source: PixelSurface): PixelSurface {
  return {
    width: source.width,
    height: source.height,
    data: new Uint8ClampedArray(source.data.length),
    colorSpace: source.colorSpace,
    alphaMode: source.alphaMode
  };
}

type Rgba = [number, number, number, number];

function read(source: PixelSurface, x: number, y: number): Rgba {
  const ix = Math.max(0, Math.min(source.width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(source.height - 1, Math.round(y)));
  const offset = (iy * source.width + ix) * 4;
  const alpha = source.data[offset + 3]! / 255;
  const scale = source.alphaMode === "premultiplied" && alpha > 0 ? 1 / alpha : 1;
  return [
    Math.min(1, source.data[offset]! / 255 * scale),
    Math.min(1, source.data[offset + 1]! / 255 * scale),
    Math.min(1, source.data[offset + 2]! / 255 * scale),
    source.alphaMode === "none" ? 1 : alpha
  ];
}

function shade(
  color: Rgba,
  material: TextMaterial,
  light: TextLight,
  sideAmount: number,
  normalX: number,
  normalY: number
): Rgba {
  const lights: Readonly<Record<TextLight, readonly [number, number, number]>> = {
    studio: [-0.45, -0.55, 0.8],
    rim: [0.8, -0.2, 0.55],
    top: [0, -0.9, 0.45]
  };
  const vector = lights[light];
  const normalZ = Math.sqrt(Math.max(0.05, 1 - normalX * normalX - normalY * normalY));
  const diffuse = Math.max(0, normalX * vector[0] + normalY * vector[1] + normalZ * vector[2]);
  const base = material === "matte" ? 0.28 + diffuse * 0.72
    : material === "metal" ? 0.42 + diffuse * 0.48
      : 0.5 + diffuse * 0.3;
  const specular = material === "matte" ? 0
    : Math.pow(Math.max(0, normalZ * vector[2]), material === "metal" ? 12 : 7)
      * (material === "metal" ? 0.48 : 0.68);
  const glassMix = material === "glass" ? 0.38 : 0;
  return [
    color[0] * base * (1 - glassMix) + 0.72 * glassMix + specular + sideAmount * 0.02,
    color[1] * base * (1 - glassMix) + 0.9 * glassMix + specular + sideAmount * 0.02,
    color[2] * base * (1 - glassMix) + glassMix + specular + sideAmount * 0.03,
    color[3]
  ];
}

function write(output: PixelSurface, x: number, y: number, color: Rgba): void {
  const offset = (y * output.width + x) * 4;
  const alpha = Math.max(0, Math.min(1, color[3]));
  const association = output.alphaMode === "premultiplied" ? alpha : 1;
  output.data[offset] = alpha === 0 ? 0 : Math.round(Math.max(0, Math.min(1, color[0])) * association * 255);
  output.data[offset + 1] = alpha === 0 ? 0 : Math.round(Math.max(0, Math.min(1, color[1])) * association * 255);
  output.data[offset + 2] = alpha === 0 ? 0 : Math.round(Math.max(0, Math.min(1, color[2])) * association * 255);
  output.data[offset + 3] = output.alphaMode === "none" ? 255 : Math.round(alpha * 255);
}

function applyMask(output: PixelSurface, mask: PixelSurface | undefined): PixelSurface {
  if (!mask) return output;
  assertPixelSurface(mask);
  if (mask.width !== output.width || mask.height !== output.height) {
    throw new RangeError("Mask and text extrusion output must have equal dimensions.");
  }
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const offset = (y * output.width + x) * 4;
      const coverage = mask.data[offset + 3]! / 255;
      output.data[offset + 3] = Math.round(output.data[offset + 3]! * coverage);
      if (output.alphaMode === "premultiplied") {
        output.data[offset] = Math.round(output.data[offset]! * coverage);
        output.data[offset + 1] = Math.round(output.data[offset + 1]! * coverage);
        output.data[offset + 2] = Math.round(output.data[offset + 2]! * coverage);
      }
      if (output.data[offset + 3] === 0) {
        output.data[offset] = 0;
        output.data[offset + 1] = 0;
        output.data[offset + 2] = 0;
      }
    }
  }
  return output;
}

export function renderTextExtrude3DPixels(
  input: TextExtrude3DRasterInput,
  suppliedParams: Readonly<Record<string, unknown>>,
  suppliedOptions: TextExtrude3DRenderOptions
): PixelSurface {
  if (!suppliedOptions) throw new TypeError("T08 requires non-optional time, seed and quality options.");
  assertTextExtrude3DRasterInput(input);
  assertTextExtrude3DTime(suppliedOptions.time);
  const source = input.surface;
  const params = normalizeTextExtrude3DParams(suppliedParams);
  const quality = suppliedOptions.quality;
  const geometry = createTextExtrusionGeometry(input, params, quality);
  const output = emptyLike(source);
  if (geometry.occupiedCells === 0) return applyMask(output, suppliedOptions.mask);
  const layers = qualityLayerCount(quality);
  const progress = suppliedOptions.time.progress;
  const rx = params.rotationX * Math.PI / 180;
  const ry = params.rotationY * Math.PI / 180;
  const depthPixels = params.depth * progress * Math.min(source.width, source.height) * (0.45 + params.perspective * 0.55);
  const shiftX = Math.sin(ry) * depthPixels;
  const shiftY = -Math.sin(rx) * depthPixels;
  const normalLength = Math.max(1, Math.hypot(shiftX, shiftY));
  const normalX = -shiftX / normalLength * 0.45;
  const normalY = -shiftY / normalLength * 0.45;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      let result: Rgba = [0, 0, 0, 0];
      for (let layer = layers; layer >= 1; layer -= 1) {
        const amount = layer / layers;
        const sample = read(source, x - shiftX * amount, y - shiftY * amount);
        if (sample[3] <= result[3]) continue;
        const bevelCoverage = params.bevel === 0 ? 1
          : Math.min(1, sample[3] / Math.max(0.02, params.bevel * 4));
        sample[3] *= bevelCoverage;
        result = shade(sample, params.material, params.light, amount, normalX, normalY);
      }
      const front = read(source, x - shiftX * 0.15, y - shiftY * 0.15);
      if (front[3] > 0) result = shade(front, params.material, params.light, 0, 0, 0);
      write(output, x, y, result);
    }
  }
  return applyMask(output, suppliedOptions.mask);
}

export function hashPixelSurface(surface: PixelSurface): string {
  let value = 0x811c9dc5;
  for (const byte of surface.data) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}
