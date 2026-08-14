import type { JsonObject, JsonSchema } from "@codemotion/core";
import type {
  AuthorizedEffectInput,
  EffectBackendDefinition,
  EffectParameterValidationResult,
  EffectRenderResult,
  ServerEffectRenderContext
} from "../../types.js";

export interface Point extends JsonObject {
  x: number;
  y: number;
}

export interface PathData {
  readonly points: readonly Point[];
  readonly closed: boolean;
}

export interface RasterMaskData {
  readonly width: number;
  readonly height: number;
  readonly values: readonly number[];
}

export interface StrokePlanData {
  readonly strokes: readonly PathData[];
}

export const SERVER_CPU_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "effect-functions-cpu-v1",
  kind: "server-cpu",
  version: "1.0.0",
  deterministic: true
});

export const SERVER_CPU_FALLBACK = Object.freeze({
  kind: "reject" as const,
  reason: "This effect requires the deterministic effect-functions server CPU backend."
});

export const VALID_PARAMS: EffectParameterValidationResult = Object.freeze({ valid: true });

export function parameterSchema(properties: JsonObject): JsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties
  };
}

export function numberField(defaultValue: number, minimum: number, maximum: number): JsonObject {
  return { type: "number", minimum, maximum, default: defaultValue };
}

export function integerField(defaultValue: number, minimum: number, maximum: number): JsonObject {
  return { type: "integer", minimum, maximum, default: defaultValue };
}

export function enumField(defaultValue: string, values: readonly string[]): JsonObject {
  return { type: "string", enum: [...values], default: defaultValue };
}

