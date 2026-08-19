import {
  TIME_CONTRACT_VERSION,
  type EffectTimeSample,
  type JsonObject,
  type RenderQuality
} from "@codemotion/core";
import { assertLayerRasterizationInput } from "@codemotion/renderer-api";
import { createEffectRandom } from "@codemotion/timeline";
import { GROUP_2_BLUEPRINTS } from "./blueprints.js";
import {
  flattenVectorPath,
  makeEffectTimeSample,
  makeRealInputFixture,
  parseSvgPathData,
  sampleVectorPath
} from "./inputs.js";
import type {
  EffectBlueprint,
  EffectRuntimeOptions,
  ParameterSpec,
  PixelSurface
} from "./types.js";

const blueprintById = new Map(GROUP_2_BLUEPRINTS.map((entry) => [entry.effectId, entry]));
const TAU = Math.PI * 2;

function elapsedSeconds(options: EffectRuntimeOptions): number {
  return options.time.effectTime;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function effectRandom(
  options: EffectRuntimeOptions,
  stream: string,
  sampleX = 0,
  sampleY = 0,
  samplesPerSecond = 1,
  seedOffset = 0,
  temporal = true
): number {
  const seed = (options.seed + Math.trunc(seedOffset)) >>> 0;
  const time = temporal ? options.time : {
    ...options.time,
    effectTime: 0,
    progress: 0,
    deltaTime: 0
  };
  return createEffectRandom(
    seed,
    time,
    `${stream}\u0000${sampleX}\u0000${sampleY}`,
    samplesPerSecond
  ).next();
}

function applyEasing(progress: number, easing: string): number {
  const value = clamp(progress);
  if (easing === "linear") return value;
  if (easing === "easeIn") return value ** 3;
  if (easing === "easeInOut") {
    return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
  }
  return 1 - (1 - value) ** 3;
}

function assertSurface(surface: PixelSurface): void {
  if (!Number.isInteger(surface.width) || surface.width < 1
    || !Number.isInteger(surface.height) || surface.height < 1) {
    throw new RangeError("Pixel surface dimensions must be positive integers.");
  }
  if (surface.data.length !== surface.width * surface.height * 4) {
    throw new RangeError("Pixel surface data length does not match its dimensions.");
  }
}

function cloneSurface(surface: PixelSurface): PixelSurface {
  return { ...surface, data: new Uint8ClampedArray(surface.data) };
}

function emptyLike(surface: PixelSurface): PixelSurface {
  return { ...surface, data: new Uint8ClampedArray(surface.data.length) };
}

type Rgba = [number, number, number, number];

type Rgb = [number, number, number];

const DISPLAY_P3_TO_LINEAR_SRGB = Object.freeze([
  1.224745, -0.224904, 0,
  -0.042058, 1.042081, 0,
  -0.019642, -0.078655, 1.098537
] as const);

const LINEAR_SRGB_TO_DISPLAY_P3 = Object.freeze([
  0.822593, 0.177534, 0,
  0.0332, 0.966784, 0,
  0.017085, 0.072396, 0.910302
] as const);

function matrixColor(matrix: readonly number[], color: readonly number[]): Rgb {
  return [
    matrix[0]! * color[0]! + matrix[1]! * color[1]! + matrix[2]! * color[2]!,
    matrix[3]! * color[0]! + matrix[4]! * color[1]! + matrix[5]! * color[2]!,
    matrix[6]! * color[0]! + matrix[7]! * color[1]! + matrix[8]! * color[2]!
  ];
}

function decodeTransfer(value: number, colorSpace: PixelSurface["colorSpace"]): number {
  if (colorSpace === "linear-srgb") return value;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encodeTransfer(value: number, colorSpace: PixelSurface["colorSpace"]): number {
  const bounded = clamp(value);
  if (colorSpace === "linear-srgb") return bounded;
  return bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - 0.055;
}

function decodeColor(color: Rgb, colorSpace: PixelSurface["colorSpace"]): Rgb {
  const decoded: Rgb = [
    decodeTransfer(color[0], colorSpace),
    decodeTransfer(color[1], colorSpace),
    decodeTransfer(color[2], colorSpace)
  ];
  return colorSpace === "display-p3"
    ? matrixColor(DISPLAY_P3_TO_LINEAR_SRGB, decoded)
    : decoded;
}

function encodeColor(color: Rgb, colorSpace: PixelSurface["colorSpace"]): Rgb {
  const primaries = colorSpace === "display-p3"
    ? matrixColor(LINEAR_SRGB_TO_DISPLAY_P3, color)
    : color;
  return [
    encodeTransfer(primaries[0], colorSpace),
    encodeTransfer(primaries[1], colorSpace),
    encodeTransfer(primaries[2], colorSpace)
  ];
}

function read(surface: PixelSurface, x: number, y: number): Rgba {
  const px = Math.min(surface.width - 1, Math.max(0, Math.round(x)));
  const py = Math.min(surface.height - 1, Math.max(0, Math.round(y)));
  const offset = (py * surface.width + px) * 4;
  const alpha = surface.alphaMode === "none" ? 1 : surface.data[offset + 3]! / 255;
  const divisor = surface.alphaMode === "premultiplied" && alpha > 0 ? alpha : 1;
  const linear = decodeColor([
    clamp(surface.data[offset]! / 255 / divisor),
    clamp(surface.data[offset + 1]! / 255 / divisor),
    clamp(surface.data[offset + 2]! / 255 / divisor)
  ], surface.colorSpace);
  return [linear[0], linear[1], linear[2], alpha];
}

function edgeCoordinate(value: number, size: number, mode: string): number {
  if (mode === "wrap") return ((value % size) + size) % size;
  if (mode === "mirror") {
    const period = Math.max(1, size * 2 - 2);
    const wrapped = ((value % period) + period) % period;
    return wrapped < size ? wrapped : period - wrapped;
  }
  return Math.min(size - 1, Math.max(0, value));
}

function readEdge(surface: PixelSurface, x: number, y: number, mode: string): Rgba {
  return read(
    surface,
    edgeCoordinate(x, surface.width, mode),
    edgeCoordinate(y, surface.height, mode)
  );
}

function write(surface: PixelSurface, x: number, y: number, rgba: Rgba): void {
  const offset = (y * surface.width + x) * 4;
  const alpha = surface.alphaMode === "none" ? 1 : clamp(rgba[3]);
  const alphaByte = Math.round(alpha * 255);
  const multiplier = surface.alphaMode === "premultiplied" ? alpha : 1;
  const visible = alphaByte > 0 ? multiplier : 0;
  const encoded = encodeColor([rgba[0], rgba[1], rgba[2]], surface.colorSpace);
  surface.data[offset] = Math.round(clamp(encoded[0]) * visible * 255);
  surface.data[offset + 1] = Math.round(clamp(encoded[1]) * visible * 255);
  surface.data[offset + 2] = Math.round(clamp(encoded[2]) * visible * 255);
  surface.data[offset + 3] = alphaByte;
}

export function convertPixelSurface(
  surface: PixelSurface,
  colorSpace: PixelSurface["colorSpace"],
  alphaMode: PixelSurface["alphaMode"] = surface.alphaMode
): PixelSurface {
  assertSurface(surface);
  const output: PixelSurface = {
    width: surface.width,
    height: surface.height,
    data: new Uint8ClampedArray(surface.data.length),
    colorSpace,
    alphaMode
  };
  for (let y = 0; y < surface.height; y += 1) {
    for (let x = 0; x < surface.width; x += 1) write(output, x, y, read(surface, x, y));
  }
  return output;
}

function mixColor(a: Rgba, b: Rgba, t: number): Rgba {
  const amount = clamp(t);
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
    a[3] + (b[3] - a[3]) * amount
  ];
}

function numberParam(params: Readonly<Record<string, unknown>>, name: string, fallback: number): number {
  const value = params[name];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringParam(params: Readonly<Record<string, unknown>>, name: string, fallback: string): string {
  const value = params[name];
  return typeof value === "string" ? value : fallback;
}

function booleanParam(params: Readonly<Record<string, unknown>>, name: string, fallback: boolean): boolean {
  const value = params[name];
  return typeof value === "boolean" ? value : fallback;
}

function vectorParam(
  params: Readonly<Record<string, unknown>>,
  name: string,
  fallback: readonly [number, number]
): readonly [number, number] {
  const value = params[name];
  if (Array.isArray(value) && value.length === 2
    && typeof value[0] === "number" && Number.isFinite(value[0])
    && typeof value[1] === "number" && Number.isFinite(value[1])) {
    return [value[0], value[1]];
  }
  return fallback;
}

function defaultParams(blueprint: EffectBlueprint): Record<string, unknown> {
  return Object.fromEntries(blueprint.parameters.map((spec) => [spec.name, spec.default]));
}

function assertEffectTimeSample(sample: EffectTimeSample, effectId: string): void {
  if (sample.contractVersion !== TIME_CONTRACT_VERSION) {
    throw new TypeError(`${effectId} requires EffectTimeSample ${TIME_CONTRACT_VERSION}.`);
  }
  if (sample.effectId !== effectId) {
    throw new TypeError(`EffectTimeSample.effectId must equal ${effectId}.`);
  }
  if (typeof sample.effectInstanceId !== "string" || sample.effectInstanceId.length === 0) {
    throw new TypeError("EffectTimeSample.effectInstanceId must be an explicit non-empty ID.");
  }
  const values = [
    sample.projectTime,
    sample.layerTime,
    sample.effectTime,
    sample.progress,
    sample.deltaTime,
    sample.fps,
    sample.frame
  ];
  if (!values.every(Number.isFinite)) throw new RangeError("EffectTimeSample values must be finite.");
  if (sample.effectTime < 0 || sample.deltaTime < 0 || sample.fps <= 0
    || sample.progress < 0 || sample.progress > 1 || !Number.isInteger(sample.frame)) {
    throw new RangeError("EffectTimeSample contains an invalid local time, progress, FPS, or frame.");
  }
}

function effectProgress(
  blueprint: EffectBlueprint,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): number {
  const progressSpec = blueprint.parameters.find((spec) => spec.name === "progress");
  if (progressSpec?.kind !== "number") return options.time.progress;
  const parameter = numberParam(params, "progress", progressSpec.default);
  if (blueprint.sourceId === "C02" || blueprint.sourceId === "C04") {
    return clamp(options.time.progress * parameter);
  }
  return clamp(options.time.progress + parameter - progressSpec.default);
}

function assertRuntimeInput(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  options: EffectRuntimeOptions,
  params: Readonly<Record<string, unknown>>
): void {
  assertEffectTimeSample(options.time, blueprint.effectId);
  assertLayerRasterizationInput(options.rasterInput);
  const target = options.rasterInput.target;
  if (target.width !== source.width || target.height !== source.height
    || target.colorSpace !== source.colorSpace) {
    throw new TypeError("Raster input target must match the supplied pixel surface.");
  }
  const kind = options.rasterInput.source.kind;
  if (blueprint.category === "text" && kind !== "text") {
    throw new TypeError(`${blueprint.effectId} requires real text glyph coverage.`);
  }
  if ((blueprint.category === "vector" || blueprint.category === "draw")
    && !(blueprint.sourceId === "D01" && kind === "text")
    && blueprint.sourceId !== "D02"
    && kind !== "shape" && kind !== "svg") {
    throw new TypeError(`${blueprint.effectId} requires a real Shape/SVG path source.`);
  }
  const textNeonTarget = blueprint.effectId === "fx.light.neonGlow" && kind === "text";
  if ((blueprint.category === "light" || blueprint.category === "post") && !textNeonTarget
    && kind !== "image" && kind !== "video") {
    throw new TypeError(`${blueprint.effectId} requires decoded RGBA image/video input.`);
  }
  if (blueprint.category === "transition" || blueprint.category === "composite"
    || blueprint.sourceId === "D02") {
    if (!options.secondary || !options.secondaryRasterInput) {
      throw new TypeError(`${blueprint.effectId} requires independent source and secondary inputs.`);
    }
    assertLayerRasterizationInput(options.secondaryRasterInput);
    if (options.secondaryRasterInput.layerId === options.rasterInput.layerId) {
      throw new TypeError("Dual inputs must have independent layer identities.");
    }
    if (options.secondaryRasterInput.target.width !== target.width
      || options.secondaryRasterInput.target.height !== target.height
      || options.secondaryRasterInput.target.colorSpace !== target.colorSpace) {
      throw new TypeError("Dual raster inputs must share dimensions and color space.");
    }
  }
  if (blueprint.sourceId === "D02") {
    if (kind !== "image" && kind !== "video") {
      throw new TypeError("Brush Reveal requires a decoded starting image.");
    }
    const secondaryKind = options.secondaryRasterInput!.source.kind;
    if (secondaryKind !== "image" && secondaryKind !== "video") {
      throw new TypeError("Brush Reveal requires a decoded target image.");
    }
    const brush = options.brushCoverage;
    if (!brush || brush.width < 1 || brush.height < 1
      || brush.data.length !== brush.width * brush.height) {
      throw new TypeError("Brush Reveal requires real brush coverage.");
    }
    const requested = stringParam(params, "brushTexture", "");
    if (requested !== options.brushAssetId) {
      throw new TypeError(`Unresolved brushTexture ${requested}.`);
    }
  }
}

export function normalizeEffectParams(
  effectId: string,
  supplied: Readonly<Record<string, unknown>> = {}
): JsonObject {
  const blueprint = blueprintById.get(effectId);
  if (!blueprint) throw new RangeError(`Unknown Group 2 P0 effect: ${effectId}`);
  const output: JsonObject = {};
  for (const spec of blueprint.parameters) {
    const value = supplied[spec.name];
    if (spec.kind === "number") {
      const numeric = typeof value === "number" && Number.isFinite(value) ? value : spec.default;
      output[spec.name] = clamp(numeric, spec.min, spec.max);
    } else if (spec.kind === "enum") {
      output[spec.name] = typeof value === "string" && spec.options.includes(value) ? value : spec.default;
    } else if (spec.kind === "text") {
      const textual = typeof value === "string" ? value : spec.default;
      output[spec.name] = textual.slice(0, spec.maxLength);
    } else if (spec.kind === "boolean") {
      output[spec.name] = typeof value === "boolean" ? value : spec.default;
    } else {
      const vectorValue = vectorParam(supplied, spec.name, spec.default);
      output[spec.name] = [
        clamp(vectorValue[0], spec.min, spec.max),
        clamp(vectorValue[1], spec.min, spec.max)
      ];
    }
  }
  return output;
}

function eased(progress: number): number {
  return 1 - (1 - clamp(progress)) ** 3;
}

function transformedSample(
  source: PixelSurface,
  u: number,
  v: number,
  transform: (u: number, v: number) => readonly [number, number]
): Rgba {
  const [su, sv] = transform(u, v);
  if (su < 0 || su > 1 || sv < 0 || sv > 1) return [0, 0, 0, 0];
  return read(source, su * (source.width - 1), sv * (source.height - 1));
}

function renderMotion(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const output = emptyLike(source);
  const p = eased(effectProgress(blueprint, params, options));
  const seconds = elapsedSeconds(options);
  const shakeOffset = blueprint.sourceId === "M08" ? (() => {
    const intensity = numberParam(params, "intensity", 0.04);
    const frequency = numberParam(params, "frequency", 12);
    const decay = numberParam(params, "decay", 2.5);
    const attenuation = Math.exp(-decay * seconds);
    const seedOffset = numberParam(params, "seedOffset", 0);
    return [
      (effectRandom(options, "M08.x", 0, 0, Math.max(0.01, frequency), seedOffset) * 2 - 1)
        * intensity * attenuation,
      (effectRandom(options, "M08.y", 0, 0, Math.max(0.01, frequency), seedOffset) * 2 - 1)
        * intensity * attenuation
    ] as const;
  })() : undefined;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      let rgba: Rgba;
      if (blueprint.sourceId === "M01") {
        rgba = read(source, x, y);
        const duration = Math.max(0.01, numberParam(params, "duration", 1));
        const fadeProgress = applyEasing(
          seconds / duration,
          stringParam(params, "easing", "easeOut")
        );
        const alpha = numberParam(params, "from", 0)
          + (numberParam(params, "to", 1) - numberParam(params, "from", 0)) * fadeProgress;
        rgba[3] *= clamp(alpha);
      } else if (blueprint.sourceId === "M02") {
        const direction = stringParam(params, "direction", "left");
        const distance = numberParam(params, "distance", 0.35) * (1 - p);
        const overshoot = numberParam(params, "overshoot", 0.08) * Math.sin(p * Math.PI);
        const custom = vectorParam(params, "vector", [1, 0]);
        const dx = direction === "left" ? -distance + overshoot
          : direction === "right" ? distance - overshoot : 0;
        const dy = direction === "up" ? -distance + overshoot
          : direction === "down" ? distance - overshoot : 0;
        const defaultVector = custom[0] === 1 && custom[1] === 0;
        const customAmount = defaultVector ? 0 : distance * 0.25;
        rgba = transformedSample(source, u, v, (su, sv) => [
          su - dx - custom[0] * customAmount,
          sv - dy - custom[1] * customAmount
        ]);
      } else if (blueprint.sourceId === "M03") {
        const start = numberParam(params, "startScale", 0.2);
        const end = numberParam(params, "endScale", 1);
        const spring = numberParam(params, "spring", 0.65);
        const scale = Math.max(0.001, start + (end - start) * p
          + Math.sin(p * Math.PI * 3) * spring * (1 - p) * 0.18);
        const pivot = vectorParam(params, "pivot", [0.5, 0.5]);
        rgba = transformedSample(source, u, v, (su, sv) => [
          pivot[0] + (su - pivot[0]) / scale,
          pivot[1] + (sv - pivot[1]) / scale
        ]);
      } else if (blueprint.sourceId === "M04") {
        const pivot = vectorParam(params, "pivot", [0.5, 0.5]);
        const angle = (numberParam(params, "angle", -90)
          + numberParam(params, "turns", 0) * 360) * (1 - p) * Math.PI / 180;
        const cosine = Math.cos(angle);
        const sine = Math.sin(angle);
        rgba = transformedSample(source, u, v, (su, sv) => {
          const dx = su - pivot[0];
          const dy = sv - pivot[1];
          return [pivot[0] + dx * cosine - dy * sine, pivot[1] + dx * sine + dy * cosine];
        });
        const blur = numberParam(params, "blur", 0.08) * (1 - p);
        if (blur > 0) {
          const blurred = transformedSample(source, u + blur * 0.15, v, (su, sv) => {
            const dx = su - pivot[0];
            const dy = sv - pivot[1];
            return [pivot[0] + dx * cosine - dy * sine, pivot[1] + dx * sine + dy * cosine];
          });
          rgba = mixColor(rgba, blurred, clamp(blur));
        }
      } else if (blueprint.sourceId === "M05") {
        const bounceCount = Math.max(1, Math.round(numberParam(params, "bounces", 3)));
        const height = numberParam(params, "height", 0.25);
        const gravity = numberParam(params, "gravity", 9.8);
        const damping = numberParam(params, "damping", 0.55);
        const flightSeconds = 2 * Math.sqrt(2 * Math.max(0.001, height) / gravity);
        const bounceIndex = Math.floor(seconds / flightSeconds);
        const localTime = (seconds % flightSeconds) / flightSeconds;
        const offset = bounceIndex < bounceCount
          ? Math.sin(localTime * Math.PI) * height * damping ** bounceIndex
          : 0;
        const contact = bounceIndex < bounceCount
          ? (1 - Math.sin(localTime * Math.PI)) ** 5 * damping ** bounceIndex : 0;
        const squash = numberParam(params, "squash", 0.22) * contact;
        const scaleX = 1 + squash * 0.72;
        const scaleY = Math.max(0.35, 1 - squash);
        rgba = transformedSample(source, u, v, (su, sv) => [
          0.5 + (su - 0.5) / scaleX,
          1 + (sv + offset - 1) / scaleY
        ]);
      } else if (blueprint.sourceId === "M06") {
        const amplitude = numberParam(params, "amplitude", 0.16);
        const decay = numberParam(params, "decay", 5);
        const period = Math.max(0.02, numberParam(params, "period", 0.28));
        const displacement = amplitude * Math.sin(seconds * TAU / period)
          * Math.exp(-decay * seconds);
        const axis = stringParam(params, "axis", "x");
        const scale = axis === "scale" ? Math.max(0.05, 1 + displacement) : 1;
        rgba = transformedSample(source, u, v, (su, sv) => axis === "x"
          ? [su - displacement, sv]
          : axis === "y"
            ? [su, sv - displacement]
            : [0.5 + (su - 0.5) / scale, 0.5 + (sv - 0.5) / scale]);
      } else if (blueprint.sourceId === "M07") {
        const range = numberParam(params, "range", 0.04);
        const frequency = numberParam(params, "frequency", 1);
        const phase = numberParam(params, "phase", 0);
        const angle = seconds * TAU * frequency + phase;
        const horizontal = Math.sin(angle) * range;
        const vertical = Math.cos(angle) * range;
        const axis = stringParam(params, "axis", "y");
        const diagonal = range === 0 ? 0 : horizontal / Math.SQRT2;
        rgba = transformedSample(source, u, v, (su, sv) => [
          su - (axis === "x" || axis === "both" ? horizontal
            : axis === "diagonal_down" || axis === "diagonal_up" ? diagonal : 0),
          sv - (axis === "y" ? horizontal : axis === "both" ? vertical
            : axis === "diagonal_down" ? diagonal : axis === "diagonal_up" ? -diagonal : 0)
        ]);
      } else {
        rgba = transformedSample(
          source,
          u,
          v,
          (su, sv) => [su - shakeOffset![0], sv - shakeOffset![1]]
        );
      }
      write(output, x, y, rgba);
    }
  }
  return output;
}

