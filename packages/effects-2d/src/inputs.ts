import {
  TIME_CONTRACT_VERSION,
  type ColorSpace,
  type EffectTimeSample,
  type LayerTimeSample
} from "@codemotion/core";
import {
  assertLayerRasterizationInput,
  type CoverageBuffer,
  type LayerRasterizationInput,
  type MediaRasterSource,
  type RasterGlyph,
  type TextRasterSource,
  type VectorPathCommand,
  type VectorRasterPath,
  type VectorRasterSource
} from "@codemotion/renderer-api";
import type { PixelSurface } from "./types.js";

export interface FlattenedPathPoint {
  readonly x: number;
  readonly y: number;
  readonly progress: number;
}

const IDENTITY_TRANSFORM = Object.freeze({
  matrix: Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1] as const),
  anchor: Object.freeze([0, 0] as const)
});

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function assertFinite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
  return value;
}

function tokenizePath(value: string): readonly string[] {
  const tokens = value.match(/[MLCZmlcz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/giu) ?? [];
  const compact = value.replace(/[\s,]+/gu, "");
  if (tokens.join("").toLowerCase() !== compact.toLowerCase()) {
    throw new SyntaxError("SVG path contains unsupported or malformed tokens.");
  }
  return tokens;
}

/**
 * Strict P0 SVG path parser. The initial release intentionally supports the
 * command set represented by the frozen catalog: M/m, L/l, C/c and Z/z.
 */
export function parseSvgPathData(
  value: string,
  style: Pick<VectorRasterPath, "fillRule" | "fill" | "stroke" | "strokeWidth"> = {
    fillRule: "nonzero",
    fill: null,
    stroke: "#ffffff",
    strokeWidth: 0.025
  }
): VectorRasterPath {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("SVG path data must be a non-empty string.");
  }
  const tokens = tokenizePath(value);
  const commands: VectorPathCommand[] = [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const number = (name: string): number => {
    const token = tokens[index++];
    if (token === undefined || /^[MLCZ]$/iu.test(token)) {
      throw new SyntaxError(`SVG path ${name} is missing.`);
    }
    return assertFinite(Number(token), `SVG path ${name}`);
  };
  while (index < tokens.length) {
    if (/^[MLCZ]$/iu.test(tokens[index]!)) command = tokens[index++]!;
    if (command.length === 0) throw new SyntaxError("SVG path must begin with a command.");
    const relative = command === command.toLowerCase();
    const op = command.toUpperCase();
    if (op === "Z") {
      commands.push({ op: "close" });
      x = startX;
      y = startY;
      command = "";
      continue;
    }
    if (op === "M" || op === "L") {
      const nextX = number("x") + (relative ? x : 0);
      const nextY = number("y") + (relative ? y : 0);
      x = nextX;
      y = nextY;
      if (op === "M") {
        commands.push({ op: "move", x, y });
        startX = x;
        startY = y;
        command = relative ? "l" : "L";
      } else {
        commands.push({ op: "line", x, y });
      }
      continue;
    }
    if (op === "C") {
      const x1 = number("x1") + (relative ? x : 0);
      const y1 = number("y1") + (relative ? y : 0);
      const x2 = number("x2") + (relative ? x : 0);
      const y2 = number("y2") + (relative ? y : 0);
      const nextX = number("x") + (relative ? x : 0);
      const nextY = number("y") + (relative ? y : 0);
      commands.push({ op: "cubic", x1, y1, x2, y2, x: nextX, y: nextY });
      x = nextX;
      y = nextY;
      continue;
    }
    throw new SyntaxError(`Unsupported SVG path command ${command}.`);
  }
  if (commands.length === 0 || commands[0]?.op !== "move") {
    throw new SyntaxError("SVG path must contain a move command and drawable geometry.");
  }
  if (!commands.some((entry) => entry.op === "line" || entry.op === "cubic")) {
    throw new SyntaxError("SVG path must contain drawable line or cubic geometry.");
  }
  if (!Number.isFinite(style.strokeWidth) || style.strokeWidth < 0) {
    throw new RangeError("SVG strokeWidth must be finite and non-negative.");
  }
  return Object.freeze({
    commands: Object.freeze(commands),
    fillRule: style.fillRule,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth
  });
}

export function flattenVectorPath(path: VectorRasterPath, cubicSteps = 24): readonly FlattenedPathPoint[] {
  if (!Number.isInteger(cubicSteps) || cubicSteps < 2) {
    throw new RangeError("cubicSteps must be an integer of at least 2.");
  }
  const raw: Array<{ x: number; y: number }> = [];
  let current = { x: 0, y: 0 };
  let start = current;
  for (const command of path.commands) {
    if (command.op === "move") {
      current = { x: command.x, y: command.y };
      start = current;
      raw.push(current);
    } else if (command.op === "line") {
      current = { x: command.x, y: command.y };
      raw.push(current);
    } else if (command.op === "cubic") {
      const origin = current;
      for (let step = 1; step <= cubicSteps; step += 1) {
        const t = step / cubicSteps;
        const inverse = 1 - t;
        raw.push({
          x: inverse ** 3 * origin.x
            + 3 * inverse ** 2 * t * command.x1
            + 3 * inverse * t ** 2 * command.x2
            + t ** 3 * command.x,
          y: inverse ** 3 * origin.y
            + 3 * inverse ** 2 * t * command.y1
            + 3 * inverse * t ** 2 * command.y2
            + t ** 3 * command.y
        });
      }
      current = { x: command.x, y: command.y };
    } else {
      current = start;
      raw.push(current);
    }
  }
  if (raw.length < 2) throw new TypeError("Vector path does not contain a drawable segment.");
  const lengths = [0];
  for (let index = 1; index < raw.length; index += 1) {
    const previous = raw[index - 1]!;
    const point = raw[index]!;
    lengths.push(lengths[index - 1]! + Math.hypot(point.x - previous.x, point.y - previous.y));
  }
  const total = lengths[lengths.length - 1]!;
  if (total <= 0) throw new TypeError("Vector path length must be positive.");
  return Object.freeze(raw.map((point, index) => Object.freeze({
    ...point,
    progress: lengths[index]! / total
  })));
}

function segmentDistance(
  x: number,
  y: number,
  first: FlattenedPathPoint,
  second: FlattenedPathPoint
): { distance: number; progress: number } {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : clamp(((x - first.x) * dx + (y - first.y) * dy) / lengthSquared);
  return {
    distance: Math.hypot(x - (first.x + dx * t), y - (first.y + dy * t)),
    progress: first.progress + (second.progress - first.progress) * t
  };
}

export function sampleVectorPath(
  points: readonly FlattenedPathPoint[],
  x: number,
  y: number
): { readonly distance: number; readonly progress: number } {
  let closest = { distance: Number.POSITIVE_INFINITY, progress: 0 };
  for (let index = 1; index < points.length; index += 1) {
    const candidate = segmentDistance(x, y, points[index - 1]!, points[index]!);
    if (candidate.distance < closest.distance) closest = candidate;
  }
  return closest;
}

function pointInside(points: readonly FlattenedPathPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const first = points[index]!;
    const second = points[previous]!;
    if ((first.y > y) !== (second.y > y)
      && x < (second.x - first.x) * (y - first.y) / (second.y - first.y) + first.x) {
      inside = !inside;
    }
  }
  return inside;
}

