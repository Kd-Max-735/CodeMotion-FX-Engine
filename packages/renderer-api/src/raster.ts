import type {
  AlphaMode,
  ColorSpace,
  EffectTimeSample,
  LayerTimeSample
} from "@codemotion/core";
import type { FrameContext, TextureDescriptor, TextureHandle } from "./index.js";

export const RASTERIZATION_CONTRACT_VERSION = "1.0.0" as const;

export type RasterSourceKind = "text" | "shape" | "svg" | "image" | "video";
export type MissingGlyphPolicy = "error" | "use-notdef" | "skip";

export interface RasterBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PixelBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly colorSpace: ColorSpace;
  readonly alphaMode: AlphaMode;
  readonly rowOrder: "top-to-bottom";
}

export interface CoverageBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
  readonly rowOrder: "top-to-bottom";
}

export interface FontRasterAsset {
  readonly fontId: string;
  readonly assetId: string;
  readonly assetHash: string;
  readonly family: string;
  readonly style: string;
  readonly weight: number;
  readonly unitsPerEm: number;
  readonly missingGlyphPolicy: MissingGlyphPolicy;
  readonly notdefGlyphId?: number;
}

export interface RasterGlyph {
  readonly glyphId: number;
  readonly cluster: number;
  readonly advance: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly bounds: RasterBounds;
  readonly coverage: CoverageBuffer;
}

export interface TextRasterSource {
  readonly kind: "text";
  readonly text: string;
  readonly font: FontRasterAsset;
  readonly glyphs: readonly RasterGlyph[];
}

export type VectorPathCommand =
  | { readonly op: "move"; readonly x: number; readonly y: number }
  | { readonly op: "line"; readonly x: number; readonly y: number }
  | {
      readonly op: "cubic";
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: "close" };

export interface VectorRasterPath {
  readonly commands: readonly VectorPathCommand[];
  readonly fillRule: "nonzero" | "evenodd";
  readonly fill: string | null;
  readonly stroke: string | null;
  readonly strokeWidth: number;
}

export interface VectorRasterSource {
  readonly kind: "shape" | "svg";
  readonly viewport: RasterBounds;
  readonly paths: readonly VectorRasterPath[];
}

export interface MediaRasterSource {
  readonly kind: "image" | "video";
  readonly assetId: string;
  readonly assetHash: string;
  readonly frameTime: number;
  readonly pixels: PixelBuffer;
}

export type LayerRasterSource = TextRasterSource | VectorRasterSource | MediaRasterSource;

export interface RasterTransform {
  /**
   * Row-major affine matrix mapping layer-local coordinates to output pixels.
   * M = translate(position) * rotate * skew * scale * translate(-anchor).
   */
  readonly matrix: readonly [number, number, number, number, number, number, number, number, number];
  readonly anchor: readonly [number, number];
}

export interface RasterMaskInput {
  readonly id: string;
  readonly mode: "add" | "subtract" | "intersect" | "none";
  readonly inverted: boolean;
  readonly opacity: number;
  readonly coverage: CoverageBuffer;
  readonly transform: RasterTransform;
}

export interface LayerRasterizationInput {
  readonly layerId: string;
  readonly layerType: RasterSourceKind;
  readonly source: LayerRasterSource;
  readonly time: LayerTimeSample;
  readonly transform: RasterTransform;
  readonly opacity: number;
  readonly masks: readonly RasterMaskInput[];
  readonly target: TextureDescriptor;
}

export interface LayerRasterizationOutput {
  readonly texture: TextureHandle;
  readonly sourceKind: RasterSourceKind;
  readonly contentBounds: RasterBounds;
  readonly coveredPixelCount: number;
  readonly contentDigest: string;
  readonly alphaMode: "premultiplied";
  readonly usedSolidFallback: false;
}

export interface DualInputTextures {
  readonly source: LayerRasterizationOutput;
  readonly secondary: LayerRasterizationOutput;
}

export interface TemporalFrameContext extends FrameContext {
  readonly projectTime: number;
}

export interface TemporalEffectContext {
  readonly frame: TemporalFrameContext;
  readonly layerTime: LayerTimeSample;
  readonly effectTime: EffectTimeSample;
}