function glyphCell(
  options: EffectRuntimeOptions,
  x: number,
  y: number
): { index: number; localX: number; localY: number } {
  const raster = options.rasterInput.source;
  if (raster.kind !== "text") throw new TypeError("Text effect requires text raster provenance.");
  if (raster.font.fontId === "codemotion.server-derived-grid-v1") {
    const columns = Math.max(1, Math.min(12, options.rasterInput.target.width));
    const rows = Math.max(1, Math.ceil(raster.glyphs.length / columns));
    const column = Math.min(columns - 1, Math.floor(x / options.rasterInput.target.width * columns));
    const row = Math.min(rows - 1, Math.floor(y / options.rasterInput.target.height * rows));
    const localX = x / options.rasterInput.target.width * columns - column;
    const localY = y / options.rasterInput.target.height * rows - row;
    return { index: row * columns + column, localX, localY };
  }
  for (const glyph of raster.glyphs) {
    const left = glyph.bounds.x + glyph.offsetX;
    const top = glyph.bounds.y + glyph.offsetY;
    if (x >= left && y >= top && x < left + glyph.bounds.width && y < top + glyph.bounds.height) {
      return {
        index: glyph.cluster,
        localX: clamp((x - left) / Math.max(1, glyph.bounds.width)),
        localY: clamp((y - top) / Math.max(1, glyph.bounds.height))
      };
    }
  }
  return { index: raster.glyphs.length, localX: 0, localY: 0 };
}

