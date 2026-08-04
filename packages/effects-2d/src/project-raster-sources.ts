import type { LayerDefinition } from "@codemotion/core";
import type {
  CoverageBuffer,
  RasterGlyph,
  TextRasterSource,
  VectorPathCommand,
  VectorRasterPath,
  VectorRasterSource
} from "@codemotion/renderer-api";

export const FORMAL_2D_RASTER_ADAPTER_VERSION = "1.0.0" as const;

export interface Formal2dRasterRequestV1 {
  readonly layer: LayerDefinition;
  readonly compositionWidth: number;
  readonly compositionHeight: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly projectSeed: number;
  readonly projectTime: number;
  readonly layerTime: number;
  readonly signal?: AbortSignal;
}

interface Formal2dRasterRequestSnapshot {
  readonly layer: LayerDefinition;
  readonly compositionWidth: number;
  readonly compositionHeight: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly projectSeed: number;
  readonly projectTime: number;
  readonly layerTime: number;
  readonly signal: AbortSignal | undefined;
}

export type Formal2dRasterErrorCodeV1 =
  | "FONT_UNAVAILABLE"
  | "INLINE_SVG_INVALID"
  | "RASTER_BUDGET_EXCEEDED";

const ERROR_MESSAGES: Readonly<Record<Formal2dRasterErrorCodeV1, string>> = Object.freeze({
  FONT_UNAVAILABLE: "Formal text rasterization is unavailable.",
  INLINE_SVG_INVALID: "Formal vector raster input is invalid.",
  RASTER_BUDGET_EXCEEDED: "Formal raster budget exceeded."
});
const ERROR_STATUS: Readonly<Record<Formal2dRasterErrorCodeV1, 413 | 422>> = Object.freeze({
  FONT_UNAVAILABLE: 422,
  INLINE_SVG_INVALID: 422,
  RASTER_BUDGET_EXCEEDED: 413
});
const formalErrors = new WeakSet<object>();
const abortErrors = new WeakSet<object>();
const runtimeProcess = (globalThis as typeof globalThis & {
  readonly process?: { getBuiltinModule?: (identifier: string) => unknown };
}).process;
const runtimeUtil = runtimeProcess?.getBuiltinModule?.("node:util") as {
  readonly types?: { isProxy?: (value: unknown) => boolean };
} | undefined;
const isRuntimeProxy = runtimeUtil?.types?.isProxy ?? (() => false);

export class Formal2dRasterErrorV1 extends Error {
  public readonly code: Formal2dRasterErrorCodeV1;
  public readonly status: 413 | 422;

  public constructor(code: Formal2dRasterErrorCodeV1) {
    super(ERROR_MESSAGES[code]);
    this.name = "Formal2dRasterErrorV1";
    this.code = code;
    this.status = ERROR_STATUS[code];
    formalErrors.add(this);
    Object.freeze(this);
  }
}

class FormalRasterAbortError extends Error {
  public readonly code = "ABORT_ERR" as const;

  public constructor() {
    super("Formal raster operation aborted.");
    this.name = "AbortError";
    abortErrors.add(this);
    Object.freeze(this);
  }
}

