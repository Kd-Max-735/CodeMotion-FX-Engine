import type {
  EffectBackendDefinition,
  EffectParameterValidationResult,
  EffectRenderResult
} from "../../types.js";

export const SERVER_GPU_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "codemotion-server-gpu-v1",
  kind: "server-gpu",
  version: "1.0.0",
  deterministic: true
});

export const SERVER_THREE_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "codemotion-server-three-v1",
  kind: "server-three",
  version: "1.0.0",
  deterministic: true
});

export const FFMPEG_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "codemotion-ffmpeg-v1",
  kind: "ffmpeg",
  version: "1.0.0",
  deterministic: true
});

export type Easing = "linear" | "ease_in" | "ease_out" | "ease_in_out";

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function ease(value: number, easing: Easing): number {
  const t = clamp(value, 0, 1);
  switch (easing) {
    case "ease_in": return t * t;
    case "ease_out": return 1 - (1 - t) * (1 - t);
    case "ease_in_out": return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    default: return t;
  }
}

export function timedProgress(time: number, start: number, duration: number, easing: Easing): number {
  return ease((time - start) / duration, easing);
}

export function seededUnit(seed: number, index: number, channel: number): number {
  let value = (Math.trunc(seed) ^ Math.imul(index + 1, 0x9e3779b1)
    ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

export function valid(): EffectParameterValidationResult {
  return { valid: true };
}

export function invalid(path: string, message: string): EffectParameterValidationResult {
  return { valid: false, issues: [{ path, message }] };
}

export function frameResult(
  backendId: string,
  output: Record<string, unknown>,
  warnings: readonly string[] = []
): EffectRenderResult<Record<string, unknown>> {
  return {
    kind: "frame",
    backendId,
    output,
    degraded: false,
    warnings
  };
}

export const REJECT_FALLBACK = Object.freeze({
  kind: "reject" as const,
  reason: "No fidelity-preserving server fallback is declared."
});