function numericMap(value: string, name: string): readonly number[] {
  const entries = value.split(",").map((entry) => Number(entry.trim()));
  if (entries.length === 0 || entries.some((entry) => !Number.isFinite(entry))) {
    throw new TypeError(`${name} must be a comma-separated finite-number map.`);
  }
  return entries;
}

function sampledMap(values: readonly number[], progress: number): number {
  if (values.length === 1) return values[0]!;
  const position = clamp(progress) * (values.length - 1);
  const first = Math.floor(position);
  const second = Math.min(values.length - 1, first + 1);
  const fraction = position - first;
  return values[first]! + (values[second]! - values[first]!) * fraction;
}

function renderText(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const output = emptyLike(source);
  const p = effectProgress(blueprint, params, options);
  const seconds = elapsedSeconds(options);
  const beatMap = blueprint.sourceId === "T03"
    ? numericMap(stringParam(params, "beatMap", "0,0.5,1"), "beatMap")
    : undefined;
  const scaleMap = blueprint.sourceId === "T03"
    ? numericMap(stringParam(params, "scaleMap", "0.8,1.2,1"), "scaleMap")
    : undefined;
  const textPath = blueprint.sourceId === "T04"
    ? flattenVectorPath(parseSvgPathData(stringParam(params, "path", "")))
    : undefined;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      const cell = glyphCell(options, x, y);
      let sample = read(source, x, y);
      let visibility = 1;
      if (blueprint.sourceId === "T01") {
        const speed = numberParam(params, "speed", 12);
        const wordMode = booleanParam(params, "wordMode", false);
        const revealIndex = wordMode ? Math.floor(cell.index / 5) * 5 : cell.index;
        const revealedGlyphs = seconds * speed;
        visibility = revealIndex + 1 <= revealedGlyphs ? 1 : 0;
        const cursorWidth = numberParam(params, "cursorWidth", 0.08);
        const rasterCursorWidth = Math.max(cursorWidth, 12 / source.width);
        if (booleanParam(params, "cursor", true)
          && Math.abs(revealIndex - revealedGlyphs) < 1
          && cell.localX > 1 - rasterCursorWidth) {
          sample = [1, 1, 1, sample[3]];
          visibility = 1;
        }
      } else if (blueprint.sourceId === "T02") {
        const stagger = numberParam(params, "stagger", 0.04);
        const selector = stringParam(params, "selector", "character");
        const groupSize = selector === "word" ? 5 : selector === "line" ? 12 : selector === "paragraph" ? 60 : 1;
        const selectedIndex = Math.floor(cell.index / groupSize) * groupSize;
        const threshold = clamp((seconds - selectedIndex * stagger) / 0.25);
        const offset = (1 - threshold) * numberParam(params, "offset", 0.25);
        const axis = stringParam(params, "axis", "y");
        sample = transformedSample(source, u, v, (su, sv) =>
          axis === "x" ? [su - offset, sv] : [su, sv - offset]);
        visibility = threshold;
      } else if (blueprint.sourceId === "T03") {
        const strength = numberParam(params, "strength", 0.35);
        const layout = stringParam(params, "layoutMode", "grid");
        const beat = sampledMap(beatMap!, p);
        const scaleValue = sampledMap(scaleMap!, p);
        const layoutPhase = layout === "radial"
          ? Math.atan2(v - 0.5, u - 0.5) : layout === "stack" ? v * 8 : cell.index % 7;
        const pulse = Math.max(0.05, scaleValue + Math.sin(layoutPhase + p * TAU * (1 + Math.abs(beat) * 3))
          * strength * (0.15 + Math.abs(scaleValue) * 0.25));
        sample = transformedSample(source, u, v, (su, sv) => {
          const centerU = u - (cell.localX - 0.5) * 0.08;
          const centerV = v - (cell.localY - 0.5) * 0.16;
          const radialOffset = layout === "radial" ? (pulse - 1) * 0.04 : 0;
          const scaleMapOffset = (scaleValue - 1) * strength * 0.18;
          return [
            centerU + (su - centerU) / pulse
              + (su - 0.5) * (radialOffset + scaleMapOffset),
            centerV + (sv - centerV) / pulse
              + (sv - 0.5) * (radialOffset + scaleMapOffset)
          ];
        });
      } else if (blueprint.sourceId === "T04") {
        const orientation = stringParam(params, "orientation", "tangent");
        const pathSample = sampleVectorPath(textPath!, u, v);
        const pathProgress = orientation === "upright"
          ? clamp(pathSample.progress * 0.75 + v * 0.25)
          : pathSample.progress;
        const feather = numberParam(params, "feather", 0.04);
        visibility = (1 - smoothstep(p - feather, p + feather, pathProgress))
          * smoothstep(0.16, 0.01, pathSample.distance);
      } else if (blueprint.sourceId === "T05") {
        const sourceText = [...stringParam(params, "sourceText", "CODE")];
        const targetText = [...stringParam(params, "targetText", "MOTION")];
        if (sourceText.length === 0 || targetText.length === 0) {
          throw new TypeError("Text Morph requires non-empty sourceText and targetText.");
        }
        const sourceValue = sourceText[cell.index % sourceText.length]!.codePointAt(0)! / 0x10ffff;
        const targetValue = targetText[cell.index % targetText.length]!.codePointAt(0)! / 0x10ffff;
        const matchMode = stringParam(params, "matchMode", "glyph");
        const matchScale = matchMode === "outline" ? 1.8 : matchMode === "position" ? 0.65 : 1;
        const wobble = Math.sin(cell.index * (1.2 + sourceValue * 4)
          + p * Math.PI * (1 + targetValue * 4)) * 0.025 * matchScale * Math.sin(p * Math.PI);
        sample = transformedSample(source, u, v, (su, sv) => [su + wobble, sv - wobble]);
        sample[0] = clamp(sample[0] + p * (0.06 + targetValue * 0.12));
        sample[2] = clamp(sample[2] + (1 - p) * (0.06 + sourceValue * 0.12));
      } else if (blueprint.sourceId === "T06") {
        const direction = stringParam(params, "lockDirection", "left-to-right");
        const charset = [...stringParam(params, "charset", "")];
        if (charset.length === 0) throw new TypeError("Scramble Decode requires a non-empty charset.");
        const speed = numberParam(params, "speed", 24);
        const decodeProgress = clamp(p * (0.5 + speed / 48));
        const threshold = direction === "right-to-left" ? 1 - u
          : direction === "random"
            ? effectRandom(options, "T06.lock", cell.index, 0, 1, 0, false)
            : u;
        if (threshold > decodeProgress) {
          const noise = effectRandom(options, "T06.scramble", cell.index, 0, Math.max(0.1, speed));
          const character = charset[Math.min(charset.length - 1, Math.floor(noise * charset.length))]!;
          const codeTone = character.codePointAt(0)! / 0x10ffff;
          sample = [noise, 1 - noise * 0.5, 0.65 + codeTone * 0.35, sample[3] * 0.8];
        }
      } else {
        const force = numberParam(params, "force", 0.45) * p;
        const selector = stringParam(params, "selector", "word");
        const selectedIndex = selector === "word" ? Math.floor(cell.index / 5) * 5 : cell.index;
        const rotation = numberParam(params, "rotation", 35) * Math.PI / 180;
        const angle = effectRandom(options, "T07.word", selectedIndex, 3, 1, 0, false)
          * TAU + rotation * p;
        const dx = Math.cos(angle) * force * p;
        const dy = Math.sin(angle) * force * p;
        const cosine = Math.cos(rotation * p);
        const sine = Math.sin(rotation * p);
        sample = transformedSample(source, u, v, (su, sv) => {
          const localU = su - 0.5 - dx;
          const localV = sv - 0.5 - dy;
          return [0.5 + localU * cosine - localV * sine, 0.5 + localU * sine + localV * cosine];
        });
        visibility = 1 - p * numberParam(params, "depth", 0.3);
      }
      sample[3] *= clamp(visibility);
      write(output, x, y, sample);
    }
  }
  return output;
}

