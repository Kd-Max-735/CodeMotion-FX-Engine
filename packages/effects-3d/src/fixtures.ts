import type { ColorSpace, LayerTimeSample } from "@codemotion/core";
import type {
  CoverageBuffer,
  LayerRasterizationInput,
  RasterGlyph
} from "@codemotion/renderer-api";
import type {
  PixelSurface,
  TextExtrude3DRasterInput
} from "./types.js";

const GLYPH_ROWS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  X: ["10001", "01010", "00100", "00100", "00100", "01010", "10001"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  Ω: ["01110", "10001", "10001", "10001", "10001", "01010", "11011"],
  立: ["00100", "11111", "00100", "01010", "01010", "10001", "11111"],
  体: ["10100", "10111", "10101", "11111", "10101", "10101", "10111"]
});

function glyphCoverage(rows: readonly string[], scale: number): CoverageBuffer {
  const width = rows[0]!.length * scale;
  const height = rows.length * scale;
  const data = new Uint8ClampedArray(width * height);
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < rows[row]!.length; column += 1) {
      if (rows[row]![column] !== "1") continue;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const edge = x === 0 || y === 0 || x === scale - 1 || y === scale - 1;
          data[(row * scale + y) * width + column * scale + x] = edge ? 208 : 255;
        }
      }
    }
  }
  return { width, height, data, rowOrder: "top-to-bottom" };
}

export function makeTextExtrudeRasterFixture(
  text: string,
  width: number,
  height: number,
  layerTime: LayerTimeSample,
  colorSpace: ColorSpace = "srgb"
): TextExtrude3DRasterInput {
  const characters = Array.from(text);
  const visibleCharacters = characters.filter((character) => character !== " ");
  if (visibleCharacters.length === 0) throw new TypeError("Preview text requires at least one visible glyph.");
  for (const character of visibleCharacters) {
    if (!GLYPH_ROWS[character]) throw new TypeError(`No reviewed raster fixture exists for Unicode glyph ${character}.`);
  }
  const scale = Math.max(1, Math.floor(Math.min(
    width / Math.max(8, characters.length * 6 + 2),
    height / 9
  )));
  const textWidth = (characters.length * 6 - 1) * scale;
  const startX = Math.max(0, Math.floor((width - textWidth) / 2));
  const startY = Math.max(0, Math.floor((height - 7 * scale) / 2));
  const glyphs: RasterGlyph[] = [];
  let cluster = 0;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (character !== " ") {
      const coverage = glyphCoverage(GLYPH_ROWS[character]!, scale);
      glyphs.push({
        glyphId: character.codePointAt(0)!,
        cluster,
        advance: 6 * scale,
        offsetX: 0,
        offsetY: 0,
        bounds: {
          x: startX + index * 6 * scale,
          y: startY,
          width: coverage.width,
          height: coverage.height
        },
        coverage
      });
    }
    cluster += character.length;
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (const glyph of glyphs) {
    for (let y = 0; y < glyph.coverage.height; y += 1) {
      for (let x = 0; x < glyph.coverage.width; x += 1) {
        const coverage = glyph.coverage.data[y * glyph.coverage.width + x]!;
        if (coverage === 0) continue;
        const targetX = Math.round(glyph.bounds.x + x);
        const targetY = Math.round(glyph.bounds.y + y);
        if (targetX < 0 || targetY < 0 || targetX >= width || targetY >= height) continue;
        const offset = (targetY * width + targetX) * 4;
        const ratio = coverage / 255;
        data[offset] = Math.round(72 * ratio);
        data[offset + 1] = Math.round((145 + targetX / Math.max(1, width - 1) * 90) * ratio);
        data[offset + 2] = coverage;
        data[offset + 3] = coverage;
      }
    }
  }
  const surface: PixelSurface = {
    width,
    height,
    data,
    colorSpace,
    alphaMode: "premultiplied"
  };
  const rasterInput: LayerRasterizationInput & {
    readonly layerType: "text";
    readonly source: LayerRasterizationInput["source"] & { readonly kind: "text" };
  } = {
    layerId: layerTime.layerId,
    layerType: "text",
    source: {
      kind: "text",
      text,
      font: {
        fontId: "font.fixture.noto-sans-multilingual",
        assetId: "fixture://fonts/noto-sans-multilingual.woff2",
        assetHash: "sha256:31e8d23c0c8a2f63-reviewed-glyph-raster-fixture",
        family: "Noto Sans Fixture",
        style: "normal",
        weight: 700,
        unitsPerEm: 1000,
        missingGlyphPolicy: "error"
      },
      glyphs
    },
    time: layerTime,
    transform: {
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      anchor: [0, 0]
    },
    opacity: 1,
    masks: [],
    target: {
      width,
      height,
      format: "rgba8",
      colorSpace,
      samples: 1,
      usage: "input"
    }
  };
  return { rasterInput, surface };
}

export function makeTextExtrudeMask(
  width: number,
  height: number,
  coverage: number
): PixelSurface {
  const value = Math.round(Math.min(1, Math.max(0, coverage)) * 255);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = data[offset + 1] = data[offset + 2] = value;
    data[offset + 3] = value;
  }
  return { width, height, data, colorSpace: "srgb", alphaMode: "premultiplied" };
}

/** @deprecated Generic pixel-only text fixtures are forbidden by the Stage 5R contract. */
export function makeTextExtrudePreviewInput(_width?: number, _height?: number): never {
  throw new TypeError(
    "makeTextExtrudePreviewInput was removed: supply TextRasterSource glyph coverage and official time."
  );
}