export const RASTER_COORDINATE_CONTRACT = Object.freeze({
  contractVersion: RASTERIZATION_CONTRACT_VERSION,
  origin: "top-left",
  xAxis: "right",
  yAxis: "down",
  pixelSample: "area-coverage",
  pixelBounds: "half-open",
  pixelCenterOffset: 0.5,
  alphaAssociation: "premultiply-after-color-conversion",
  outputAlphaMode: "premultiplied",
  maskChannel: "coverage"
} as const);

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer.`);
}

function assertCoverage(coverage: CoverageBuffer, name: string): void {
  assertPositiveInteger(coverage.width, `${name}.width`);
  assertPositiveInteger(coverage.height, `${name}.height`);
  if (coverage.data.length !== coverage.width * coverage.height) {
    throw new RangeError(`${name}.data must contain one coverage byte per pixel.`);
  }
}

function assertFiniteValues(values: readonly number[], name: string): void {
  if (!values.every(Number.isFinite)) throw new RangeError(`${name} must contain only finite values.`);
}

function assertTransform(transform: RasterTransform, name: string): void {
  assertFiniteValues(transform.matrix, `${name}.matrix`);
  assertFiniteValues(transform.anchor, `${name}.anchor`);
  if (transform.matrix[6] !== 0 || transform.matrix[7] !== 0 || transform.matrix[8] !== 1) {
    throw new RangeError(`${name}.matrix must be a normalized affine matrix.`);
  }
}

export function assertLayerRasterizationInput(input: LayerRasterizationInput): void {
  if (input.layerType !== input.source.kind) {
    throw new TypeError("layerType and raster source kind must match.");
  }
  assertTransform(input.transform, "transform");
  if (input.source.kind === "text") {
    if (input.source.font.assetId.length === 0 || input.source.font.assetHash.length === 0) {
      throw new TypeError("Text rasterization requires an immutable font asset identity.");
    }
    if (input.source.font.missingGlyphPolicy === "use-notdef" && input.source.font.notdefGlyphId === undefined) {
      throw new TypeError("use-notdef requires notdefGlyphId.");
    }
    if (!Number.isInteger(input.source.font.unitsPerEm) || input.source.font.unitsPerEm < 1) {
      throw new RangeError("Font unitsPerEm must be a positive integer.");
    }
    for (const [index, glyph] of input.source.glyphs.entries()) {
      assertCoverage(glyph.coverage, `glyphs[${index}].coverage`);
      assertFiniteValues([
        glyph.advance,
        glyph.offsetX,
        glyph.offsetY,
        glyph.bounds.x,
        glyph.bounds.y,
        glyph.bounds.width,
        glyph.bounds.height
      ], `glyphs[${index}] metrics`);
    }
  } else if (input.source.kind === "shape" || input.source.kind === "svg") {
    if (input.source.paths.length === 0) throw new TypeError("Vector rasterization requires at least one real path.");
    if (input.source.paths.some((path) => path.commands.length === 0)) {
      throw new TypeError("Every vector raster path requires commands.");
    }
  } else if ("pixels" in input.source) {
    const pixels = input.source.pixels;
    assertPositiveInteger(pixels.width, "pixels.width");
    assertPositiveInteger(pixels.height, "pixels.height");
    if (pixels.data.length !== pixels.width * pixels.height * 4) {
      throw new RangeError("Media pixels must contain exact RGBA data.");
    }
    if (input.source.assetId.length === 0 || input.source.assetHash.length === 0
      || !Number.isFinite(input.source.frameTime)) {
      throw new TypeError("Media rasterization requires immutable asset identity and finite frame time.");
    }
  } else {
    throw new TypeError("Unsupported raster source kind.");
  }
  for (const [index, mask] of input.masks.entries()) {
    assertCoverage(mask.coverage, `masks[${index}].coverage`);
    assertTransform(mask.transform, `masks[${index}].transform`);
    if (!Number.isFinite(mask.opacity) || mask.opacity < 0 || mask.opacity > 1) {
      throw new RangeError(`masks[${index}].opacity must be within [0, 1].`);
    }
  }
  if (input.opacity < 0 || input.opacity > 1 || !Number.isFinite(input.opacity)) {
    throw new RangeError("Raster opacity must be within [0, 1].");
  }
}

export function assertLayerRasterizationOutput(
  input: LayerRasterizationInput,
  output: LayerRasterizationOutput
): void {
  if (output.sourceKind !== input.source.kind) throw new TypeError("Raster output must preserve source provenance.");
  if (output.usedSolidFallback !== false) throw new TypeError("Full-frame solid fallback is forbidden.");
  if (output.alphaMode !== "premultiplied") throw new TypeError("Raster outputs must use premultiplied Alpha.");
  if (output.contentDigest.length === 0) throw new TypeError("Raster output requires a source-derived content digest.");
  if (!Number.isInteger(output.coveredPixelCount) || output.coveredPixelCount < 0
    || output.coveredPixelCount > input.target.width * input.target.height) {
    throw new RangeError("coveredPixelCount must be a non-negative integer.");
  }
  const bounds = output.contentBounds;
  assertFiniteValues([bounds.x, bounds.y, bounds.width, bounds.height], "contentBounds");
  if (bounds.x < 0 || bounds.y < 0 || bounds.width < 0 || bounds.height < 0
    || bounds.x + bounds.width > input.target.width || bounds.y + bounds.height > input.target.height) {
    throw new RangeError("contentBounds must be clipped to the target texture.");
  }
  if (output.texture.descriptor.width !== input.target.width
    || output.texture.descriptor.height !== input.target.height
    || output.texture.descriptor.colorSpace !== input.target.colorSpace) {
    throw new TypeError("Raster output texture must match the requested target geometry and color space.");
  }
}

export function assertDualInputTextures(inputs: DualInputTextures): void {
  if (inputs.source.texture.id === inputs.secondary.texture.id) {
    throw new TypeError("Dual-input effects require two independently materialized content textures.");
  }
  const first = inputs.source.texture.descriptor;
  const second = inputs.secondary.texture.descriptor;
  if (first.width !== second.width || first.height !== second.height || first.colorSpace !== second.colorSpace) {
    throw new TypeError("Dual-input textures must share dimensions and color space.");
  }
}

export function assertTemporalEffectContext(context: TemporalEffectContext): void {
  if (context.frame.time !== context.frame.projectTime
    || context.layerTime.projectTime !== context.frame.projectTime
    || context.effectTime.projectTime !== context.frame.projectTime
    || context.effectTime.layerTime !== context.layerTime.localTime
    || context.effectTime.fps !== context.frame.fps
    || context.effectTime.frame !== context.frame.frame) {
    throw new TypeError("Temporal effect context clocks are inconsistent.");
  }
}