interface VectorRuntimeGeometry {
  readonly source: readonly ReturnType<typeof flattenVectorPath>[];
  readonly from?: ReturnType<typeof flattenVectorPath>;
  readonly to?: ReturnType<typeof flattenVectorPath>;
  readonly morphed?: ReturnType<typeof flattenVectorPath>;
  readonly draw?: ReturnType<typeof flattenVectorPath>;
}

function interpolatePaths(
  from: ReturnType<typeof flattenVectorPath>,
  to: ReturnType<typeof flattenVectorPath>,
  progress: number,
  maxPoints: number
): ReturnType<typeof flattenVectorPath> {
  const count = Math.min(maxPoints, Math.max(from.length, to.length));
  const points = Array.from({ length: count }, (_, index) => {
    const fromPoint = from[Math.round(index * (from.length - 1) / Math.max(1, count - 1))]!;
    const toPoint = to[Math.round(index * (to.length - 1) / Math.max(1, count - 1))]!;
    return Object.freeze({
      x: fromPoint.x + (toPoint.x - fromPoint.x) * progress,
      y: fromPoint.y + (toPoint.y - fromPoint.y) * progress,
      progress: index / Math.max(1, count - 1)
    });
  });
  return Object.freeze(points);
}

function resamplePath(
  path: ReturnType<typeof flattenVectorPath>,
  maxPoints: number
): ReturnType<typeof flattenVectorPath> {
  if (path.length <= maxPoints) return path;
  return Object.freeze(Array.from({ length: maxPoints }, (_, index) =>
    path[Math.round(index * (path.length - 1) / Math.max(1, maxPoints - 1))]!
  ));
}

