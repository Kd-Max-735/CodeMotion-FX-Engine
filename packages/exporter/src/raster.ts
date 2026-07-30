import { createHash } from "node:crypto";
import { rasterizeLayerInput, type PixelSurface } from "@codemotion/effects-2d";
import {
  BACKEND_CONFORMANCE_CONTRACT,
  BLEND_CONFORMANCE_FIXTURES,
  COLOR_CONFORMANCE_FIXTURES,
  assertLayerRasterizationInput,
  assertLayerRasterizationOutput,
  type CoverageBuffer,
  type LayerRasterizationInput,
  type LayerRasterizationOutput,
  type RasterMaskInput,
  type RasterTransform
} from "@codemotion/renderer-api";
import {
  applyPixelMasks,
  compositePixelSurfaces,
  convertPixelSurface
} from "@codemotion/renderer-webgl";

export interface RasterizedProjectLayer {
  readonly input: LayerRasterizationInput;
  readonly surface: PixelSurface;
  readonly output: LayerRasterizationOutput;
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function transformedSurface(source: PixelSurface, transform: RasterTransform): PixelSurface {
  const [a, b, tx, c, d, ty] = transform.matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 1e-12) {
    throw new RangeError("Raster transform must be invertible.");
  }
  const output = new Uint8ClampedArray(source.data.length);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const dx = x + 0.5 - tx;
      const dy = y + 0.5 - ty;
      const sourceX = (d * dx - b * dy) / determinant - 0.5;
      const sourceY = (-c * dx + a * dy) / determinant - 0.5;
      const sx = Math.round(sourceX);
      const sy = Math.round(sourceY);
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
      const from = (sy * source.width + sx) * 4;
      output.set(source.data.subarray(from, from + 4), (y * source.width + x) * 4);
    }
  }
  return { ...source, data: output };
}

