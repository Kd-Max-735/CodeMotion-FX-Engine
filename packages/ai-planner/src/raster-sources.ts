import { createHash } from "node:crypto";
import { parseSvgPathData } from "@codemotion/effects-2d";
import type {
  CoverageBuffer,
  RasterGlyph,
  TextRasterSource,
  VectorRasterSource
} from "@codemotion/renderer-api";

function hashNumber(value: string): number {
  return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0, 8), 16) >>> 0;
}

function graphemes(value: string): Array<{ readonly segment: string; readonly index: number }> {
  const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
  return [...segmenter.segment(value)].map((entry) => ({
    segment: entry.segment,
    index: entry.index
  }));
}

function glyphCoverage(segment: string, width: number, height: number): CoverageBuffer {
  const data = new Uint8Array(width * height);
  if (!/^\s+$/u.test(segment)) {
    const bits = hashNumber(segment.normalize("NFC"));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const column = Math.min(4, Math.floor(x * 5 / width));
        const row = Math.min(6, Math.floor(y * 7 / height));
        const edge = column === 0 || column === 4 || row === 0 || row === 6;
        const diagonal = (column + row + (bits & 3)) % 5 === 0;
        const contentBit = (bits >>> ((column + row * 5) % 31)) & 1;
        data[y * width + x] = edge || diagonal || contentBit === 1 ? 255 : 0;
      }
    }
  }
  return Object.freeze({ width, height, data, rowOrder: "top-to-bottom" as const });
}

export function textRasterSource(
  text: string,
  family: string,
  fontSize: number,
  previewWidth: number,
  previewHeight: number,
  projectWidth: number,
  projectHeight: number
): TextRasterSource {
  const units = graphemes(text);
  const scale = Math.min(previewWidth / projectWidth, previewHeight / projectHeight);
  const height = Math.max(7, Math.min(previewHeight - 4, Math.round(fontSize * scale)));
  const desiredWidth = Math.max(4, Math.round(height * 0.62));
  const visibleCount = Math.max(1, Math.min(units.length, 96));
  const width = Math.max(2, Math.min(desiredWidth, Math.floor((previewWidth - 4) / visibleCount) - 1));
  const lineWidth = visibleCount * (width + 1);
  const startX = Math.max(2, Math.floor((previewWidth - lineWidth) / 2));
  const startY = Math.max(2, Math.floor((previewHeight - height) / 2));
  const glyphs: RasterGlyph[] = units.slice(0, visibleCount).map((unit, index) => {
    const coverage = glyphCoverage(unit.segment, width, height);
    return Object.freeze({
      glyphId: hashNumber(unit.segment),
      cluster: unit.index,
      advance: width + 1,
      offsetX: 0,
      offsetY: 0,
      bounds: Object.freeze({
        x: startX + index * (width + 1),
        y: startY,
        width,
        height
      }),
      coverage
    });
  });
  const fontHash = createHash("sha256")
    .update("codemotion-planner-unicode-bitmap-v1\0")
    .update(family)
    .digest("hex");
  return Object.freeze({
    kind: "text",
    text,
    font: Object.freeze({
      fontId: "font.ai-planner.unicode-bitmap",
      assetId: "font.ai-planner.unicode-bitmap",
      assetHash: `sha256:${fontHash}`,
      family,
      style: "normal",
      weight: 500,
      unitsPerEm: 1000,
      missingGlyphPolicy: "error" as const
    }),
    glyphs: Object.freeze(glyphs)
  });
}

export function vectorRasterSource(pathData: string): VectorRasterSource {
  return Object.freeze({
    kind: "svg",
    viewport: Object.freeze({ x: 0, y: 0, width: 1, height: 1 }),
    paths: Object.freeze([parseSvgPathData(pathData, {
      fillRule: "nonzero",
      fill: "#58d6ff",
      stroke: "#ffffff",
      strokeWidth: 0.025
    })])
  });
}

export function coverageAsset(identity: string, size = 17): CoverageBuffer {
  const data = new Uint8Array(size * size);
  const eccentricity = 0.75 + (hashNumber(identity) % 20) / 100;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = ((x + 0.5) / size - 0.5) / eccentricity;
      const dy = (y + 0.5) / size - 0.5;
      data[y * size + x] = Math.round(Math.max(0, Math.min(1, (0.5 - Math.hypot(dx, dy)) * size * 0.45)) * 255);
    }
  }
  return Object.freeze({ width: size, height: size, data, rowOrder: "top-to-bottom" as const });
}