function coverageForVector(
  sourceId: EffectBlueprint["sourceId"],
  u: number,
  v: number,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions,
  geometry: VectorRuntimeGeometry
): number {
  const blueprint = blueprintById.get(options.time.effectId)!;
  const p = effectProgress(blueprint, params, options);
  const inputPath = geometry.source[0]!;
  const inputSample = sampleVectorPath(inputPath, u, v);
  if (sourceId === "V01") {
    const offset = numberParam(params, "offset", 0);
    const start = numberParam(params, "start", 0);
    const end = numberParam(params, "end", 0.75) * p;
    const strokeWidth = numberParam(params, "strokeWidth", 0.03);
    const pathProgress = fract(inputSample.progress + offset + 1);
    return smoothstep(strokeWidth, 0, inputSample.distance)
      * (pathProgress >= start && pathProgress <= end ? 1 : 0);
  }
  if (sourceId === "V02") {
    const normalize = booleanParam(params, "normalize", true);
    const aspectU = normalize ? u : u * options.rasterInput.target.width
      / Math.max(1, options.rasterInput.target.height);
    return smoothstep(0.04, 0.004, sampleVectorPath(geometry.morphed!, aspectU, v).distance);
  }
  if (sourceId === "V03") {
    const count = Math.max(1, Math.round(numberParam(params, "count", 8)));
    const offset = vectorParam(params, "offset", [0.08, 0.04]);
    const rotation = numberParam(params, "rotation", 12) * Math.PI / 180;
    const scale = Math.max(0.01, numberParam(params, "scale", 0.92));
    const angle = rotation * Math.floor(fract((u + v) * count) * count);
    const shiftedU = fract((u - offset[0]) * count) / Math.max(0.01, scale);
    const shiftedV = fract((v - offset[1]) * count) / Math.max(0.01, scale);
    const du = shiftedU - 0.5;
    const dv = shiftedV - 0.5;
    const sample = sampleVectorPath(inputPath,
      0.5 + du * Math.cos(angle) - dv * Math.sin(angle),
      0.5 + du * Math.sin(angle) + dv * Math.cos(angle));
    return smoothstep(0.06 / scale, 0.005, sample.distance);
  }
  if (sourceId === "V04") {
    const count = Math.max(2, Math.round(numberParam(params, "count", 24)));
    const rotation = numberParam(params, "angle", 0) / 360;
    const angle = fract((Math.atan2(v - 0.5, u - 0.5) / TAU + rotation) * count);
    const radius = Math.hypot(u - 0.5, v - 0.5);
    const revealedRadius = numberParam(params, "radius", 0.42) * p;
    const thickness = numberParam(params, "thickness", 0.012);
    const outlineInfluence = smoothstep(0.12, 0.005, inputSample.distance);
    return radius < revealedRadius
      ? smoothstep(Math.min(0.48, thickness * count), 0.002, Math.min(angle, 1 - angle))
        * (0.55 + outlineInfluence * 0.45)
      : 0;
  }
  if (sourceId === "D01") {
    const pressure = numberParam(params, "pressure", 0.7);
    const variation = numberParam(params, "speedVariation", 0.25);
    const pathSample = sampleVectorPath(geometry.draw!, u, v);
    const speedWarp = Math.sin(pathSample.progress * 19) * variation * 0.12;
    const revealed = pathSample.progress <= clamp(p + (variation - 0.25) * 0.3 + speedWarp) ? 1 : 0;
    return revealed * smoothstep(0.02 + pressure * 0.07, 0.002, pathSample.distance);
  }
  if (sourceId === "D02") {
    const brushReference = stringParam(params, "brushTexture", "");
    if (!/^(?:builtin|asset):\/\//u.test(brushReference)) {
      throw new TypeError("brushTexture must resolve to a builtin:// or asset:// coverage asset.");
    }
    const size = numberParam(params, "size", 0.12);
    const brush = options.brushCoverage!;
    const bx = Math.min(brush.width - 1, Math.floor(fract(u / Math.max(0.005, size)) * brush.width));
    const by = Math.min(brush.height - 1, Math.floor(fract(v / Math.max(0.005, size)) * brush.height));
    const brushAlpha = brush.data[by * brush.width + bx]! / 255;
    const noise = effectRandom(options, "D02.roughness", bx, by, 1, 0, false);
    return brushAlpha * smoothstep(
      p + size,
      p - size,
      u + (noise - 0.5) * numberParam(params, "roughness", 0.35)
    );
  }
  if (sourceId === "D03") {
    const distance = Math.min(Math.hypot(u - 0.5, v - 0.5), inputSample.distance * 1.8);
    const noise = (effectRandom(
      options,
      "D03.diffusion",
      Math.floor(u * 32),
      Math.floor(v * 32),
      1,
      0,
      false
    ) - 0.5)
      * numberParam(params, "edgeNoise", 0.2);
    const diffusion = numberParam(params, "diffusion", 0.55);
    const absorption = numberParam(params, "absorption", 0.65);
    const radius = p * (0.35 + diffusion * 0.75);
    return smoothstep(radius + noise, radius - (0.02 + absorption * 0.14), distance)
      * (0.55 + absorption * 0.45);
  }
  const grain = numberParam(params, "grain", 0.55);
  const strokeWidth = numberParam(params, "strokeWidth", 0.025);
  const fineGrain = effectRandom(options, "D04.grain-fine",
    Math.floor(u * 220), Math.floor(v * 220), 1, 0, false);
  const coarseGrain = effectRandom(options, "D04.grain-coarse",
    Math.floor(u * 58), Math.floor(v * 58), 1, 11, false);
  const stroke = smoothstep(strokeWidth * 1.9, strokeWidth * 0.18, inputSample.distance);
  const scatter = numberParam(params, "scatter", 0.18);
  const opacity = numberParam(params, "opacity", 0.85);
  const scattered = effectRandom(
    options,
    "D04.scatter",
    Math.floor(u * 37),
    Math.floor(v * 53),
    1,
    17,
    false
  );
  const dustEnvelope = Math.max(0,
    smoothstep(strokeWidth * (4 + scatter * 8), strokeWidth * 1.4, inputSample.distance) - stroke);
  const pigment = fineGrain > grain * 0.62
    ? 1 : fineGrain > grain * 0.3 ? 0.5 : 0.12;
  const chalkBody = stroke * pigment * (0.72 + coarseGrain * 0.28);
  const dust = dustEnvelope * (scattered > 1 - scatter * 0.72 ? 0.7 : 0.06);
  return u <= p + (scattered - 0.5) * scatter * 0.18
    ? clamp(chalkBody + dust) * opacity : 0;
}

