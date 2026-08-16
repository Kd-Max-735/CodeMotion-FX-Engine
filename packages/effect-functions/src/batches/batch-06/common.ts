import type {
  AuthorizedEffectInput,
  EffectBackendDefinition,
  EffectParameterValidationResult,
  EffectRenderResult,
  ServerEffectRenderContext
} from "../../types.js";

export const SERVER_GPU_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "codemotion-server-gpu-v1",
  kind: "server-gpu",
  version: "1.0.0",
  deterministic: true
});

export const SERVER_CPU_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "codemotion-effect-functions-cpu-v1",
  kind: "server-cpu",
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

export const RGBA8_FRAME_VERSION = "rgba8-frame-v1" as const;

export interface Rgba8FrameBinding {
  readonly version: typeof RGBA8_FRAME_VERSION;
  readonly width: number;
  readonly height: number;
  readonly data: readonly number[] | Uint8Array | Uint8ClampedArray;
}

export interface Rgba8FrameOutput extends Rgba8FrameBinding {
  readonly sourceSlot: string;
  readonly sampleTime: number;
}

export class Batch06AdapterRequiredError extends Error {
  public readonly code = "BATCH_06_ADAPTER_REQUIRED";

  public constructor(
    public readonly toolName: string,
    public readonly capability: string
  ) {
    super(`${toolName} is BLOCKED until Window 12 provides ${capability}.`);
    this.name = "Batch06AdapterRequiredError";
  }
}

export function blockedRender(toolName: string, capability: string): never {
  throw new Batch06AdapterRequiredError(toolName, capability);
}

export function readRgba8Frame(
  context: ServerEffectRenderContext,
  slot: string
): Rgba8FrameBinding {
  const input = context.inputs[slot];
  if (input === undefined || Array.isArray(input)) {
    throw new TypeError(`${slot} must contain exactly one server-decoded RGBA frame.`);
  }
  const binding = (input as AuthorizedEffectInput).binding;
  if (typeof binding !== "object" || binding === null) {
    throw new TypeError(`${slot} must bind an ${RGBA8_FRAME_VERSION} object.`);
  }
  const value = binding as Partial<Rgba8FrameBinding>;
  if (value.version !== RGBA8_FRAME_VERSION
    || !Number.isInteger(value.width) || !Number.isInteger(value.height)
    || value.width! < 1 || value.height! < 1) {
    throw new TypeError(`${slot} must bind positive integer RGBA frame dimensions.`);
  }
  const data = value.data;
  if (!Array.isArray(data) && !(data instanceof Uint8Array)
    && !(data instanceof Uint8ClampedArray)) {
    throw new TypeError(`${slot} must bind RGBA8 pixel data.`);
  }
  if (data.length !== value.width! * value.height! * 4) {
    throw new RangeError(`${slot} pixel length does not match its dimensions.`);
  }
  for (const channel of data) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new RangeError(`${slot} must contain only finite 8-bit RGBA channels.`);
    }
  }
  return {
    version: RGBA8_FRAME_VERSION,
    width: value.width!,
    height: value.height!,
    data
  };
}

export function rgbaFrameResult(
  backendId: string,
  output: Rgba8FrameOutput
): EffectRenderResult<Rgba8FrameOutput> {
  return {
    kind: "frame",
    backendId,
    output,
    degraded: false,
    warnings: []
  };
}

export const REJECT_FALLBACK = Object.freeze({
  kind: "reject" as const,
  reason: "No fidelity-preserving server fallback is declared."
});
