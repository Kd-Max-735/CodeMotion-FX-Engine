import type { AlphaMode, BlendMode, ColorSpace } from "@codemotion/core";

export interface PixelSurface {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly colorSpace: ColorSpace;
  readonly alphaMode: AlphaMode;
}

export interface PixelMask {
  readonly surface: PixelSurface;
  readonly mode: "add" | "subtract" | "intersect" | "none";
  readonly inverted?: boolean;
  readonly opacity?: number;
}

export interface ValidationPixelEffect {
  readonly id: string;
  readonly catalogContribution: false;
  apply(surface: PixelSurface): PixelSurface;
}

export const PIPELINE_VALIDATION_EFFECT: ValidationPixelEffect = Object.freeze({
  id: "internal.pipeline.tint-validation",
  catalogContribution: false,
  apply(surface: PixelSurface): PixelSurface {
    const output = cloneSurface(surface);
    for (let index = 0; index < output.data.length; index += 4) {
      output.data[index] = Math.round(output.data[index]! * 0.5);
      output.data[index + 1] = Math.round(output.data[index + 1]! * 0.75);
    }
    return output;
  }
});

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function decodeTransfer(value: number, colorSpace: ColorSpace): number {
  if (colorSpace === "linear-srgb") return value;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encodeTransfer(value: number, colorSpace: ColorSpace): number {
  const clamped = clamp(value);
  if (colorSpace === "linear-srgb") return clamped;
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

type Rgb = [number, number, number];

function multiply(
  matrix: readonly [number, number, number, number, number, number, number, number, number],
  value: readonly [number, number, number]
): Rgb {
  return [
    matrix[0] * value[0] + matrix[1] * value[1] + matrix[2] * value[2],
    matrix[3] * value[0] + matrix[4] * value[1] + matrix[5] * value[2],
    matrix[6] * value[0] + matrix[7] * value[1] + matrix[8] * value[2]
  ];
}

const DISPLAY_P3_TO_LINEAR_SRGB = Object.freeze([
  1.224745, -0.224904, 0,
  -0.042058, 1.042081, 0,
  -0.019642, -0.078655, 1.098537
] as const);

const LINEAR_SRGB_TO_DISPLAY_P3 = Object.freeze([
  0.822593, 0.177534, 0,
  0.033200, 0.966784, 0,
  0.017085, 0.072396, 0.910302
] as const);

export function decodeColorToLinearSrgb(
  value: readonly [number, number, number],
  colorSpace: ColorSpace
): Rgb {
  const decoded: Rgb = [
    decodeTransfer(value[0], colorSpace),
    decodeTransfer(value[1], colorSpace),
    decodeTransfer(value[2], colorSpace)
  ];
  return colorSpace === "display-p3" ? multiply(DISPLAY_P3_TO_LINEAR_SRGB, decoded) : decoded;
}

export function encodeLinearSrgbColor(
  value: readonly [number, number, number],
  colorSpace: ColorSpace
): Rgb {
  const primaries = colorSpace === "display-p3" ? multiply(LINEAR_SRGB_TO_DISPLAY_P3, value) : [...value] as Rgb;
  return [
    encodeTransfer(primaries[0], colorSpace),
    encodeTransfer(primaries[1], colorSpace),
    encodeTransfer(primaries[2], colorSpace)
  ];
}

function assertSurface(surface: PixelSurface): void {
  if (!Number.isInteger(surface.width) || surface.width < 1 || !Number.isInteger(surface.height) || surface.height < 1) {
    throw new RangeError("Pixel surface dimensions must be positive integers.");
  }
  if (surface.data.length !== surface.width * surface.height * 4) {
    throw new RangeError("Pixel surface data length does not match its dimensions.");
  }
}

function cloneSurface(surface: PixelSurface): PixelSurface {
  return { ...surface, data: new Uint8ClampedArray(surface.data) };
}

function readLinearStraight(surface: PixelSurface, offset: number): [number, number, number, number] {
  const alpha = surface.alphaMode === "none" ? 1 : surface.data[offset + 3]! / 255;
  const divisor = surface.alphaMode === "premultiplied" && alpha > 0 ? alpha : 1;
  const linear = decodeColorToLinearSrgb([
    clamp(surface.data[offset]! / 255 / divisor),
    clamp(surface.data[offset + 1]! / 255 / divisor),
    clamp(surface.data[offset + 2]! / 255 / divisor)
  ], surface.colorSpace);
  return [linear[0], linear[1], linear[2], alpha];
}

function writeLinearStraight(
  data: Uint8ClampedArray,
  offset: number,
  rgba: readonly [number, number, number, number],
  colorSpace: ColorSpace,
  alphaMode: AlphaMode
): void {
  const alpha = alphaMode === "none" ? 1 : clamp(rgba[3]);
  const multiplier = alphaMode === "premultiplied" ? alpha : 1;
  const encoded = encodeLinearSrgbColor([rgba[0], rgba[1], rgba[2]], colorSpace);
  data[offset] = Math.round(encoded[0] * multiplier * 255);
  data[offset + 1] = Math.round(encoded[1] * multiplier * 255);
  data[offset + 2] = Math.round(encoded[2] * multiplier * 255);
  data[offset + 3] = Math.round(alpha * 255);
}

export function convertPixelSurface(
  surface: PixelSurface,
  colorSpace: ColorSpace,
  alphaMode: AlphaMode
): PixelSurface {
  assertSurface(surface);
  const data = new Uint8ClampedArray(surface.data.length);
  for (let offset = 0; offset < data.length; offset += 4) {
    writeLinearStraight(data, offset, readLinearStraight(surface, offset), colorSpace, alphaMode);
  }
  return { width: surface.width, height: surface.height, data, colorSpace, alphaMode };
}

function softLight(backdrop: number, source: number): number {
  if (source <= 0.5) return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop);
  const d = backdrop <= 0.25
    ? ((16 * backdrop - 12) * backdrop + 4) * backdrop
    : Math.sqrt(backdrop);
  return backdrop + (2 * source - 1) * (d - backdrop);
}

function blendChannel(mode: BlendMode, backdrop: number, source: number): number {
  switch (mode) {
    case "multiply": return backdrop * source;
    case "screen": return backdrop + source - backdrop * source;
    case "overlay": return backdrop <= 0.5
      ? 2 * backdrop * source
      : 1 - 2 * (1 - backdrop) * (1 - source);
    case "darken": return Math.min(backdrop, source);
    case "lighten": return Math.max(backdrop, source);
    case "color-dodge": return source >= 1 ? 1 : Math.min(1, backdrop / (1 - source));
    case "color-burn": return source <= 0 ? 0 : 1 - Math.min(1, (1 - backdrop) / source);
    case "hard-light": return source <= 0.5
      ? 2 * backdrop * source
      : 1 - 2 * (1 - backdrop) * (1 - source);
    case "soft-light": return softLight(backdrop, source);
    case "difference": return Math.abs(backdrop - source);
    case "exclusion": return backdrop + source - 2 * backdrop * source;
    case "add": return Math.min(1, backdrop + source);
    default: return source;
  }
}

function luminosity(color: readonly number[]): number {
  return 0.3 * color[0]! + 0.59 * color[1]! + 0.11 * color[2]!;
}

function saturation(color: readonly number[]): number {
  return Math.max(...color) - Math.min(...color);
}

function clipColor(color: Rgb): Rgb {
  const lum = luminosity(color);
  const minimum = Math.min(...color);
  const maximum = Math.max(...color);
  let output: Rgb = [...color];
  if (minimum < 0) output = output.map((channel) => lum + ((channel - lum) * lum) / (lum - minimum)) as Rgb;
  if (maximum > 1) output = output.map((channel) => lum + ((channel - lum) * (1 - lum)) / (maximum - lum)) as Rgb;
  return output;
}

function setLuminosity(color: readonly number[], lum: number): Rgb {
  const delta = lum - luminosity(color);
  return clipColor(color.map((channel) => channel + delta) as Rgb);
}

function setSaturation(color: readonly number[], target: number): Rgb {
  const indexes = [0, 1, 2].sort((left, right) => color[left]! - color[right]!);
  const low = indexes[0]!;
  const middle = indexes[1]!;
  const high = indexes[2]!;
  const output: Rgb = [0, 0, 0];
  if (color[high]! > color[low]!) {
    output[middle] = ((color[middle]! - color[low]!) * target) / (color[high]! - color[low]!);
    output[high] = target;
  }
  return output;
}

function blendColor(mode: BlendMode, backdrop: Rgb, source: Rgb): Rgb {
  if (mode === "hue") return setLuminosity(setSaturation(source, saturation(backdrop)), luminosity(backdrop));
  if (mode === "saturation") return setLuminosity(setSaturation(backdrop, saturation(source)), luminosity(backdrop));
  if (mode === "color") return setLuminosity(source, luminosity(backdrop));
  if (mode === "luminosity") return setLuminosity(backdrop, luminosity(source));
  return [
    blendChannel(mode, backdrop[0], source[0]),
    blendChannel(mode, backdrop[1], source[1]),
    blendChannel(mode, backdrop[2], source[2])
  ];
}

export function compositePixelSurfaces(
  backdrop: PixelSurface,
  source: PixelSurface,
  blendMode: BlendMode,
  opacity = 1,
  outputColorSpace: ColorSpace = backdrop.colorSpace,
  outputAlphaMode: AlphaMode = backdrop.alphaMode
): PixelSurface {
  assertSurface(backdrop);
  assertSurface(source);
  if (backdrop.width !== source.width || backdrop.height !== source.height) {
    throw new RangeError("Composite inputs must have equal dimensions.");
  }
  const data = new Uint8ClampedArray(backdrop.data.length);
  const sourceOpacity = clamp(opacity);
  for (let offset = 0; offset < data.length; offset += 4) {
    const base = readLinearStraight(backdrop, offset);
    const top = readLinearStraight(source, offset);
    const sourceAlpha = top[3] * sourceOpacity;
    const outputAlpha = sourceAlpha + base[3] * (1 - sourceAlpha);
    const output = [0, 0, 0, outputAlpha] as [number, number, number, number];
    const mixed = blendColor(
      blendMode,
      [base[0], base[1], base[2]],
      [top[0], top[1], top[2]]
    );
    for (let channel = 0; channel < 3; channel += 1) {
      const premultiplied = (1 - sourceAlpha) * base[3] * base[channel]!
        + (1 - base[3]) * sourceAlpha * top[channel]!
        + base[3] * sourceAlpha * mixed[channel]!;
      output[channel] = outputAlpha === 0 ? 0 : premultiplied / outputAlpha;
    }
    writeLinearStraight(data, offset, output, outputColorSpace, outputAlphaMode);
  }
  return { width: backdrop.width, height: backdrop.height, data, colorSpace: outputColorSpace, alphaMode: outputAlphaMode };
}

export function applyPixelMasks(source: PixelSurface, masks: readonly PixelMask[]): PixelSurface {
  assertSurface(source);
  for (const mask of masks) {
    assertSurface(mask.surface);
    if (mask.surface.width !== source.width || mask.surface.height !== source.height) {
      throw new RangeError("Mask and source dimensions must match.");
    }
  }
  const output = cloneSurface(source);
  for (let offset = 0; offset < output.data.length; offset += 4) {
    let coverage: number | undefined;
    for (const mask of masks) {
      if (mask.mode === "none") continue;
      let value = readLinearStraight(mask.surface, offset)[3] * clamp(mask.opacity ?? 1);
      if (mask.inverted === true) value = 1 - value;
      if (coverage === undefined) coverage = mask.mode === "subtract" ? 1 - value : value;
      else if (mask.mode === "add") coverage = coverage + value - coverage * value;
      else if (mask.mode === "subtract") coverage *= 1 - value;
      else coverage *= value;
    }
    const maskAlpha = coverage ?? 1;
    const rgba = readLinearStraight(source, offset);
    rgba[3] *= maskAlpha;
    writeLinearStraight(output.data, offset, rgba, source.colorSpace, source.alphaMode);
  }
  return output;
}

export function executeValidationEffectStack(
  source: PixelSurface,
  effects: readonly ValidationPixelEffect[]
): PixelSurface {
  return effects.reduce((surface, effect) => effect.apply(surface), source);
}