function renderVectorOrDraw(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const output = emptyLike(source);
  const isDraw = blueprint.category === "draw";
  const raster = options.rasterInput.source;
  if (blueprint.sourceId === "D02") {
    const target = options.secondary!;
    const brush = options.brushCoverage!;
    const progress = effectProgress(blueprint, params, options);
    const size = numberParam(params, "size", 0.12);
    const roughness = numberParam(params, "roughness", 0.35);
    const bands = Math.max(3, Math.min(18, Math.round(0.95 / Math.max(0.06, size))));
    const overlap = 2.2;
    const settle = smoothstep(0.88, 1, progress);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const u = source.width === 1 ? 0.5 : x / (source.width - 1);
        const v = source.height === 1 ? 0.5 : y / (source.height - 1);
        const band = Math.min(bands - 1, Math.floor(v * bands));
        const localV = fract(v * bands);
        const travel = band % 2 === 0 ? u : 1 - u;
        const bandProgress = clamp(progress * (bands + overlap) - band);
        const bristleJitter = (effectRandom(options, "D02.bristles",
          Math.floor(x / 3), band * 97 + Math.floor(localV * 31), 1, 0, false) - 0.5)
          * roughness * 0.2;
        const bristleWave = Math.sin(localV * Math.PI * (18 + roughness * 34)
          + band * 1.73) * size * (0.025 + roughness * 0.09);
        const frontier = bandProgress * (1 + size * 1.5) - size * 0.75
          + bristleJitter + bristleWave;
        const painted = smoothstep(frontier + size * (0.12 + roughness * 0.18),
          frontier - size * 0.38, travel);
        const bx = Math.min(brush.width - 1,
          Math.floor(fract(u / Math.max(0.025, size)) * brush.width));
        const by = Math.min(brush.height - 1, Math.floor(localV * brush.height));
        const brushAlpha = brush.data[by * brush.width + bx]! / 255;
        const fiber = 0.08 + brushAlpha * 0.76
          + (0.5 + 0.5 * Math.sin(localV * Math.PI * 46 + bx * 0.37)) * 0.16;
        const textured = painted * clamp(fiber);
        const filledBehind = smoothstep(frontier - size * 0.32, frontier - size * 1.65, travel)
          * (0.92 + brushAlpha * 0.08);
        const brushed = Math.max(textured, filledBehind);
        const coverage = brushed + (1 - brushed) * settle;
        write(output, x, y, mixColor(read(source, x, y), read(target, x, y), coverage));
      }
    }
    return output;
  }
  if (blueprint.sourceId === "D01" && raster.kind === "text") {
    const progress = effectProgress(blueprint, params, options);
    const pressure = numberParam(params, "pressure", 0.7);
    const variation = numberParam(params, "speedVariation", 0.25);
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const sourceColor = read(source, x, y);
        const u = source.width === 1 ? 0.5 : x / (source.width - 1);
        const brush = effectRandom(options, "D01.text-brush", Math.floor(x / 3), Math.floor(y / 3), 1, 0, false);
        const frontier = progress + (brush - 0.5) * (0.025 + pressure * 0.035)
          + Math.sin((u + y / Math.max(1, source.height)) * 21) * variation * 0.015;
        const reveal = smoothstep(frontier + 0.035, frontier - 0.01, u);
        write(output, x, y, [sourceColor[0], sourceColor[1], sourceColor[2], sourceColor[3] * reveal]);
      }
    }
    return output;
  }
  if (blueprint.sourceId === "D03") {
    const progress = effectProgress(blueprint, params, options);
    const diffusion = numberParam(params, "diffusion", 0.55);
    const absorption = numberParam(params, "absorption", 0.65);
    const edgeNoise = numberParam(params, "edgeNoise", 0.2);
    const seeds = [[0.5, 0.5], [0.31, 0.43], [0.68, 0.58], [0.44, 0.7], [0.61, 0.32]] as const;
    for (let y = 0; y < source.height; y += 1) {
      for (let x = 0; x < source.width; x += 1) {
        const u = source.width === 1 ? 0.5 : x / (source.width - 1);
        const v = source.height === 1 ? 0.5 : y / (source.height - 1);
        const fiber = effectRandom(options, "D03.paper-fiber", Math.floor(u * 96), Math.floor(v * 96), 1, 0, false);
        const coarse = effectRandom(options, "D03.organic-edge", Math.floor(u * 28), Math.floor(v * 28), 1, 13, false);
        let field = 0;
        seeds.forEach(([seedX, seedY], index) => {
          const delay = index * 0.055;
          const localProgress = clamp((progress - delay) / Math.max(0.2, 1 - delay));
          const radius = localProgress * (0.12 + diffusion * 0.34) * (index === 0 ? 1.45 : 0.76);
          const wobble = (coarse - 0.5) * edgeNoise * (0.08 + radius * 0.22)
            + Math.sin(u * 31 + v * 23 + index * 2.7) * edgeNoise * 0.012;
          const distance = Math.hypot((u - seedX) * 0.92, (v - seedY) * 1.08);
          const softness = 0.018 + absorption * 0.075;
          field = Math.max(field, smoothstep(radius + wobble + softness, radius + wobble - softness, distance));
        });
        const sourceColor = read(source, x, y);
        const pigment = field * (0.48 + absorption * 0.38) * (0.86 + fiber * 0.14);
        const feather = Math.max(0, field - 0.72) * edgeNoise * (fiber > 0.55 ? 0.16 : 0);
        write(output, x, y, mixColor(sourceColor, [0.025, 0.045, 0.055, 1], clamp(pigment + feather)));
      }
    }
    return output;
  }
  if (raster.kind !== "shape" && raster.kind !== "svg") {
    throw new TypeError(`${blueprint.effectId} requires vector path provenance.`);
  }
  const fromPath = blueprint.sourceId === "V02"
    ? flattenVectorPath(parseSvgPathData(stringParam(params, "fromPath", "")))
    : undefined;
  const toPath = blueprint.sourceId === "V02"
    ? flattenVectorPath(parseSvgPathData(stringParam(params, "toPath", "")))
    : undefined;
  const geometryPointLimit = options.quality === "draft" ? 16
    : options.quality === "preview" ? 20 : 40;
  const geometry: VectorRuntimeGeometry = {
    source: raster.paths.map((path) =>
      resamplePath(flattenVectorPath(path), geometryPointLimit)
    ),
    ...(blueprint.sourceId === "V02" ? {
      from: fromPath!,
      to: toPath!,
      morphed: interpolatePaths(
        fromPath!,
        toPath!,
        effectProgress(blueprint, params, options),
        geometryPointLimit
      )
    } : {}),
    ...(blueprint.sourceId === "D01" ? {
      draw: resamplePath(
        flattenVectorPath(parseSvgPathData(stringParam(params, "path", ""))),
        geometryPointLimit
      )
    } : {})
  };
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      const sourceColor = read(source, x, y);
      const coverage = coverageForVector(blueprint.sourceId, u, v, params, options, geometry);
      const chalkColor = blueprint.sourceId === "D04"
        ? parseHex(stringParam(params, "color", "#f4f0df")) : undefined;
      const ink: Rgba = chalkColor
        ? [chalkColor[0], chalkColor[1], chalkColor[2], coverage]
        : isDraw ? [0.96, 0.88, 0.7, coverage] : [0.25, 0.82, 1, coverage];
      write(output, x, y, mixColor(sourceColor, ink, coverage * (isDraw ? 0.9 : 0.75)));
    }
  }
  return output;
}

function parseHex(value: string): readonly [number, number, number] {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(value);
  if (!match) return [0.26, 0.78, 1];
  return [
    Number.parseInt(match[1]!, 16) / 255,
    Number.parseInt(match[2]!, 16) / 255,
    Number.parseInt(match[3]!, 16) / 255
  ];
}

function renderLight(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const output = emptyLike(source);
  const seconds = elapsedSeconds(options);
  const neon = parseHex(stringParam(params, "color", "#42C8FF"));
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      let base = read(source, x, y);
      let light = 0;
      let color = neon;
      if (blueprint.sourceId === "L01") {
        const radius = numberParam(params, "radius", 0.08);
        const sampleRadius = Math.max(1, Math.round(radius * Math.min(source.width, source.height)));
        const neighbor = read(source, x + sampleRadius, y + sampleRadius);
        const edge = Math.abs(base[3] - neighbor[3]) + Math.abs(base[0] - neighbor[0]);
        const flickerAmount = numberParam(params, "flicker", 0.12);
        const flicker = flickerAmount <= 0 ? 1 : clamp(
          1 - flickerAmount * (0.2 + effectRandom(
            options,
            "L01.flicker",
            0,
            0,
            8 + flickerAmount * 22
          ) * 0.8),
          0.05,
          1
        );
        light = clamp(edge * numberParam(params, "intensity", 1.8) * 4 * flicker);
      } else if (blueprint.sourceId === "L02") {
        const angle = numberParam(params, "angle", 18) * Math.PI / 180;
        const coordinate = -u * Math.sin(angle) + v * Math.cos(angle);
        const center = fract(seconds * numberParam(params, "speed", 0.8));
        const distance = Math.abs(fract(coordinate - center + 0.5) - 0.5);
        const width = numberParam(params, "width", 0.12);
        const softness = numberParam(params, "softness", 0.4);
        light = 1 - smoothstep(width * (1 - softness), width * (1 + softness), distance);
        color = [0.5, 0.9, 1];
      } else if (blueprint.sourceId === "L03") {
        const center = vectorParam(params, "source", [0.72, 0.28]);
        const distance = Math.hypot(u - center[0], v - center[1]);
        const ghosts = Math.max(1, numberParam(params, "ghosts", 5));
        const streak = numberParam(params, "streak", 0.45);
        const chromatic = numberParam(params, "chromatic", 0.08);
        const streakLight = Math.exp(-Math.abs(v - center[1]) * (30 / Math.max(0.05, streak)))
          * Math.exp(-Math.abs(u - center[0]) * 2);
        light = clamp((1 - smoothstep(0, 0.22, distance))
          + Math.max(0, Math.sin(distance * ghosts * 35)) * 0.16 + streakLight * streak);
        color = [1, clamp(0.72 - chromatic * 0.4), clamp(0.32 + chromatic * 0.8)];
      } else {
        const center = vectorParam(params, "center", [0.5, 0.5]);
        const distance = Math.hypot(u - center[0], v - center[1]);
        const radius = numberParam(params, "radius", 0.34);
        const rings = Math.max(1, Math.round(numberParam(params, "rings", 4)));
        const falloff = numberParam(params, "falloff", 0.2);
        const duration = Math.max(0.1, numberParam(params, "duration", 3));
        const pulseLifetimeSeconds = Math.min(1.4, Math.max(0.45, duration / Math.max(2, rings)));
        const emissionSpan = Math.max(0, duration - pulseLifetimeSeconds);
        let refraction = 0;
        for (let ringIndex = 0; ringIndex < rings; ringIndex += 1) {
          const emissionStart = rings === 1 ? 0 : emissionSpan * ringIndex / (rings - 1);
          const phase = (seconds - emissionStart) / pulseLifetimeSeconds;
          if (phase < 0 || phase > 1) continue;
          const ringRadius = radius * phase;
          const envelope = Math.sin(Math.PI * phase) ** 0.42;
          const crestWidth = 0.003 + falloff * 0.055;
          const delta = distance - ringRadius;
          const crest = Math.exp(-(delta * delta) / (2 * crestWidth * crestWidth));
          const glow = Math.exp(-Math.abs(delta) / (0.012 + falloff * 0.14));
          const wakeDelta = distance - ringRadius * 0.78;
          const wakeWidth = crestWidth * 2.5;
          const wake = Math.exp(-(wakeDelta * wakeDelta) / (2 * wakeWidth * wakeWidth));
          const core = Math.exp(-distance / (0.018 + falloff * 0.09)) * Math.exp(-phase * 5.5);
          light += (crest * 1.15 + glow * 0.38 + wake * 0.22 + core * 0.9) * envelope;
          refraction += Math.sign(delta) * crest * envelope * (0.0015 + falloff * 0.007);
        }
        if (distance > 0.0001 && Math.abs(refraction) > 0.00001) {
          const sourceU = u - (u - center[0]) / distance * refraction;
          const sourceV = v - (v - center[1]) / distance * refraction;
          base = read(source, sourceU * (source.width - 1), sourceV * (source.height - 1));
        }
        light = clamp(light);
        color = [0.55, 0.3, 1];
      }
      write(output, x, y, [
        clamp(base[0] + color[0] * light),
        clamp(base[1] + color[1] * light),
        clamp(base[2] + color[2] * light),
        base[3]
      ]);
    }
  }
  return output;
}