function sourceBounds(source: VectorRasterSource): { minX: number; minY: number; width: number; height: number } {
  return {
    minX: source.viewport.x,
    minY: source.viewport.y,
    width: source.viewport.width,
    height: source.viewport.height
  };
}

function vectorCoverage(source: VectorRasterSource, u: number, v: number, pixelScale: number): number {
  const bounds = sourceBounds(source);
  const x = bounds.minX + u * bounds.width;
  const y = bounds.minY + v * bounds.height;
  let coverage = 0;
  for (const path of source.paths) {
    const points = flattenVectorPath(path);
    if (path.fill !== null && pointInside(points, x, y)) coverage = 1;
    if (path.stroke !== null && path.strokeWidth > 0) {
      const distance = sampleVectorPath(points, x, y).distance;
      coverage = Math.max(coverage, clamp((path.strokeWidth * 0.5 + pixelScale - distance) / pixelScale));
    }
  }
  return coverage;
}

function coverageAt(buffer: CoverageBuffer, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return 0;
  return buffer.data[y * buffer.width + x]! / 255;
}

function rasterizeText(source: TextRasterSource, width: number, height: number, colorSpace: ColorSpace): PixelSurface {
  const data = new Uint8ClampedArray(width * height * 4);
  const fill = source.fillRgba;
  for (const glyph of source.glyphs) {
    const originX = Math.round(glyph.bounds.x + glyph.offsetX);
    const originY = Math.round(glyph.bounds.y + glyph.offsetY);
    for (let gy = 0; gy < glyph.coverage.height; gy += 1) {
      for (let gx = 0; gx < glyph.coverage.width; gx += 1) {
        const x = originX + gx;
        const y = originY + gy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const coverage = coverageAt(glyph.coverage, gx, gy) * (fill?.[3] ?? 1);
        const offset = (y * width + x) * 4;
        const existing = data[offset + 3]! / 255;
        const alpha = coverage + existing * (1 - coverage);
        if (fill === undefined) {
          const clusterTone = 0.2 + (glyph.cluster % 4) * 0.14;
          data[offset] = Math.round((0.55 + clusterTone * 0.35) * 255);
          data[offset + 1] = Math.round((0.78 - clusterTone * 0.2) * 255);
          data[offset + 2] = Math.round((0.95 - clusterTone * 0.12) * 255);
        } else if (alpha > 0) {
          data[offset] = Math.round(fill[0] * 255);
          data[offset + 1] = Math.round(fill[1] * 255);
          data[offset + 2] = Math.round(fill[2] * 255);
        }
        data[offset + 3] = Math.round(alpha * 255);
      }
    }
  }
  return { width, height, data, colorSpace, alphaMode: "straight" };
}

