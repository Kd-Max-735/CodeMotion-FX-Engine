import type { JsonObject } from "@codemotion/core";
import type {
  AuthorizedEffectInput,
  EffectParameterValidationResult,
  EffectRenderResult,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../types.js";

export interface RgbaFrame {
  readonly width: number;
  readonly height: number;
  readonly data: readonly number[] | Uint8Array | Uint8ClampedArray;
}

export interface DepthField {
  readonly width: number;
  readonly height: number;
  readonly data: readonly number[];
}

export const CPU_BACKEND = Object.freeze({
  backendId: "batch-02-server-cpu-v1",
  kind: "server-cpu" as const,
  version: "1.0.0",
  deterministic: true
});

export const REJECT_FALLBACK = Object.freeze({
  kind: "reject" as const,
  reason: "This effect requires its deterministic server CPU implementation."
});

export const SOURCE_FRAME_SLOT = Object.freeze({
  name: "source_frame",
  kind: "image" as const,
  required: true,
  cardinality: "one" as const,
  description: "Owner-authorized RGBA source frame bound by the server."
});

export const VALID_PARAMS: EffectParameterValidationResult = Object.freeze({ valid: true });

function singleBinding(
  context: ServerEffectRenderContext,
  slot: string
): AuthorizedEffectInput {
  const value = context.inputs[slot];
  if (value === undefined || Array.isArray(value)) {
    throw new TypeError(`Input slot ${slot} must contain exactly one binding.`);
  }
  return value as AuthorizedEffectInput;
}

function numericArray(value: unknown, expectedLength: number, label: string): readonly number[] {
  if (!Array.isArray(value) && !(value instanceof Uint8Array) && !(value instanceof Uint8ClampedArray)
    && !(value instanceof Float32Array) && !(value instanceof Float64Array)) {
    throw new TypeError(`${label} data must be a numeric array.`);
  }
  if (value.length !== expectedLength) {
    throw new RangeError(`${label} data length does not match its dimensions.`);
  }
  const data = value as ArrayLike<unknown>;
  for (let index = 0; index < data.length; index += 1) {
    if (typeof data[index] !== "number" || !Number.isFinite(data[index])) {
      throw new TypeError(`${label} data must contain only finite numbers.`);
    }
  }
  return Array.from(value as ArrayLike<number>);
}

function dimensions(value: unknown, label: string): { width: number; height: number; data: unknown } {
  if (typeof value !== "object" || value === null) throw new TypeError(`${label} binding is invalid.`);
  const record = value as Record<string, unknown>;
  if (!Number.isInteger(record.width) || !Number.isInteger(record.height)
    || (record.width as number) < 1 || (record.height as number) < 1) {
    throw new TypeError(`${label} dimensions must be positive integers.`);
  }
  return { width: record.width as number, height: record.height as number, data: record.data };
}

export function frameInput(context: ServerEffectRenderContext, slot = "source_frame"): RgbaFrame {
  const value = dimensions(singleBinding(context, slot).binding, slot);
  if (value.width !== context.width || value.height !== context.height) {
    throw new RangeError(`${slot} dimensions must match the server render context.`);
  }
  const expectedLength = value.width * value.height * 4;
  if ((value.data instanceof Uint8Array || value.data instanceof Uint8ClampedArray)
    && value.data.length !== expectedLength) {
    throw new RangeError(`${slot} data length does not match its dimensions.`);
  }
  const data = value.data instanceof Uint8Array || value.data instanceof Uint8ClampedArray
    ? value.data
    : numericArray(value.data, expectedLength, slot);
  if (data.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) {
    throw new RangeError(`${slot} must contain 8-bit RGBA channel values.`);
  }
  return {
    width: value.width,
    height: value.height,
    data
  };
}

export function depthInput(context: ServerEffectRenderContext, slot = "depth_field"): DepthField {
  const value = dimensions(singleBinding(context, slot).binding, slot);
  if (value.width !== context.width || value.height !== context.height) {
    throw new RangeError(`${slot} dimensions must match the server render context.`);
  }
  const data = numericArray(value.data, value.width * value.height, slot);
  if (data.some((entry) => entry < 0 || entry > 1)) {
    throw new RangeError(`${slot} values must be normalized to the range 0..1.`);
  }
  return { width: value.width, height: value.height, data };
}

export function assertMatchingDimensions(left: RgbaFrame, right: RgbaFrame | DepthField): void {
  if (left.width !== right.width || left.height !== right.height) {
    throw new RangeError("Bound frame dimensions must match.");
  }
}

export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function byte(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function hash(seed: number, x: number, y: number, channel = 0): number {
  let value = (Math.trunc(seed) ^ Math.imul(x + 0x9e37, 0x85ebca6b)
    ^ Math.imul(y + 0x7f4a, 0xc2b2ae35) ^ Math.imul(channel + 17, 0x27d4eb2f)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

function pixelOffset(frame: RgbaFrame, x: number, y: number): number {
  const safeX = Math.min(frame.width - 1, Math.max(0, x));
  const safeY = Math.min(frame.height - 1, Math.max(0, y));
  return (safeY * frame.width + safeX) * 4;
}

export function sampleNearest(frame: RgbaFrame, x: number, y: number): readonly number[] {
  const offset = pixelOffset(frame, Math.round(x), Math.round(y));
  return [frame.data[offset]!, frame.data[offset + 1]!, frame.data[offset + 2]!, frame.data[offset + 3]!];
}

export function sampleBilinear(frame: RgbaFrame, x: number, y: number): readonly number[] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const p00 = sampleNearest(frame, x0, y0);
  const p10 = sampleNearest(frame, x0 + 1, y0);
  const p01 = sampleNearest(frame, x0, y0 + 1);
  const p11 = sampleNearest(frame, x0 + 1, y0 + 1);
  return p00.map((entry, channel) => {
    const top = entry + (p10[channel]! - entry) * tx;
    const bottom = p01[channel]! + (p11[channel]! - p01[channel]!) * tx;
    return top + (bottom - top) * ty;
  });
}

export function mixPixel(base: readonly number[], effect: readonly number[], amount: number): readonly number[] {
  const mix = clamp(amount);
  return [
    byte(base[0]! + (effect[0]! - base[0]!) * mix),
    byte(base[1]! + (effect[1]! - base[1]!) * mix),
    byte(base[2]! + (effect[2]! - base[2]!) * mix),
    byte(base[3]! + (effect[3]! - base[3]!) * mix)
  ];
}

export function luminance(pixel: readonly number[]): number {
  return (pixel[0]! * 0.2126 + pixel[1]! * 0.7152 + pixel[2]! * 0.0722) / 255;
}

export function hsvToRgb(hue: number, saturation: number, value: number): readonly number[] {
  const normalizedHue = ((hue % 360) + 360) % 360;
  const chroma = value * saturation;
  const section = normalizedHue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const choices: readonly (readonly [number, number, number])[] = [
    [chroma, x, 0], [x, chroma, 0], [0, chroma, x],
    [0, x, chroma], [x, 0, chroma], [chroma, 0, x]
  ];
  const [red, green, blue] = choices[Math.floor(section) % 6]!;
  const match = value - chroma;
  return [(red + match) * 255, (green + match) * 255, (blue + match) * 255, 255];
}

export function frameResult(
  definition: EffectToolDefinition,
  frame: RgbaFrame,
  data: readonly number[] | Uint8Array | Uint8ClampedArray,
  warnings: readonly string[] = []
): EffectRenderResult<RgbaFrame> {
  return {
    kind: "frame",
    backendId: definition.primaryBackend.backendId,
    output: { width: frame.width, height: frame.height, data },
    degraded: false,
    warnings
  };
}

export function pixelAt(frame: RgbaFrame, x: number, y: number): readonly number[] {
  const offset = (y * frame.width + x) * 4;
  return [frame.data[offset]!, frame.data[offset + 1]!, frame.data[offset + 2]!, frame.data[offset + 3]!];
}

export function pushPixel(target: number[], pixel: readonly number[]): void {
  target.push(byte(pixel[0]!), byte(pixel[1]!), byte(pixel[2]!), byte(pixel[3]!));
}

export type Batch02Definition<Params extends JsonObject> = EffectToolDefinition<Params>;
