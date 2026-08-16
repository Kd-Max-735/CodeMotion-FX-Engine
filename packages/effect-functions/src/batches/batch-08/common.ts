import type {
  AuthorizedEffectInput,
  EffectBackendDefinition,
  EffectParameterIssue,
  EffectParameterValidationResult,
  ServerEffectRenderContext
} from "../../types.js";

export const CPU_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "effect-functions-cpu-v1",
  kind: "server-cpu",
  version: "1.0.0",
  deterministic: true
});

export const GPU_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "effect-functions-gpu-v1",
  kind: "server-gpu",
  version: "1.0.0",
  deterministic: true
});

export const JSON_SCHEMA = "https://json-schema.org/draft/2020-12/schema";

export function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("Rendered numeric output must be finite.");
  }
  const factor = 10 ** digits;
  if (Math.abs(value) > Number.MAX_SAFE_INTEGER / factor) return value;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function smoothstep(value: number): number {
  const bounded = clamp(value);
  return bounded * bounded * (3 - 2 * bounded);
}

export function singleBinding<T>(
  context: ServerEffectRenderContext,
  slot: string
): T {
  const input = context.inputs[slot];
  if (input === undefined || Array.isArray(input)) {
    throw new TypeError(`Expected one server binding for ${slot}.`);
  }
  return (input as AuthorizedEffectInput<T>).binding;
}

export function optionalSingleBinding<T>(
  context: ServerEffectRenderContext,
  slot: string
): T | undefined {
  const input = context.inputs[slot];
  if (input === undefined) return undefined;
  if (Array.isArray(input)) throw new TypeError(`Expected one server binding for ${slot}.`);
  return (input as AuthorizedEffectInput<T>).binding;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

export function unitNumber(value: unknown, label: string): number {
  const result = finiteNumber(value, label);
  if (result < 0 || result > 1) throw new RangeError(`${label} must be between 0 and 1.`);
  return result;
}

export function issuesOrValid(
  issues: readonly EffectParameterIssue[]
): EffectParameterValidationResult {
  return issues.length === 0 ? { valid: true } : { valid: false, issues };
}

export function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unexpected.length > 0) {
    throw new TypeError(`${label} contains unsupported fields: ${unexpected.join(", ")}.`);
  }
}
