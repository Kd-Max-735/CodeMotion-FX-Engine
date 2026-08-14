import type { JsonObject } from "@codemotion/core";
import type {
  AuthorizedEffectInput,
  AuthorizedEffectInputs,
  EffectParameterValidationResult,
  EffectRenderResult,
  ServerEffectRenderContext
} from "../../types.js";

export const BATCH_04_BACKEND = Object.freeze({
  backendId: "batch-04-server-cpu-v1",
  kind: "server-cpu" as const,
  version: "1.0.0",
  deterministic: true
});

export const REJECT_FALLBACK = Object.freeze({
  kind: "reject" as const,
  reason: "This deterministic simulation has no fidelity-equivalent fallback."
});

export interface SimulationPoint extends JsonObject {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimulationOutput extends JsonObject {
  effectId: string;
  simulatedTime: number;
  stepCount: number;
  state: JsonObject;
  metrics: JsonObject;
}

export function bounded(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

export function boundedInt(value: number, minimum: number, maximum: number, fallback: number): number {
  return Math.round(bounded(value, minimum, maximum, fallback));
}

export function rounded(value: number, digits = 6): number {
  const scale = 10 ** digits;
  const result = Math.round(value * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

export function fixedSteps(
  context: ServerEffectRenderContext,
  frequency = 60,
  maximum = 360
): { readonly count: number; readonly dt: number; readonly capped: boolean } {
  const requested = Math.max(0, Math.floor(context.time * frequency + 1e-9));
  const count = Math.min(maximum, requested);
  return { count, dt: 1 / frequency, capped: requested > maximum };
}

export function createRng(seed: number): () => number {
  let state = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function validParams(): EffectParameterValidationResult {
  return { valid: true };
}

export function simulationResult(
  effectId: string,
  stepCount: number,
  dt: number,
  state: JsonObject,
  metrics: JsonObject,
  capped: boolean
): EffectRenderResult<SimulationOutput> {
  return {
    kind: "metadata",
    backendId: BATCH_04_BACKEND.backendId,
    output: {
      effectId,
      simulatedTime: rounded(stepCount * dt),
      stepCount,
      state,
      metrics
    },
    degraded: false,
    warnings: capped
      ? ["Simulation time was capped to keep server work deterministic and bounded."]
      : []
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function inputBinding(
  inputs: AuthorizedEffectInputs,
  slot: string
): Record<string, unknown> | undefined {
  const value = inputs[slot];
  const binding = Array.isArray(value) ? value[0] : value as AuthorizedEffectInput | undefined;
  return record(binding?.binding);
}

export function pointList(
  inputs: AuthorizedEffectInputs,
  slot: string,
  key: string,
  maximum: number
): readonly { readonly x: number; readonly y: number }[] {
  const value = inputBinding(inputs, slot)?.[key];
  if (!Array.isArray(value)) return [];
  const points: { x: number; y: number }[] = [];
  for (const entry of value.slice(0, maximum)) {
    const item = record(entry);
    if (item !== undefined && typeof item.x === "number" && Number.isFinite(item.x)
      && typeof item.y === "number" && Number.isFinite(item.y)) {
      points.push({ x: bounded(item.x, -4, 4, 0), y: bounded(item.y, -4, 4, 0) });
    }
  }
  return points;
}

export function indexList(
  inputs: AuthorizedEffectInputs,
  slot: string,
  key: string,
  maximumIndex: number
): ReadonlySet<number> {
  const value = inputBinding(inputs, slot)?.[key];
  if (!Array.isArray(value)) return new Set<number>();
  return new Set(value
    .filter((entry): entry is number => Number.isInteger(entry) && entry >= 0 && entry <= maximumIndex)
    .slice(0, maximumIndex + 1));
}

export interface BoundVectorField {
  readonly columns: number;
  readonly rows: number;
  readonly vectors: readonly { readonly x: number; readonly y: number }[];
}

export function vectorFieldBinding(inputs: AuthorizedEffectInputs): BoundVectorField | undefined {
  const binding = inputBinding(inputs, "vector_field");
  if (binding === undefined || !Number.isInteger(binding.columns) || !Number.isInteger(binding.rows)
    || !Array.isArray(binding.vectors)) return undefined;
  const columns = boundedInt(binding.columns as number, 2, 32, 2);
  const rows = boundedInt(binding.rows as number, 2, 32, 2);
  if (binding.vectors.length < columns * rows) return undefined;
  const vectors: { x: number; y: number }[] = [];
  for (const entry of binding.vectors.slice(0, columns * rows)) {
    const item = record(entry);
    if (item === undefined || typeof item.x !== "number" || !Number.isFinite(item.x)
      || typeof item.y !== "number" || !Number.isFinite(item.y)) return undefined;
    vectors.push({ x: bounded(item.x, -4, 4, 0), y: bounded(item.y, -4, 4, 0) });
  }
  return { columns, rows, vectors };
}

export function sampleBoundVectorField(
  field: BoundVectorField,
  x: number,
  y: number
): { readonly x: number; readonly y: number } {
  const u = bounded((x + 1) * 0.5, 0, 1, 0.5);
  const v = bounded((y + 1) * 0.5, 0, 1, 0.5);
  const column = Math.min(field.columns - 1, Math.floor(u * field.columns));
  const row = Math.min(field.rows - 1, Math.floor(v * field.rows));
  return field.vectors[row * field.columns + column] ?? { x: 0, y: 0 };
}
