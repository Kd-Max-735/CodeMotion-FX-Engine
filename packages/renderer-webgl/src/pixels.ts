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

function toLinear(value: number, colorSpace: ColorSpace): number {
  if (colorSpace === "linear-srgb") return value;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number, colorSpace: ColorSpace): number {
  const clamped = clamp(value);
  if (colorSpace === "linear-srgb") return clamped;
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
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
  return [
    toLinear(clamp(surface.data[offset]! / 255 / divisor), surface.colorSpace),
    toLinear(clamp(surface.data[offset + 1]! / 255 / divisor), surface.colorSpace),
    toLinear(clamp(surface.data[offset + 2]! / 255 / divisor), surface.colorSpace),
    alpha
  ];
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
  data[offset] = Math.round(fromLinear(rgba[0], colorSpace) * multiplier * 255);
  data[offset + 1] = Math.round(fromLinear(rgba[1], colorSpace) * multiplier * 255);
  data[offset + 2] = Math.round(fromLinear(rgba[2], colorSpace) * multiplier * 255);
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

function blendChannel(mode: BlendMode, backdrop: number, source: number): number {
  switch (mode) {
    case "multiply": return backdrop * source;
    case "screen": return backdrop + source - backdrop * source;
    case "darken": return Math.min(backdrop, source);
    case "lighten": return Math.max(backdrop, source);
    case "difference": return Math.abs(backdrop - source);
    case "exclusion": return backdrop + source - 2 * backdrop * source;
    case "add": return Math.min(1, backdrop + source);
    default: return source;
  }
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
    for (let channel = 0; channel < 3; channel += 1) {
      const mixed = blendChannel(blendMode, base[channel]!, top[channel]!);
      const premultiplied = (1 - sourceAlpha) * base[3] * base[channel]!
        + (1 - base[3]) * sourceAlpha * top[channel]!
        + base[3] * sourceAlpha * mixed;
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