function rasterizeVector(source: VectorRasterSource, width: number, height: number, colorSpace: ColorSpace): PixelSurface {
  const data = new Uint8ClampedArray(width * height * 4);
  const pixelScale = Math.max(source.viewport.width / width, source.viewport.height / height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rawCoverage = vectorCoverage(
        source,
        (x + 0.5) / width,
        (y + 0.5) / height,
        pixelScale
      );
      const coverage = rawCoverage > 0 ? 0.15 + rawCoverage * 0.85 : 0;
      const offset = (y * width + x) * 4;
      data[offset] = coverage > 0 ? 64 : 0;
      data[offset + 1] = coverage > 0 ? 205 : 0;
      data[offset + 2] = coverage > 0 ? 250 : 0;
      data[offset + 3] = Math.round(coverage * 255);
    }
  }
  return { width, height, data, colorSpace, alphaMode: "straight" };
}

function rasterizeMedia(source: MediaRasterSource, width: number, height: number): PixelSurface {
  if (source.pixels.width !== width || source.pixels.height !== height) {
    throw new RangeError("P0 media fixture dimensions must match its target.");
  }
  return {
    width,
    height,
    data: new Uint8ClampedArray(source.pixels.data),
    colorSpace: source.pixels.colorSpace,
    alphaMode: source.pixels.alphaMode
  };
}

export function rasterizeLayerInput(input: LayerRasterizationInput): PixelSurface {
  assertLayerRasterizationInput(input);
  const { width, height, colorSpace } = input.target;
  if (input.source.kind === "text") return rasterizeText(input.source, width, height, colorSpace);
  if (input.source.kind === "shape" || input.source.kind === "svg") {
    return rasterizeVector(input.source, width, height, colorSpace);
  }
  if (input.source.kind === "image" || input.source.kind === "video") {
    return rasterizeMedia(input.source, width, height);
  }
  throw new TypeError("Unsupported raster source kind.");
}

export function makeEffectTimeSample(
  effectId: string,
  effectInstanceId: string,
  effectTime: number,
  duration = 1,
  projectStart = 0,
  fps = 30,
  deltaTime = 1 / fps
): EffectTimeSample {
  if (effectId.length === 0 || effectInstanceId.length === 0) {
    throw new TypeError("effectId and effectInstanceId must be explicit non-empty IDs.");
  }
  assertFinite(effectTime, "effectTime");
  assertFinite(duration, "duration");
  assertFinite(projectStart, "projectStart");
  assertFinite(deltaTime, "deltaTime");
  if (effectTime < 0 || duration < 0 || fps <= 0 || deltaTime < 0) {
    throw new RangeError("Effect time fixture values must be non-negative and FPS must be positive.");
  }
  const projectTime = projectStart + effectTime;
  return Object.freeze({
    contractVersion: TIME_CONTRACT_VERSION,
    effectId,
    effectInstanceId,
    active: effectTime < duration,
    projectTime,
    layerTime: effectTime,
    effectTime,
    progress: duration === 0 ? 1 : clamp(effectTime / duration),
    deltaTime,
    fps,
    frame: Math.floor(projectTime * fps)
  });
}

