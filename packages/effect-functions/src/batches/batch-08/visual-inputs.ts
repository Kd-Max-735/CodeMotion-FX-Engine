import { assertExactKeys, finiteNumber, isRecord, unitNumber } from "./common.js";

export type Rgba = readonly [number, number, number, number];

export interface PixelLayerBinding {
  readonly version: "pixel-layer-v1";
  readonly sample: Rgba;
}

export interface TextureSampleBinding {
  readonly version: "texture-sample-v1";
  readonly sample: Rgba;
  readonly width: number;
  readonly height: number;
}

export interface MaterialSurfaceBinding {
  readonly version: "material-surface-v1";
  readonly baseColor: Rgba;
  readonly facing: number;
  readonly luminance: number;
}

export function parseRgba(value: unknown, label: string): Rgba {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new TypeError(`${label} must be an RGBA tuple.`);
  }
  return Object.freeze([
    unitNumber(value[0], `${label} red`),
    unitNumber(value[1], `${label} green`),
    unitNumber(value[2], `${label} blue`),
    unitNumber(value[3], `${label} alpha`)
  ]);
}

export function parsePixelLayer(value: unknown): PixelLayerBinding {
  if (!isRecord(value)) throw new TypeError("pixel layer binding must be an object.");
  assertExactKeys(value, ["version", "sample"], "pixel layer binding");
  if (value.version !== "pixel-layer-v1") throw new TypeError("pixel layer version is unsupported.");
  return Object.freeze({ version: "pixel-layer-v1", sample: parseRgba(value.sample, "pixel layer sample") });
}

export function parseTextureSample(value: unknown): TextureSampleBinding {
  if (!isRecord(value)) throw new TypeError("texture sample binding must be an object.");
  assertExactKeys(value, ["version", "sample", "width", "height"], "texture sample binding");
  if (value.version !== "texture-sample-v1") throw new TypeError("texture sample version is unsupported.");
  const width = finiteNumber(value.width, "texture width");
  const height = finiteNumber(value.height, "texture height");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("texture dimensions must be positive integers.");
  }
  return Object.freeze({
    version: "texture-sample-v1",
    sample: parseRgba(value.sample, "texture sample"),
    width,
    height
  });
}

export function parseMaterialSurface(value: unknown): MaterialSurfaceBinding {
  if (!isRecord(value)) throw new TypeError("material surface binding must be an object.");
  assertExactKeys(value, ["version", "baseColor", "facing", "luminance"], "material surface binding");
  if (value.version !== "material-surface-v1") throw new TypeError("material surface version is unsupported.");
  return Object.freeze({
    version: "material-surface-v1",
    baseColor: parseRgba(value.baseColor, "material base color"),
    facing: unitNumber(value.facing, "material facing"),
    luminance: unitNumber(value.luminance, "material luminance")
  });
}