function coverageSurface(
  coverage: CoverageBuffer,
  width: number,
  height: number,
  colorSpace: PixelSurface["colorSpace"],
  transform: RasterTransform
): PixelSurface {
  const data = new Uint8ClampedArray(width * height * 4);
  const copyWidth = Math.min(width, coverage.width);
  const copyHeight = Math.min(height, coverage.height);
  for (let y = 0; y < copyHeight; y += 1) {
    for (let x = 0; x < copyWidth; x += 1) {
      const alpha = coverage.data[y * coverage.width + x]!;
      const offset = (y * width + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  return transformedSurface({ width, height, data, colorSpace, alphaMode: "straight" }, transform);
}

export function rasterMaskSurface(
  mask: RasterMaskInput,
  width: number,
  height: number,
  colorSpace: PixelSurface["colorSpace"]
): PixelSurface {
  return coverageSurface(mask.coverage, width, height, colorSpace, mask.transform);
}

export function effectMaskSurface(
  mask: RasterMaskInput,
  width: number,
  height: number,
  colorSpace: PixelSurface["colorSpace"]
): PixelSurface {
  const surface = rasterMaskSurface(mask, width, height, colorSpace);
  const data = new Uint8ClampedArray(surface.data);
  for (let offset = 3; offset < data.length; offset += 4) {
    const coverage = data[offset]! / 255;
    const effective = (mask.inverted ? 1 - coverage : coverage) * mask.opacity;
    data[offset] = clampByte(effective * 255);
  }
  return { ...surface, data };
}

function applyOpacity(surface: PixelSurface, opacity: number): PixelSurface {
  if (opacity === 1) return surface;
  const data = new Uint8ClampedArray(surface.data);
  for (let offset = 3; offset < data.length; offset += 4) {
    data[offset] = clampByte(data[offset]! * opacity);
  }
  return { ...surface, data };
}

export function transformProjectSurface(
  surface: PixelSurface,
  transform: RasterTransform,
  opacity: number,
  masks: readonly RasterMaskInput[] = []
): PixelSurface {
  let output = transformedSurface(surface, transform);
  if (masks.length > 0) {
    output = applyPixelMasks(output, masks.map((mask) => ({
      surface: rasterMaskSurface(mask, output.width, output.height, output.colorSpace),
      mode: mask.mode,
      inverted: mask.inverted,
      opacity: mask.opacity
    })));
  }
  return applyOpacity(output, opacity);
}

function materializedOutput(input: LayerRasterizationInput, surface: PixelSurface): LayerRasterizationOutput {
  const premultiplied = convertPixelSurface(surface, input.target.colorSpace, "premultiplied");
  let minX = input.target.width;
  let minY = input.target.height;
  let maxX = -1;
  let maxY = -1;
  let coveredPixelCount = 0;
  for (let y = 0; y < input.target.height; y += 1) {
    for (let x = 0; x < input.target.width; x += 1) {
      if (premultiplied.data[(y * input.target.width + x) * 4 + 3] === 0) continue;
      coveredPixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  const digest = createHash("sha256").update(premultiplied.data).digest("hex");
  const output: LayerRasterizationOutput = {
    texture: {
      id: `export:${input.layerId}:${input.time.projectTime}:${digest.slice(0, 16)}`,
      backend: "server",
      descriptor: input.target
    },
    sourceKind: input.source.kind,
    contentBounds: coveredPixelCount === 0
      ? { x: 0, y: 0, width: 0, height: 0 }
      : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    coveredPixelCount,
    contentDigest: digest,
    alphaMode: "premultiplied",
    usedSolidFallback: false
  };
  assertLayerRasterizationOutput(input, output);
  return output;
}

export function rasterizeProjectLayer(input: LayerRasterizationInput): RasterizedProjectLayer {
  assertLayerRasterizationInput(input);
  let surface = rasterizeLayerInput(input);
  surface = convertPixelSurface(surface, input.target.colorSpace, "straight");
  surface = transformProjectSurface(surface, input.transform, input.opacity, input.masks);
  return Object.freeze({ input, surface, output: materializedOutput(input, surface) });
}

export function mixProjectSurfaces(source: PixelSurface, effected: PixelSurface, mix: number): PixelSurface {
  const amount = Math.min(1, Math.max(0, mix));
  if (amount === 0) return source;
  if (amount === 1) return effected;
  const sourceLinear = convertPixelSurface(source, "linear-srgb", "premultiplied");
  const effectLinear = convertPixelSurface(effected, "linear-srgb", "premultiplied");
  const data = new Uint8ClampedArray(sourceLinear.data.length);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = clampByte(sourceLinear.data[index]!
      + (effectLinear.data[index]! - sourceLinear.data[index]!) * amount);
  }
  return convertPixelSurface({
    width: source.width,
    height: source.height,
    data,
    colorSpace: "linear-srgb",
    alphaMode: "premultiplied"
  }, source.colorSpace, source.alphaMode);
}

function singlePixel(rgba: readonly number[], colorSpace: PixelSurface["colorSpace"], alphaMode: PixelSurface["alphaMode"]): PixelSurface {
  return { width: 1, height: 1, data: new Uint8ClampedArray(rgba), colorSpace, alphaMode };
}

export function assertExportBackendConformance(): void {
  const tolerance = BACKEND_CONFORMANCE_CONTRACT.rgba8ChannelTolerance;
  for (const fixture of COLOR_CONFORMANCE_FIXTURES) {
    const actual = convertPixelSurface(
      singlePixel(fixture.sourceRgba8, fixture.sourceColorSpace, fixture.sourceAlphaMode),
      fixture.targetColorSpace,
      fixture.targetAlphaMode
    );
    fixture.expectedRgba8.forEach((expected, channel) => {
      if (Math.abs(actual.data[channel]! - expected) > tolerance) {
        throw new Error(`Exporter color backend failed conformance fixture ${fixture.id}.`);
      }
    });
  }
  for (const fixture of BLEND_CONFORMANCE_FIXTURES) {
    const actual = compositePixelSurfaces(
      singlePixel(fixture.backdropRgba8, "srgb", "straight"),
      singlePixel(fixture.sourceRgba8, "srgb", "straight"),
      fixture.blendMode,
      fixture.opacity,
      "srgb",
      "premultiplied"
    );
    fixture.expectedRgba8.forEach((expected, channel) => {
      if (Math.abs(actual.data[channel]! - expected) > tolerance) {
        throw new Error(`Exporter blend backend failed conformance fixture ${fixture.id}.`);
      }
    });
  }
}