function layerTime(layerId: string, effectTime: EffectTimeSample): LayerTimeSample {
  return Object.freeze({
    contractVersion: TIME_CONTRACT_VERSION,
    layerId,
    active: effectTime.active,
    projectTime: effectTime.projectTime,
    localTime: effectTime.layerTime,
    sourceTime: effectTime.layerTime,
    deltaTime: effectTime.deltaTime
  });
}

function target(width: number, height: number, colorSpace: ColorSpace) {
  return Object.freeze({
    width,
    height,
    format: "rgba8" as const,
    colorSpace,
    samples: 1,
    usage: "input" as const
  });
}

function glyphCoverage(character: string, width = 8, height = 12): CoverageBuffer {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let distance = 99;
      const line = (active: boolean, edgeDistance: number) => {
        if (active) distance = Math.min(distance, edgeDistance);
      };
      if (character === "F") {
        line(x <= 1, Math.abs(x - 1));
        line(y <= 1, Math.abs(y - 1));
        line(y >= 5 && y <= 6 && x <= 6, Math.abs(y - 5.5));
      } else if (character === "X") {
        line(Math.abs(x / (width - 1) - y / (height - 1)) < 0.18, 0);
        line(Math.abs((1 - x / (width - 1)) - y / (height - 1)) < 0.18, 0);
      } else if (character === "中") {
        line((x <= 1 || x >= 6) && y >= 2 && y <= 9, 0);
        line((y <= 2 || y >= 9) && x >= 1 && x <= 6, 0);
        line(x >= 3 && x <= 4, 0);
      } else {
        line(y <= 1 && x >= 2 && x <= 5, 0);
        line(Math.abs(x - (3.5 - (y - 2) * 0.32)) < 1, 0);
        line(Math.abs(x - (3.5 + (y - 2) * 0.32)) < 1, 0);
      }
      const offset = y * width + x;
      data[offset] = distance === 0 ? 255 : distance <= 1 ? 128 : 0;
    }
  }
  return Object.freeze({ width, height, data, rowOrder: "top-to-bottom" as const });
}

function makeTextSource(width: number, height: number, alternate: boolean): TextRasterSource {
  const text = alternate ? "动效FX" : "FX中文";
  const glyphWidth = Math.max(8, Math.floor(width / 7));
  const glyphHeight = Math.max(12, Math.floor(height * 0.58));
  const startX = Math.max(1, Math.floor((width - text.length * (glyphWidth + 2)) / 2));
  const startY = Math.max(1, Math.floor((height - glyphHeight) / 2));
  const glyphs: RasterGlyph[] = [...text].map((character, index) => {
    const coverage = glyphCoverage(character, 8, 12);
    return Object.freeze({
      glyphId: character.codePointAt(0)!,
      cluster: index,
      advance: glyphWidth + 2,
      offsetX: 0,
      offsetY: 0,
      bounds: Object.freeze({
        x: startX + index * (glyphWidth + 2),
        y: startY,
        width: coverage.width,
        height: coverage.height
      }),
      coverage
    });
  });
  return Object.freeze({
    kind: "text",
    text,
    font: Object.freeze({
      fontId: "fixture.noto-sans-cjk",
      assetId: "font.noto-sans-cjk.fixture",
      assetHash: "sha256:36a8e2f0cjk-aa-coverage",
      family: "Noto Sans CJK",
      style: "normal",
      weight: 500,
      unitsPerEm: 1000,
      missingGlyphPolicy: "error" as const
    }),
    glyphs: Object.freeze(glyphs)
  });
}

function makeVectorSource(alternate: boolean): VectorRasterSource {
  const path = alternate
    ? parseSvgPathData("M0.08,0.72 C0.22,0.08 0.72,0.12 0.92,0.7 L0.55,0.9 Z", {
      fillRule: "evenodd", fill: "#41d6b3", stroke: "#ffffff", strokeWidth: 0.035
    })
    : parseSvgPathData("M0.08,0.66 C0.25,0.08 0.72,0.92 0.92,0.28 L0.82,0.84 L0.2,0.86 Z", {
      fillRule: "nonzero", fill: "#42c8ff", stroke: "#ffffff", strokeWidth: 0.03
    });
  return Object.freeze({
    kind: "svg",
    viewport: Object.freeze({ x: 0, y: 0, width: 1, height: 1 }),
    paths: Object.freeze([path])
  });
}