export function effectResult<Output>(
  kind: EffectRenderResult["kind"],
  output: Output,
  warnings: readonly string[] = []
): EffectRenderResult<Output> {
  return {
    kind,
    backendId: SERVER_CPU_BACKEND.backendId,
    output,
    degraded: false,
    warnings: Object.freeze([...warnings])
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bindingFor(context: ServerEffectRenderContext, slot: string): unknown {
  const value = context.inputs[slot];
  if (value === undefined || Array.isArray(value)) {
    throw new TypeError(`Input slot ${slot} must contain one server binding.`);
  }
  return (value as AuthorizedEffectInput).binding;
}

function finitePoint(value: unknown): Point | undefined {
  if (!isRecord(value) || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return undefined;
  return { x: value.x as number, y: value.y as number };
}

export function readPath(
  context: ServerEffectRenderContext,
  slot: string,
  minimumPoints = 2
): PathData {
  const binding = bindingFor(context, slot);
  if (!isRecord(binding) || !Array.isArray(binding.points)) {
    throw new TypeError(`Input slot ${slot} must bind server path geometry.`);
  }
  const points = binding.points.map(finitePoint);
  if (points.length < minimumPoints || points.some((point) => point === undefined)) {
    throw new TypeError(`Input slot ${slot} contains invalid path points.`);
  }
  if (pathLength(points as Point[], binding.closed === true) <= Number.EPSILON) {
    throw new TypeError(`Input slot ${slot} contains a zero-length path.`);
  }
  return {
    points: points as Point[],
    closed: binding.closed === true
  };
}

export function readRasterMask(context: ServerEffectRenderContext, slot: string): RasterMaskData {
  const binding = bindingFor(context, slot);
  if (!isRecord(binding) || !Number.isInteger(binding.width) || !Number.isInteger(binding.height)
    || (binding.width as number) < 1 || (binding.height as number) < 1
    || !Array.isArray(binding.values)
    || binding.values.length !== (binding.width as number) * (binding.height as number)
    || binding.values.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`Input slot ${slot} must bind a finite scalar mask.`);
  }
  return {
    width: binding.width as number,
    height: binding.height as number,
    values: binding.values.map((value) => clamp(value as number, 0, 1))
  };
}

export function readStrokePlan(context: ServerEffectRenderContext, slot: string): StrokePlanData {
  const binding = bindingFor(context, slot);
  if (!isRecord(binding) || !Array.isArray(binding.strokes) || binding.strokes.length === 0) {
    throw new TypeError(`Input slot ${slot} must bind a non-empty stroke plan.`);
  }
  const strokes = binding.strokes.map((stroke, index) => {
    if (!isRecord(stroke) || !Array.isArray(stroke.points)) {
      throw new TypeError(`Stroke ${index} in ${slot} is invalid.`);
    }
    const points = stroke.points.map(finitePoint);
    if (points.length < 2 || points.some((point) => point === undefined)) {
      throw new TypeError(`Stroke ${index} in ${slot} has invalid points.`);
    }
    return { points: points as Point[], closed: stroke.closed === true };
  });
  return { strokes };
}

export function readImageDimensions(
  context: ServerEffectRenderContext,
  slot: string
): { width: number; height: number } {
  const binding = bindingFor(context, slot);
  if (!isRecord(binding) || !Number.isInteger(binding.width) || !Number.isInteger(binding.height)
    || (binding.width as number) < 1 || (binding.height as number) < 1) {
    throw new TypeError(`Input slot ${slot} must expose server-decoded image dimensions.`);
  }
  return { width: binding.width as number, height: binding.height as number };
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function roundPoint(point: Point): Point {
  return { x: round(point.x), y: round(point.y) };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pathLength(points: readonly Point[], closed = false): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1]!, points[index]!);
  if (closed && points.length > 2) total += distance(points[points.length - 1]!, points[0]!);
  return total;
}

export function samplePath(points: readonly Point[], closed: boolean, normalizedOffset: number): Point {
  if (points.length === 1) return { ...points[0]! };
  const total = pathLength(points, closed);
  if (total <= Number.EPSILON) return { ...points[0]! };
  const t = closed
    ? ((normalizedOffset % 1) + 1) % 1
    : clamp(normalizedOffset, 0, 1);
  let target = t * total;
  const segmentCount = points.length - 1 + (closed ? 1 : 0);
  for (let index = 0; index < segmentCount; index += 1) {
    const a = points[index % points.length]!;
    const b = points[(index + 1) % points.length]!;
    const segment = distance(a, b);
    if (target <= segment || index === segmentCount - 1) {
      const ratio = segment <= Number.EPSILON ? 0 : target / segment;
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    target -= segment;
  }
  return { ...points[points.length - 1]! };
}

export function resamplePath(path: PathData, spacing: number, minimumCount = 2): Point[] {
  const total = pathLength(path.points, path.closed);
  const count = clamp(Math.ceil(total / Math.max(spacing, 0.25)) + (path.closed ? 0 : 1), minimumCount, 2048);
  const divisor = path.closed ? count : Math.max(1, count - 1);
  return Array.from({ length: count }, (_, index) => roundPoint(samplePath(path.points, path.closed, index / divisor)));
}

export function slicePath(path: PathData, start: number, end: number, spacing = 8): Point[] {
  const first = clamp(Math.min(start, end), 0, 1);
  const last = clamp(Math.max(start, end), 0, 1);
  if (last <= first) return [roundPoint(samplePath(path.points, path.closed, first))];
  const total = pathLength(path.points, path.closed) * (last - first);
  const count = clamp(Math.ceil(total / spacing) + 1, 2, 2048);
  return Array.from({ length: count }, (_, index) => {
    const t = first + (last - first) * index / (count - 1);
    return roundPoint(samplePath(path.points, path.closed, t));
  });
}

export function centroid(points: readonly Point[]): Point {
  const sum = points.reduce((value, point) => ({ x: value.x + point.x, y: value.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

export function randomAt(seed: number, index: number): number {
  let value = (Math.trunc(seed) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

export function animatedSeed(context: ServerEffectRenderContext, rate: number, salt = 0): number {
  const tick = Math.floor(context.time * Math.max(rate, 0));
  return (Math.trunc(context.seed) ^ Math.imul(tick + salt + 1, 0x45d9f3b)) >>> 0;
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy;
  const t = denominator <= Number.EPSILON
    ? 0
    : clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator, 0, 1);
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

export function signedDistanceToPolygon(point: Point, polygon: readonly Point[]): number {
  let inside = false;
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[previous]!;
    const b = polygon[index]!;
    minimum = Math.min(minimum, pointSegmentDistance(point, a, b));
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside ? -minimum : minimum;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (Math.abs(edge1 - edge0) <= Number.EPSILON) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