const FONT_FAMILY = "Codemotion Planner Unicode Bitmap";
const FONT_ID = "font.codemotion.unicode-bitmap-v1";
const FONT_ALGORITHM_VERSION = "unicode-bitmap-v1.0.0";
const MAX_TEXT_SCALARS = 4_096;
const MAX_GLYPH_COVERAGE_BYTES = 16 * 1024 * 1024;
const MAX_PATH_BYTES = 64 * 1024;
const MAX_PATH_COMMANDS = 4_096;
const MAX_RENDER_PIXELS = 33_554_432;
const MAX_CACHE_ENTRIES = 128;
const MAX_CACHE_BYTES = 512 * 1024;
const COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu;
const COMMAND = /^[MLCZ]$/iu;
const PATH_CHARACTERS = /^[MLCZmlcz0-9eE+.,\s-]*$/u;
interface InlinePathCacheEntry {
  readonly commands: readonly VectorPathCommand[];
  readonly bytes: number;
}
const inlinePathCache = new Map<string, InlinePathCacheEntry>();
let inlinePathCacheBytes = 0;
const textEncoder = new TextEncoder();
const REQUEST_KEYS = [
  "layer", "compositionWidth", "compositionHeight", "renderWidth", "renderHeight",
  "projectSeed", "projectTime", "layerTime", "signal"
] as const;
const REQUEST_REQUIRED_KEYS = REQUEST_KEYS.filter((key) => key !== "signal");
const LAYER_KEYS = [
  "id", "type", "name", "visible", "locked", "solo", "startTime", "endTime", "inPoint",
  "outPoint", "parentId", "zIndex", "transform", "opacity", "blendMode", "masks", "effects",
  "source", "properties"
] as const;
const LAYER_REQUIRED_KEYS = LAYER_KEYS.filter((key) => key !== "parentId" && key !== "source");
const FORMAL_LAYER_TYPES = new Set(["text", "shape", "image", "video", "svg", "composition"]);
const FORBIDDEN_DATA_KEYS = new Set([
  "__proto__", "prototype", "constructor", "registry", "catalog", "effectsById", "authority",
  "options", "uri", "pixels", "canvasCommands"
]);

function failure(code: Formal2dRasterErrorCodeV1): never {
  throw new Formal2dRasterErrorV1(code);
}

function abort(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new FormalRasterAbortError();
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isRuntimeProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).every((key) => typeof key === "string"
    && descriptors[key]?.enumerable === true && Object.hasOwn(descriptors[key]!, "value"));
}

function exactKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed
): value is Record<string, unknown> {
  if (!isPlainDataRecord(value)) return false;
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key))
    && required.every((key) => Object.hasOwn(value, key));
}

interface OwnDataValue {
  readonly present: boolean;
  readonly value: unknown;
}

const ABSENT_OWN_DATA_VALUE: OwnDataValue = Object.freeze({ present: false, value: undefined });

function ownDataValue(value: Record<string, unknown>, key: string): OwnDataValue {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return ABSENT_OWN_DATA_VALUE;
  if (!Object.hasOwn(descriptor, "value")) throw new TypeError("Invalid formal raster property.");
  return Object.freeze({ present: true, value: descriptor.value });
}

function requiredOwnDataValue(value: Record<string, unknown>, key: string): unknown {
  const captured = ownDataValue(value, key);
  if (!captured.present) throw new TypeError("Missing formal raster property.");
  return captured.value;
}

function safeData(value: unknown, seen = new Set<object>(), depth = 0): boolean {
  if (depth > 64) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return true;
  if (typeof value !== "object" || isRuntimeProxy(value) || seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) return false;
      return value.every((entry) => safeData(entry, seen, depth + 1));
    }
    if (!isPlainDataRecord(value)) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (FORBIDDEN_DATA_KEYS.has(key) || !Object.hasOwn(descriptor, "value")
        || !safeData(descriptor.value, seen, depth + 1)) return false;
    }
    return true;
  } finally {
    seen.delete(value);
  }
}

function validateSignal(value: unknown): value is AbortSignal | undefined {
  return value === undefined || (typeof AbortSignal !== "undefined" && value instanceof AbortSignal
    && !isRuntimeProxy(value));
}

function validDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 8_192;
}

