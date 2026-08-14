import type {
  EffectBackendDefinition,
  EffectParameterValidationResult,
  EffectRenderResult,
  ServerEffectRenderContext
} from "../../types.js";

export const BATCH_03_GPU_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "codemotion-batch-03-gpu-v1",
  kind: "server-gpu",
  version: "1.0.0",
  deterministic: true
});

export const BATCH_03_CPU_FALLBACK: EffectBackendDefinition = Object.freeze({
  backendId: "codemotion-batch-03-cpu-v1",
  kind: "server-cpu",
  version: "1.0.0",
  deterministic: true
});

export const VALID_PARAMS: EffectParameterValidationResult = Object.freeze({ valid: true });

export function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function seededUnit(seed: number, stream: number): number {
  let value = (Math.trunc(seed) ^ Math.imul(stream + 1, 0x9e3779b1)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 0x1_0000_0000;
}

export function seededSigned(seed: number, stream: number): number {
  return seededUnit(seed, stream) * 2 - 1;
}

export function metadataResult<Output>(
  context: ServerEffectRenderContext,
  output: Output,
  warnings: readonly string[] = []
): EffectRenderResult<Output> {
  return {
    kind: "metadata",
    backendId: context.backend.backendId,
    output,
    degraded: context.backend.backendId !== BATCH_03_GPU_BACKEND.backendId,
    warnings
  };
}

export const CLOSED_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false
});
