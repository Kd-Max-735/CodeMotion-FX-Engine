import type { JsonSchema } from "@codemotion/core";
import type {
  EffectParameterValidationResult,
  EffectRenderResult,
  ServerEffectRenderContext
} from "../../types.js";

export const SERVER_CPU_BACKEND = Object.freeze({
  backendId: "effect-functions-server-cpu-v1",
  kind: "server-cpu" as const,
  version: "1.0.0",
  deterministic: true
});

export const REJECT_FALLBACK = Object.freeze({
  kind: "reject" as const,
  reason: "This deterministic generator has no equivalent declared server fallback."
});

export const COLOR_SCHEMA = Object.freeze({
  type: "string",
  pattern: "^#[0-9A-Fa-f]{6}$"
});

export function schema(properties: Record<string, unknown>): JsonSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties
  } as JsonSchema;
}

export function valid(): EffectParameterValidationResult {
  return { valid: true };
}

export function invalid(path: string, message: string): EffectParameterValidationResult {
  return { valid: false, issues: [{ path, message }] };
}

export function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function normalizeColor(value: string): string {
  return value.toUpperCase();
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function hashSeed(contextSeed: number, parameterSeed: number): number {
  let value = (Math.trunc(contextSeed) ^ Math.imul(parameterSeed, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x100000000;
  };
}

export function metadataResult<Output>(output: Output): EffectRenderResult<Output> {
  return {
    kind: "metadata",
    backendId: SERVER_CPU_BACKEND.backendId,
    output,
    degraded: false,
    warnings: []
  };
}

export interface AudioAnalysisBinding {
  readonly frequencyBins?: readonly number[];
  readonly previousFrequencyBins?: readonly number[];
  readonly waveformSamples?: readonly number[];
  readonly previousWaveformSamples?: readonly number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function audioSeries(
  context: ServerEffectRenderContext,
  field: keyof AudioAnalysisBinding,
  maximumLength: number,
  minimum: number,
  maximum: number,
  required = true
): readonly number[] {
  const authorized = context.inputs.audio_analysis;
  if (authorized === undefined || Array.isArray(authorized)) {
    if (!required) return [];
    throw new TypeError("audio_analysis must be a single server-authorized analysis binding.");
  }
  const binding = (authorized as { readonly binding: unknown }).binding;
  if (!isRecord(binding)) {
    if (!required) return [];
    throw new TypeError("audio_analysis must contain a server-created analysis object.");
  }
  const value = binding[field];
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumLength
    || !value.every((entry) => typeof entry === "number" && Number.isFinite(entry)
      && entry >= minimum && entry <= maximum)) {
    throw new TypeError(`${field} must contain 1-${maximumLength} finite normalized samples.`);
  }
  return value as readonly number[];
}