function renderPost(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const output = emptyLike(source);
  const qualitySamples = options.quality === "draft" ? 3 : options.quality === "preview" ? 5 : 9;
  const passes = Math.max(1, Math.round(numberParam(params, "passes", 1)));
  const requestedSamples = blueprint.sourceId === "P01"
    ? Math.min(32, qualitySamples + passes - 1)
    : Math.round(numberParam(params, "samples", qualitySamples));
  const samples = Math.max(1, Math.min(qualitySamples, requestedSamples));
  const edgeMode = stringParam(params, "edgeMode", "clamp");
  const alphaAware = booleanParam(params, "alphaAware", true);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      const sum: Rgba = [0, 0, 0, 0];
      let weightTotal = 0;
      for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
        const t = samples === 1 ? 0 : sampleIndex / (samples - 1) - 0.5;
        let su = u;
        let sv = v;
        let weight = 1;
        if (blueprint.sourceId === "P01") {
          const radius = numberParam(params, "radius", 6) * Math.sqrt(passes);
          const angle = (sampleIndex / samples) * TAU;
          su += Math.cos(angle) * radius * Math.abs(t) / Math.max(1, source.width);
          sv += Math.sin(angle) * radius * Math.abs(t) / Math.max(1, source.height);
          weight = Math.exp(-t * t * 4);
        } else if (blueprint.sourceId === "P02") {
          const angle = numberParam(params, "angle", 0) * Math.PI / 180;
          const distance = numberParam(params, "distance", 12);
          su += Math.cos(angle) * distance * t / Math.max(1, source.width);
          sv += Math.sin(angle) * distance * t / Math.max(1, source.height);
        } else if (blueprint.sourceId === "P03") {
          const center = vectorParam(params, "center", [0.5, 0.5]);
          const strength = numberParam(params, "strength", 0.16) * t;
          if (stringParam(params, "mode", "zoom") === "spin") {
            const angle = strength;
            const dx = u - center[0];
            const dy = v - center[1];
            su = center[0] + dx * Math.cos(angle) - dy * Math.sin(angle);
            sv = center[1] + dx * Math.sin(angle) + dy * Math.cos(angle);
          } else {
            su += (u - center[0]) * strength;
            sv += (v - center[1]) * strength;
          }
        } else {
          const velocity = vectorParam(params, "velocity", [0.08, 0]);
          const shutter = numberParam(params, "shutterAngle", 180) / 360;
          const centered = booleanParam(params, "centered", true);
          const sampleTime = centered ? t : sampleIndex / Math.max(1, samples - 1);
          su += velocity[0] * shutter * sampleTime;
          sv += velocity[1] * shutter * sampleTime;
        }
        const rgba = readEdge(
          source,
          su * (source.width - 1),
          sv * (source.height - 1),
          edgeMode
        );
        if (blueprint.sourceId === "P01" && alphaAware) weight *= rgba[3];
        for (let channel = 0; channel < 4; channel += 1) sum[channel]! += rgba[channel]! * weight;
        weightTotal += weight;
      }
      if (weightTotal <= 0) write(output, x, y, [0, 0, 0, 0]);
      else {
        for (let channel = 0; channel < 4; channel += 1) sum[channel]! /= weightTotal;
        write(output, x, y, sum);
      }
    }
  }
  return output;
}

function transitionCoverage(
  sourceId: EffectBlueprint["sourceId"],
  u: number,
  v: number,
  progress: number,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  if (sourceId === "C01") {
    const direction = stringParam(params, "direction", "left");
    const angle = numberParam(params, "angle", 0) * Math.PI / 180;
    const rotated = (u - 0.5) * Math.cos(angle) + (v - 0.5) * Math.sin(angle) + 0.5;
    const coordinate = direction === "right" ? 1 - rotated
      : direction === "up" ? v * Math.cos(angle) - (u - 0.5) * Math.sin(angle)
        : direction === "down" ? 1 - (v * Math.cos(angle) - (u - 0.5) * Math.sin(angle))
          : rotated;
    const softness = numberParam(params, "softness", 0.04);
    return smoothstep(progress - softness, progress + softness, 1 - coordinate);
  }
  if (sourceId === "C02") {
    const center = vectorParam(params, "center", [0.5, 0.5]);
    const start = numberParam(params, "startAngle", -90) / 360;
    let angle = fract(Math.atan2(v - center[1], u - center[0]) / TAU - start + 1);
    if (!booleanParam(params, "clockwise", true)) angle = 1 - angle;
    return angle <= progress ? 1 : 0;
  }
  if (sourceId === "C03") {
    const noise = numberParam(params, "noise", 0.16);
    const viscosity = numberParam(params, "viscosity", 0.6);
    const frequency = 8 + (1 - viscosity) * 48;
    const edge = u + (effectRandom(
      options,
      "C03.liquid",
      Math.floor(v * frequency),
      Math.floor(u * frequency * 0.5),
      1,
      0,
      false
    ) - 0.5) * noise;
    const softness = 0.015 + (1 - viscosity) * 0.1;
    return smoothstep(progress - softness, progress + softness, 1 - edge);
  }
  const grid = Math.max(2, Math.round(numberParam(params, "grid", 20)));
  const cellX = Math.min(grid - 1, Math.floor(u * grid));
  const cellY = Math.min(grid - 1, Math.floor(v * grid));
  const order = stringParam(params, "order", "random");
  const cellU = (cellX + 0.5) / grid;
  const cellV = (cellY + 0.5) / grid;
  const linearDirection = Math.round(numberParam(params, "seed", 1));
  const linearThreshold = linearDirection === 2 ? 1 - cellU
    : linearDirection === 3 ? cellV
      : linearDirection === 4 ? 1 - cellV
        : cellU;
  const threshold = order === "linear" ? linearThreshold
    : order === "radial" ? Math.hypot(cellU - 0.5, cellV - 0.5) * 1.414
      : effectRandom(
        options,
        "C04.order",
        cellX,
        cellY,
        1,
        numberParam(params, "seed", 1),
        false
      );
  return threshold <= progress ? 1 : 0;
}

function renderTransition(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const secondary = options.secondary;
  if (!secondary) throw new TypeError("Transition requires an independent B input.");
  assertSurface(secondary);
  if (secondary.width !== source.width || secondary.height !== source.height) {
    throw new RangeError("Transition A/B inputs must have equal dimensions.");
  }
  const p = effectProgress(blueprint, params, options);
  if (p <= 0) return cloneSurface(source);
  if (p >= 1) return cloneSurface(secondary);
  const output = emptyLike(source);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const u = source.width === 1 ? 0.5 : x / (source.width - 1);
      const v = source.height === 1 ? 0.5 : y / (source.height - 1);
      const coverage = transitionCoverage(blueprint.sourceId, u, v, p, params, options);
      const mixed = mixColor(read(source, x, y), read(secondary, x, y), coverage);
      if (blueprint.sourceId === "C03") {
        const glow = numberParam(params, "edgeGlow", 0.25)
          * Math.max(0, 1 - Math.abs(coverage - 0.5) * 2);
        mixed[0] = clamp(mixed[0] + glow * 0.2);
        mixed[1] = clamp(mixed[1] + glow * 0.55);
        mixed[2] = clamp(mixed[2] + glow);
      }
      write(output, x, y, mixed);
    }
  }
  return output;
}