function validateLayer(value: unknown): asserts value is LayerDefinition {
  if (!exactKeys(value, LAYER_KEYS, LAYER_REQUIRED_KEYS) || !safeData(value)
    || typeof value.type !== "string" || !FORMAL_LAYER_TYPES.has(value.type)
    || typeof value.id !== "string" || typeof value.name !== "string"
    || typeof value.visible !== "boolean" || typeof value.locked !== "boolean" || typeof value.solo !== "boolean"
    || ![value.startTime, value.endTime, value.inPoint, value.outPoint, value.zIndex]
      .every((entry) => typeof entry === "number" && Number.isFinite(entry))
    || (value.startTime as number) > (value.endTime as number)
    || (value.inPoint as number) > (value.outPoint as number)
    || (value.parentId !== undefined && typeof value.parentId !== "string")
    || typeof value.blendMode !== "string" || !Array.isArray(value.masks) || value.masks.length !== 0
    || !Array.isArray(value.effects) || value.effects.length > 32
    || !isPlainDataRecord(value.transform) || !isPlainDataRecord(value.opacity)
    || !isPlainDataRecord(value.properties)) failure("INLINE_SVG_INVALID");
  const needsSource = value.type === "image" || value.type === "video";
  if (needsSource) {
    if (!exactKeys(value.source, ["assetId"]) || typeof value.source.assetId !== "string") {
      failure("INLINE_SVG_INVALID");
    }
  } else if (value.source !== undefined) failure("INLINE_SVG_INVALID");
  if (value.type === "image" && (!exactKeys(value.properties, ["fit"])
    || !["cover", "contain", "fill", "none"].includes(String(value.properties.fit)))) {
    failure("INLINE_SVG_INVALID");
  }
  if (value.type === "video" && (!exactKeys(value.properties, ["loop", "muted"])
    || typeof value.properties.loop !== "boolean" || typeof value.properties.muted !== "boolean")) {
    failure("INLINE_SVG_INVALID");
  }
  if (value.type === "composition" && (!exactKeys(
    value.properties,
    ["compositionId", "timeOffset", "timeRemap", "timeLoop"],
    ["compositionId"]
  ) || typeof value.properties.compositionId !== "string"
    || (value.properties.timeOffset !== undefined
      && (typeof value.properties.timeOffset !== "number" || !Number.isFinite(value.properties.timeOffset)))
    || (value.properties.timeRemap !== undefined && !isPlainDataRecord(value.properties.timeRemap))
    || (value.properties.timeLoop !== undefined
      && !["none", "repeat", "ping-pong"].includes(String(value.properties.timeLoop))))) {
    failure("INLINE_SVG_INVALID");
  }
}

function validateRequest(value: unknown): Formal2dRasterRequestSnapshot {
  if (!exactKeys(value, REQUEST_KEYS, REQUEST_REQUIRED_KEYS)) failure("INLINE_SVG_INVALID");
  const layer = requiredOwnDataValue(value, "layer");
  const compositionWidth = requiredOwnDataValue(value, "compositionWidth");
  const compositionHeight = requiredOwnDataValue(value, "compositionHeight");
  const renderWidth = requiredOwnDataValue(value, "renderWidth");
  const renderHeight = requiredOwnDataValue(value, "renderHeight");
  const projectSeed = requiredOwnDataValue(value, "projectSeed");
  const projectTime = requiredOwnDataValue(value, "projectTime");
  const layerTime = requiredOwnDataValue(value, "layerTime");
  const signalValue = ownDataValue(value, "signal");
  const signal = signalValue.present ? signalValue.value : undefined;
  if (!validateSignal(signal)) failure("INLINE_SVG_INVALID");
  abort(signal);
  if (!validDimension(compositionWidth) || !validDimension(compositionHeight)
    || !validDimension(renderWidth) || !validDimension(renderHeight)
    || renderWidth > Math.floor(MAX_RENDER_PIXELS / renderHeight)) {
    failure("RASTER_BUDGET_EXCEEDED");
  }
  if (typeof projectSeed !== "number" || !Number.isInteger(projectSeed)
    || projectSeed < 0 || projectSeed > 0xffff_ffff
    || typeof projectTime !== "number" || !Number.isFinite(projectTime)
    || typeof layerTime !== "number" || !Number.isFinite(layerTime) || layerTime < 0) {
    failure("INLINE_SVG_INVALID");
  }
  validateLayer(layer);
  return Object.freeze({
    layer,
    compositionWidth,
    compositionHeight,
    renderWidth,
    renderHeight,
    projectSeed,
    projectTime,
    layerTime,
    signal
  });
}