function makeMediaSource(
  width: number,
  height: number,
  colorSpace: ColorSpace,
  alternate: boolean
): MediaRasterSource {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const centerX = alternate ? 0.65 : 0.38;
      const centerY = alternate ? 0.42 : 0.55;
      const radial = Math.hypot(u - centerX, v - centerY);
      const rectangle = u > (alternate ? 0.1 : 0.5) && u < (alternate ? 0.42 : 0.88)
        && v > 0.15 && v < 0.78;
      const edge = clamp((0.42 - radial) * Math.min(width, height) * 0.35);
      const rawAlpha = Math.max(rectangle ? 0.72 : 0, edge);
      const alpha = rawAlpha > 0 ? 0.15 + rawAlpha * 0.85 : 0;
      const checker = (Math.floor(u * 7) + Math.floor(v * 5)) % 2;
      const offset = (y * width + x) * 4;
      data[offset] = alpha > 0
        ? Math.round((alternate ? 0.18 + v * 0.7 : 0.15 + u * 0.76) * 255) : 0;
      data[offset + 1] = alpha > 0 ? Math.round((checker ? 0.72 : 0.32) * 255) : 0;
      data[offset + 2] = alpha > 0
        ? Math.round((alternate ? 0.82 - u * 0.45 : 0.35 + v * 0.55) * 255) : 0;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }
  return Object.freeze({
    kind: "image",
    assetId: alternate ? "media.fixture.b" : "media.fixture.a",
    assetHash: alternate ? "sha256:rgba-b" : "sha256:rgba-a",
    frameTime: 0,
    pixels: Object.freeze({
      width,
      height,
      data,
      colorSpace,
      alphaMode: "straight" as const,
      rowOrder: "top-to-bottom" as const
    })
  });
}

export type RealInputKind = "text" | "vector" | "media";

export function makeRealInputFixture(
  effectId: string,
  kind: RealInputKind,
  width: number,
  height: number,
  alternate: boolean,
  colorSpace: ColorSpace,
  effectTime: EffectTimeSample
): { readonly input: LayerRasterizationInput; readonly surface: PixelSurface } {
  if (effectTime.effectId !== effectId) {
    throw new TypeError("Raster fixture effectId must match EffectTimeSample.effectId.");
  }
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError("Real input fixture dimensions must be positive integers.");
  }
  const source = kind === "text" ? makeTextSource(width, height, alternate)
    : kind === "vector" ? makeVectorSource(alternate)
      : makeMediaSource(width, height, colorSpace, alternate);
  const input: LayerRasterizationInput = Object.freeze({
    layerId: `fixture.${kind}.${alternate ? "b" : "a"}`,
    layerType: source.kind,
    source,
    time: layerTime(`fixture.${kind}`, effectTime),
    transform: IDENTITY_TRANSFORM,
    opacity: 1,
    masks: Object.freeze([]),
    target: target(width, height, colorSpace)
  });
  assertLayerRasterizationInput(input);
  return Object.freeze({ input, surface: rasterizeLayerInput(input) });
}

export function makeBrushCoverage(width = 17, height = 17): CoverageBuffer {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const distance = Math.hypot(
        (x + 0.5) / width - 0.5,
        (y + 0.5) / height - 0.5
      );
      data[y * width + x] = Math.round(clamp((0.5 - distance) * Math.min(width, height) * 0.45) * 255);
    }
  }
  return Object.freeze({ width, height, data, rowOrder: "top-to-bottom" as const });
}

export function makeMaskSurface(
  width: number,
  height: number,
  translated = 0,
  inverted = false,
  colorSpace: ColorSpace = "srgb"
): PixelSurface {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const coverage = clamp(((x + 0.5) / width - translated) * 4 - 0.5);
      const value = inverted ? 1 - coverage : coverage;
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = 255;
      data[offset + 3] = Math.round(value * 255);
    }
  }
  return { width, height, data, colorSpace, alphaMode: "straight" };
}