function luma(color: Rgba): number {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function blend(base: Rgba, top: Rgba, mode: string, opacity: number): Rgba {
  const amount = clamp(opacity * top[3]);
  const output = [...base] as Rgba;
  for (let channel = 0; channel < 3; channel += 1) {
    const value = mode === "multiply" ? base[channel]! * top[channel]!
      : mode === "screen" ? base[channel]! + top[channel]! - base[channel]! * top[channel]!
        : mode === "add" ? Math.min(1, base[channel]! + top[channel]!)
          : mode === "difference" ? Math.abs(base[channel]! - top[channel]!)
            : top[channel]!;
    output[channel] = base[channel]! + (value - base[channel]!) * amount;
  }
  output[3] = amount + base[3] * (1 - amount);
  return output;
}

function assertResolvedInputReference(
  value: string,
  contextual: string,
  input: EffectRuntimeOptions["secondaryRasterInput"]
): void {
  if (value !== contextual && value !== input?.layerId) {
    throw new TypeError(`Unresolved input reference ${value}; expected ${contextual} or ${input?.layerId ?? "a layer ID"}.`);
  }
}

function renderComposite(
  blueprint: EffectBlueprint,
  source: PixelSurface,
  params: Readonly<Record<string, unknown>>,
  options: EffectRuntimeOptions
): PixelSurface {
  const secondary = options.secondary;
  if (!secondary) throw new TypeError("Composite effect requires an independent secondary input.");
  assertSurface(secondary);
  if (secondary.width !== source.width || secondary.height !== source.height) {
    throw new RangeError("Composite inputs must have equal dimensions.");
  }
  if (blueprint.sourceId === "H01") {
    assertResolvedInputReference(
      stringParam(params, "mask", "context://mask"),
      "context://mask",
      options.secondaryRasterInput
    );
  } else if (blueprint.sourceId === "H02") {
    assertResolvedInputReference(
      stringParam(params, "matteLayer", "context://secondary"),
      "context://secondary",
      options.secondaryRasterInput
    );
  } else if (blueprint.sourceId === "H04") {
    assertResolvedInputReference(
      stringParam(params, "map", "context://secondary"),
      "context://secondary",
      options.secondaryRasterInput
    );
  }
  const output = emptyLike(source);
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const base = read(source, x, y);
      const matte = read(secondary, x, y);
      let result: Rgba;
      if (blueprint.sourceId === "H01") {
        let coverage = matte[3];
        if (booleanParam(params, "invert", false)) coverage = 1 - coverage;
        const p = effectProgress(blueprint, params, options);
        const feather = numberParam(params, "feather", 0.04);
        coverage = smoothstep(p - feather, p + feather, coverage);
        result = [...base] as Rgba;
        result[3] *= coverage;
      } else if (blueprint.sourceId === "H02") {
        let coverage = stringParam(params, "mode", "alpha") === "luma"
          ? luma(matte) : matte[3];
        if (booleanParam(params, "invert", false)) coverage = 1 - coverage;
        result = [...base] as Rgba;
        result[3] *= coverage * numberParam(params, "opacity", 1);
      } else if (blueprint.sourceId === "H03") {
        const premultiply = booleanParam(params, "premultiply", true);
        const top = [...matte] as Rgba;
        if (!premultiply) {
          top[0] = clamp(top[0] * (0.5 + top[3] * 0.5));
          top[1] = clamp(top[1] * (0.5 + top[3] * 0.5));
          top[2] = clamp(top[2] * (0.5 + top[3] * 0.5));
        }
        const opacity = numberParam(params, "opacity", 1) * numberParam(params, "mix", 1);
        result = blend(base, top, stringParam(params, "mode", "normal"), opacity);
      } else {
        const channel = stringParam(params, "channel", "luma");
        const mapColor = read(secondary, x, y);
        const linearValue = channel === "red" ? mapColor[0] : channel === "green" ? mapColor[1]
          : channel === "blue" ? mapColor[2] : channel === "alpha" ? mapColor[3] : luma(mapColor);
        const sampledValue = Math.round(clamp(linearValue) * 7) / 7;
        const sx = x + (sampledValue - 0.5) * numberParam(params, "xAmount", 0.05) * source.width;
        const sy = y + (sampledValue - 0.5) * numberParam(params, "yAmount", 0.05) * source.height;
        result = read(source, sx, sy);
      }
      write(output, x, y, result);
    }
  }
  return output;
}

function applyMask(output: PixelSurface, mask: PixelSurface | undefined): PixelSurface {
  if (!mask) return output;
  assertSurface(mask);
  if (mask.width !== output.width || mask.height !== output.height) {
    throw new RangeError("Mask and effect output must have equal dimensions.");
  }
  const masked = cloneSurface(output);
  for (let y = 0; y < output.height; y += 1) {
    for (let x = 0; x < output.width; x += 1) {
      const color = read(output, x, y);
      color[3] *= read(mask, x, y)[3];
      write(masked, x, y, color);
    }
  }
  return masked;
}

export function renderEffectPixels(
  effectId: string,
  source: PixelSurface,
  suppliedParams: Readonly<Record<string, unknown>> = {},
  suppliedOptions: Partial<EffectRuntimeOptions> = {}
): PixelSurface {
  assertSurface(source);
  const blueprint = blueprintById.get(effectId);
  if (!blueprint) throw new RangeError(`Unknown Group 2 P0 effect: ${effectId}`);
  const params = { ...defaultParams(blueprint), ...normalizeEffectParams(effectId, suppliedParams) };
  if (!suppliedOptions.time) {
    throw new TypeError(`${effectId} requires EffectRuntimeOptions.time.`);
  }
  if (!suppliedOptions.rasterInput) {
    throw new TypeError(`${effectId} requires EffectRuntimeOptions.rasterInput.`);
  }
  const options: EffectRuntimeOptions = {
    time: suppliedOptions.time,
    seed: Math.trunc(suppliedOptions.seed ?? 1) >>> 0,
    quality: suppliedOptions.quality ?? "preview",
    rasterInput: suppliedOptions.rasterInput,
    ...(suppliedOptions.secondaryRasterInput
      ? { secondaryRasterInput: suppliedOptions.secondaryRasterInput } : {}),
    ...(suppliedOptions.dualInputTextures
      ? { dualInputTextures: suppliedOptions.dualInputTextures } : {}),
    ...(suppliedOptions.brushCoverage
      ? { brushCoverage: suppliedOptions.brushCoverage } : {}),
    ...(suppliedOptions.brushAssetId
      ? { brushAssetId: suppliedOptions.brushAssetId } : {}),
    ...(suppliedOptions.secondary ? { secondary: suppliedOptions.secondary } : {}),
    ...(suppliedOptions.mask ? { mask: suppliedOptions.mask } : {})
  };
  assertRuntimeInput(blueprint, source, options, params);
  const rendered = blueprint.category === "motion" ? renderMotion(blueprint, source, params, options)
    : blueprint.category === "text" ? renderText(blueprint, source, params, options)
      : blueprint.category === "vector" || blueprint.category === "draw"
        ? renderVectorOrDraw(blueprint, source, params, options)
        : blueprint.category === "light" ? renderLight(blueprint, source, params, options)
          : blueprint.category === "post" ? renderPost(blueprint, source, params, options)
            : blueprint.category === "transition" ? renderTransition(blueprint, source, params, options)
              : renderComposite(blueprint, source, params, options);
  return applyMask(rendered, options.mask);
}

export function makePreviewInput(
  effectId: string,
  effectInstanceId: string,
  width = 160,
  height = 90,
  alternate = false
): PixelSurface {
  const time = makeEffectTimeSample(effectId, effectInstanceId, 0.5);
  return makeRealInputFixture(
    effectId,
    "media",
    width,
    height,
    alternate,
    "srgb",
    time
  ).surface;
}

export function hashPixelSurface(surface: PixelSurface): string {
  let value = 0x811c9dc5;
  for (const byte of surface.data) {
    value ^= byte;
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

export function qualitySampleCount(quality: RenderQuality): number {
  return quality === "draft" ? 3 : quality === "preview" ? 5 : 9;
}

export function parameterSpecFor(effectId: string, name: string): ParameterSpec | undefined {
  return blueprintById.get(effectId)?.parameters.find((spec) => spec.name === name);
}