function rgba(value: unknown, fallback?: string): readonly [number, number, number, number] {
  const color = value === undefined ? fallback : value;
  if (typeof color !== "string" || !COLOR.test(color)) failure("FONT_UNAVAILABLE");
  return Object.freeze([
    Number.parseInt(color.slice(1, 3), 16) / 255,
    Number.parseInt(color.slice(3, 5), 16) / 255,
    Number.parseInt(color.slice(5, 7), 16) / 255,
    color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) / 255 : 1
  ] as const);
}

function validColor(value: unknown): value is string {
  return typeof value === "string" && COLOR.test(value);
}

function hashNumber(value: string): number {
  let hash = 0x811c9dc5;
  for (const scalar of value) {
    hash ^= scalar.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function supportedGrapheme(value: string): boolean {
  for (const scalar of value) {
    const codePoint = scalar.codePointAt(0)!;
    if ((codePoint >= 0 && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f)
      || /\p{Cn}|\p{Cs}/u.test(scalar)) return false;
  }
  return true;
}

function rawScalarCount(value: string): number | undefined {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return undefined;
    count += 1;
    if (count > MAX_TEXT_SCALARS) return count;
  }
  return count;
}

function glyphCoverage(
  segment: string,
  width: number,
  height: number,
  identity: string,
  signal: AbortSignal | undefined
): CoverageBuffer {
  const data = new Uint8Array(width * height);
  if (!/^\s+$/u.test(segment)) {
    const bits = hashNumber(identity);
    for (let y = 0; y < height; y += 1) {
      abort(signal);
      for (let x = 0; x < width; x += 1) {
        const column = Math.min(4, Math.floor(x * 5 / width));
        const row = Math.min(6, Math.floor(y * 7 / height));
        const edge = column === 0 || column === 4 || row === 0 || row === 6;
        const diagonal = (column + row + (bits & 3)) % 5 === 0;
        const content = (bits >>> ((column + row * 5) % 31)) & 1;
        data[y * width + x] = edge || diagonal || content === 1 ? 255 : 0;
      }
    }
  }
  return Object.freeze({ width, height, data, rowOrder: "top-to-bottom" as const });
}

function textSource(snapshot: Formal2dRasterRequestSnapshot): TextRasterSource {
  const properties = snapshot.layer.properties;
  if (!exactKeys(properties, ["text", "fontFamily", "fontSize", "color"], ["text", "fontFamily", "fontSize"])) {
    failure("FONT_UNAVAILABLE");
  }
  const textValue = requiredOwnDataValue(properties, "text");
  const fontFamily = requiredOwnDataValue(properties, "fontFamily");
  const fontSize = requiredOwnDataValue(properties, "fontSize");
  const color = ownDataValue(properties, "color");
  if (typeof textValue !== "string" || fontFamily !== FONT_FAMILY
    || typeof fontSize !== "number" || !Number.isFinite(fontSize) || fontSize < 1 || fontSize > 8_192
    || (color.present && !validColor(color.value))) failure("FONT_UNAVAILABLE");
  const scalarCount = rawScalarCount(textValue);
  if (scalarCount === undefined) failure("FONT_UNAVAILABLE");
  if (scalarCount > MAX_TEXT_SCALARS) failure("RASTER_BUDGET_EXCEEDED");
  const text = textValue.normalize("NFC");
  const units = [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text)];
  if (units.some((unit) => !supportedGrapheme(unit.segment))) failure("FONT_UNAVAILABLE");
  const glyphWidth = Math.max(1, Math.round(
    fontSize * 0.62 * snapshot.renderWidth / snapshot.compositionWidth
  ));
  const glyphHeight = Math.max(1, Math.round(
    fontSize * snapshot.renderHeight / snapshot.compositionHeight
  ));
  const coverageBytes = glyphWidth * glyphHeight * units.length;
  if (!Number.isSafeInteger(coverageBytes) || coverageBytes > MAX_GLYPH_COVERAGE_BYTES) {
    failure("RASTER_BUDGET_EXCEEDED");
  }
  const identityPrefix = [
    FONT_ALGORITHM_VERSION,
    fontSize,
    snapshot.compositionWidth,
    snapshot.compositionHeight,
    snapshot.renderWidth,
    snapshot.renderHeight,
    snapshot.projectSeed
  ].join("\u0000");
  const glyphs: RasterGlyph[] = units.map((unit, index) => {
    abort(snapshot.signal);
    const identity = `${identityPrefix}\u0000${unit.segment}`;
    const coverage = glyphCoverage(unit.segment, glyphWidth, glyphHeight, identity, snapshot.signal);
    return Object.freeze({
      glyphId: hashNumber(`${FONT_ALGORITHM_VERSION}\u0000${unit.segment}`),
      cluster: unit.index,
      advance: glyphWidth + 1,
      offsetX: 0,
      offsetY: 0,
      bounds: Object.freeze({
        x: index * (glyphWidth + 1),
        y: 0,
        width: glyphWidth,
        height: glyphHeight
      }),
      coverage
    });
  });
  abort(snapshot.signal);
  return Object.freeze({
    kind: "text",
    text,
    font: Object.freeze({
      fontId: FONT_ID,
      assetId: FONT_ID,
      assetHash: `builtin:${FONT_ID}:${FONT_ALGORITHM_VERSION}`,
      family: FONT_FAMILY,
      style: "normal",
      weight: 500,
      unitsPerEm: 1_000,
      missingGlyphPolicy: "error" as const
    }),
    glyphs: Object.freeze(glyphs),
    fillRgba: rgba(color.present ? color.value : undefined, "#FFFFFFFF")
  });
}

class PathBudgetError extends Error {}

function parsePath(
  value: string,
  coordinateLimit: number,
  signal: AbortSignal | undefined
): readonly VectorPathCommand[] {
  abort(signal);
  if (new TextEncoder().encode(value).byteLength > MAX_PATH_BYTES) throw new PathBudgetError();
  if (value.trim().length === 0 || !PATH_CHARACTERS.test(value)) throw new SyntaxError();
  const tokens = value.match(/[MLCZmlcz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gu) ?? [];
  if (tokens.join("") !== value.replace(/[\s,]+/gu, "") || tokens.length === 0) throw new SyntaxError();
  const commands: VectorPathCommand[] = [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const coordinate = (): number => {
    const token = tokens[index++];
    if (token === undefined || COMMAND.test(token)) throw new SyntaxError();
    const result = Number(token);
    if (!Number.isFinite(result) || Math.abs(result) > coordinateLimit) throw new SyntaxError();
    return result;
  };
  const add = (entry: VectorPathCommand): void => {
    commands.push(Object.freeze(entry));
    if (commands.length > MAX_PATH_COMMANDS) throw new PathBudgetError();
  };
  while (index < tokens.length) {
    if ((index & 63) === 0) abort(signal);
    if (COMMAND.test(tokens[index]!)) command = tokens[index++]!;
    if (command.length === 0) throw new SyntaxError();
    const relative = command === command.toLowerCase();
    const op = command.toUpperCase();
    if (op === "Z") {
      add({ op: "close" });
      x = startX;
      y = startY;
      command = "";
      continue;
    }
    if (op === "M" || op === "L") {
      const nextX = coordinate() + (relative ? x : 0);
      const nextY = coordinate() + (relative ? y : 0);
      if (Math.abs(nextX) > coordinateLimit || Math.abs(nextY) > coordinateLimit) throw new SyntaxError();
      x = nextX;
      y = nextY;
      if (op === "M") {
        add({ op: "move", x, y });
        startX = x;
        startY = y;
        command = relative ? "l" : "L";
      } else add({ op: "line", x, y });
      continue;
    }
    if (op === "C") {
      const x1 = coordinate() + (relative ? x : 0);
      const y1 = coordinate() + (relative ? y : 0);
      const x2 = coordinate() + (relative ? x : 0);
      const y2 = coordinate() + (relative ? y : 0);
      const nextX = coordinate() + (relative ? x : 0);
      const nextY = coordinate() + (relative ? y : 0);
      if ([x1, y1, x2, y2, nextX, nextY].some((entry) => Math.abs(entry) > coordinateLimit)) {
        throw new SyntaxError();
      }
      add({ op: "cubic", x1, y1, x2, y2, x: nextX, y: nextY });
      x = nextX;
      y = nextY;
      continue;
    }
    throw new SyntaxError();
  }
  abort(signal);
  if (commands[0]?.op !== "move"
    || !commands.some((entry) => entry.op === "line" || entry.op === "cubic")) throw new SyntaxError();
  return Object.freeze(commands);
}

function vectorPath(
  commands: readonly VectorPathCommand[],
  fill: string,
  stroke: string | null,
  strokeWidth: number,
  fillRule: "nonzero" | "evenodd"
): VectorRasterPath {
  return Object.freeze({ commands, fill, stroke, strokeWidth, fillRule });
}

function shapeSource(snapshot: Formal2dRasterRequestSnapshot): VectorRasterSource {
  const properties = snapshot.layer.properties;
  if (!exactKeys(properties, ["shapes", "fill"], ["shapes"])) failure("INLINE_SVG_INVALID");
  const shapesValue = requiredOwnDataValue(properties, "shapes");
  const layerFill = ownDataValue(properties, "fill");
  if (!Array.isArray(shapesValue) || shapesValue.length === 0 || shapesValue.length > 256
    || (layerFill.present && !validColor(layerFill.value))) failure("INLINE_SVG_INVALID");
  let totalBytes = 0;
  let totalCommands = 0;
  const paths: VectorRasterPath[] = [];
  try {
    for (const candidate of shapesValue) {
      abort(snapshot.signal);
      if (!exactKeys(candidate, ["path", "fill"], ["path"])) failure("INLINE_SVG_INVALID");
      const pathValue = requiredOwnDataValue(candidate, "path");
      const itemFill = ownDataValue(candidate, "fill");
      if (typeof pathValue !== "string" || (itemFill.present && !validColor(itemFill.value))) {
        failure("INLINE_SVG_INVALID");
      }
      totalBytes += new TextEncoder().encode(pathValue).byteLength;
      if (totalBytes > MAX_PATH_BYTES) throw new PathBudgetError();
      const commands = parsePath(pathValue, 8_192, snapshot.signal);
      totalCommands += commands.length;
      if (totalCommands > MAX_PATH_COMMANDS) throw new PathBudgetError();
      paths.push(vectorPath(
        commands,
        itemFill.present
          ? itemFill.value as string
          : layerFill.present ? layerFill.value as string : "#FFFFFFFF",
        null,
        0,
        "nonzero"
      ));
    }
  } catch (error) {
    if (typeof error === "object" && error !== null
      && (formalErrors.has(error) || abortErrors.has(error))) throw error;
    if (error instanceof PathBudgetError) failure("RASTER_BUDGET_EXCEEDED");
    failure("INLINE_SVG_INVALID");
  }
  return Object.freeze({
    kind: "shape",
    viewport: Object.freeze({ x: 0, y: 0, width: snapshot.compositionWidth, height: snapshot.compositionHeight }),
    paths: Object.freeze(paths)
  });
}

function inlineSvgSource(snapshot: Formal2dRasterRequestSnapshot): VectorRasterSource {
  const properties = snapshot.layer.properties;
  if (!exactKeys(properties, ["svg", "fill", "stroke", "strokeWidth", "fillRule"], ["svg"])) {
    failure("INLINE_SVG_INVALID");
  }
  const svgValue = requiredOwnDataValue(properties, "svg");
  const fillValue = ownDataValue(properties, "fill");
  const strokeValue = ownDataValue(properties, "stroke");
  const strokeWidthValue = ownDataValue(properties, "strokeWidth");
  const fillRuleValue = ownDataValue(properties, "fillRule");
  if (typeof svgValue !== "string"
    || (fillValue.present && !validColor(fillValue.value))
    || (strokeValue.present && !validColor(strokeValue.value))
    || (strokeWidthValue.present && (typeof strokeWidthValue.value !== "number"
      || !Number.isFinite(strokeWidthValue.value) || strokeWidthValue.value < 0))
    || (fillRuleValue.present && fillRuleValue.value !== "nonzero" && fillRuleValue.value !== "evenodd")) {
    failure("INLINE_SVG_INVALID");
  }
  const fill = fillValue.present ? fillValue.value as string : "#FFFFFFFF";
  const stroke = strokeValue.present ? strokeValue.value as string : null;
  const strokeWidth = strokeWidthValue.present ? strokeWidthValue.value as number : 0;
  const fillRule = fillRuleValue.present ? fillRuleValue.value as "nonzero" | "evenodd" : "nonzero";
  const cacheKey = [
    FORMAL_2D_RASTER_ADAPTER_VERSION,
    svgValue,
    fill,
    stroke ?? "",
    strokeWidth,
    fillRule
  ].join("\u0000");
  abort(snapshot.signal);
  const cached = inlinePathCache.get(cacheKey);
  let commands: readonly VectorPathCommand[];
  if (cached !== undefined) {
    inlinePathCache.delete(cacheKey);
    inlinePathCache.set(cacheKey, cached);
    commands = cached.commands;
  } else {
    const cacheBytes = textEncoder.encode(cacheKey).byteLength;
    if (cacheBytes > MAX_CACHE_BYTES) failure("RASTER_BUDGET_EXCEEDED");
    try {
      commands = parsePath(svgValue, 16, snapshot.signal);
    } catch (error) {
      if (typeof error === "object" && error !== null && abortErrors.has(error)) throw error;
      if (error instanceof PathBudgetError) failure("RASTER_BUDGET_EXCEEDED");
      failure("INLINE_SVG_INVALID");
    }
    abort(snapshot.signal);
    while (inlinePathCache.size >= MAX_CACHE_ENTRIES
      || inlinePathCacheBytes + cacheBytes > MAX_CACHE_BYTES) {
      const oldestKey = inlinePathCache.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      const oldest = inlinePathCache.get(oldestKey)!;
      inlinePathCache.delete(oldestKey);
      inlinePathCacheBytes -= oldest.bytes;
    }
    inlinePathCache.set(cacheKey, Object.freeze({ commands, bytes: cacheBytes }));
    inlinePathCacheBytes += cacheBytes;
  }
  abort(snapshot.signal);
  return Object.freeze({
    kind: "svg",
    viewport: Object.freeze({ x: 0, y: 0, width: 1, height: 1 }),
    paths: Object.freeze([vectorPath(commands, fill, stroke, strokeWidth, fillRule)])
  });
}

function resolveFormal2dRasterSourceInternal(
  value: unknown
): TextRasterSource | VectorRasterSource | undefined {
  const snapshot = validateRequest(value);
  if (snapshot.layer.type === "text") return textSource(snapshot);
  if (snapshot.layer.type === "shape") return shapeSource(snapshot);
  if (snapshot.layer.type === "svg") return inlineSvgSource(snapshot);
  return undefined;
}

export function resolveFormal2dRasterSourceV1(
  request: Formal2dRasterRequestV1
): TextRasterSource | VectorRasterSource | undefined {
  try {
    return resolveFormal2dRasterSourceInternal(request);
  } catch (error) {
    if (typeof error === "object" && error !== null
      && (formalErrors.has(error) || abortErrors.has(error))) throw error;
    failure("INLINE_SVG_INVALID");
  }
}
