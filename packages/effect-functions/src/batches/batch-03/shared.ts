import type {
  AuthorizedEffectInput,
  EffectBackendDefinition,
  EffectParameterValidationResult,
  EffectRenderResult,
  ServerEffectRenderContext
} from "../../types.js";

export const BATCH_03_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "codemotion-batch-03-cpu-v1",
  kind: "server-cpu",
  version: "1.0.0",
  deterministic: true
});

export const BATCH_03_REJECT_FALLBACK = Object.freeze({
  kind: "reject" as const,
  reason: "The deterministic batch-03 server implementation has no fidelity-equivalent fallback."
});

export const VALID_PARAMS: EffectParameterValidationResult = Object.freeze({ valid: true });

export const CLOSED_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false
});

export type EdgeMode = "clamp" | "mirror" | "wrap";

export interface RgbaFrame {
  readonly width: number;
  readonly height: number;
  readonly data: readonly number[] | Uint8Array | Uint8ClampedArray;
}

export type ParticlePrimitive = "disc" | "sprite" | "streak";

export interface ParticleTextureBuffer {
  readonly format: "codemotion-particle-buffer/v1";
  readonly width: number;
  readonly height: number;
  readonly time: number;
  readonly primitive: ParticlePrimitive;
  readonly count: number;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly sizes: Float32Array;
  readonly opacities: Float32Array;
  readonly colors: Uint8ClampedArray;
  readonly sourceComposite?: {
    readonly slot: string;
    readonly opacity: number;
    readonly mask?: Uint8Array;
  };
  readonly spriteSlot?: string;
  readonly glow?: number;
}

export function round(value: number, digits = 6): number {
  const scale = 10 ** digits;
  const result = Math.round(value * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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

function hashGrid(seed: number, x: number, y: number, z: number, stream: number): number {
  let value = Math.trunc(seed) ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495)
    ^ Math.imul(z, 0x6c8e9cf5) ^ Math.imul(stream + 1, 0x9e3779b1);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function smooth(value: number): number {
  return value * value * (3 - 2 * value);
}

function mix(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

export function valueNoise3d(
  seed: number,
  x: number,
  y: number,
  z: number,
  stream = 0
): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const tz = smooth(z - z0);
  const layer = (depth: number) => {
    const top = mix(hashGrid(seed, x0, y0, depth, stream), hashGrid(seed, x0 + 1, y0, depth, stream), tx);
    const bottom = mix(hashGrid(seed, x0, y0 + 1, depth, stream), hashGrid(seed, x0 + 1, y0 + 1, depth, stream), tx);
    return mix(top, bottom, ty);
  };
  return mix(layer(z0), layer(z0 + 1), tz) * 2 - 1;
}

export function fractalNoise3d(
  seed: number,
  x: number,
  y: number,
  z: number,
  octaves: number,
  stream = 0
): number {
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise3d(seed, x * frequency, y * frequency, z * frequency, stream + octave * 17) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / weight;
}

function singleBinding(context: ServerEffectRenderContext, slot: string): AuthorizedEffectInput | undefined {
  const value = context.inputs[slot];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) throw new TypeError(`Input slot ${slot} must contain exactly one binding.`);
  return value as AuthorizedEffectInput;
}

function frameRecord(value: unknown, slot: string): RgbaFrame {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Input slot ${slot} must bind an RGBA frame.`);
  }
  const frame = value as Record<string, unknown>;
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height)
    || (frame.width as number) < 1 || (frame.height as number) < 1) {
    throw new TypeError(`Input slot ${slot} has invalid frame dimensions.`);
  }
  const width = frame.width as number;
  const height = frame.height as number;
  const data = frame.data;
  if (!Array.isArray(data) && !(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) {
    throw new TypeError(`Input slot ${slot} must contain 8-bit RGBA data.`);
  }
  if (data.length !== width * height * 4) {
    throw new RangeError(`Input slot ${slot} RGBA length does not match its dimensions.`);
  }
  for (let index = 0; index < data.length; index += 1) {
    const channel = data[index];
    if (typeof channel !== "number" || !Number.isInteger(channel) || channel < 0 || channel > 255) {
      throw new RangeError(`Input slot ${slot} must contain only 8-bit RGBA channels.`);
    }
  }
  return { width, height, data };
}

export function rgbaInput(
  context: ServerEffectRenderContext,
  slot: string,
  required: boolean,
  matchContext = true
): RgbaFrame | undefined {
  const binding = singleBinding(context, slot);
  if (binding === undefined) {
    if (required) throw new TypeError(`Required input slot ${slot} is not bound.`);
    return undefined;
  }
  const frame = frameRecord(binding.binding, slot);
  if (matchContext && (frame.width !== context.width || frame.height !== context.height)) {
    throw new RangeError(`Input slot ${slot} dimensions must match the render context.`);
  }
  return frame;
}

function edgeCoordinate(value: number, size: number, edgeMode: EdgeMode): number {
  if (size <= 1) return 0;
  if (edgeMode === "clamp") return clamp(value, 0, size - 1);
  if (edgeMode === "wrap") {
    const wrapped = value % size;
    return wrapped < 0 ? wrapped + size : wrapped;
  }
  const period = (size - 1) * 2;
  const wrapped = ((value % period) + period) % period;
  return wrapped <= size - 1 ? wrapped : period - wrapped;
}

function pixel(frame: RgbaFrame, x: number, y: number, edgeMode: EdgeMode): readonly number[] {
  const safeX = Math.round(edgeCoordinate(x, frame.width, edgeMode));
  const safeY = Math.round(edgeCoordinate(y, frame.height, edgeMode));
  const offset = (safeY * frame.width + safeX) * 4;
  return [frame.data[offset]!, frame.data[offset + 1]!, frame.data[offset + 2]!, frame.data[offset + 3]!];
}

export function sampleBilinear(
  frame: RgbaFrame,
  x: number,
  y: number,
  edgeMode: EdgeMode = "clamp"
): readonly number[] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const topLeft = pixel(frame, x0, y0, edgeMode);
  const topRight = pixel(frame, x0 + 1, y0, edgeMode);
  const bottomLeft = pixel(frame, x0, y0 + 1, edgeMode);
  const bottomRight = pixel(frame, x0 + 1, y0 + 1, edgeMode);
  return topLeft.map((channel, index) => {
    const top = mix(channel, topRight[index]!, tx);
    const bottom = mix(bottomLeft[index]!, bottomRight[index]!, tx);
    return mix(top, bottom, ty);
  });
}

export function writePixel(target: Uint8ClampedArray, offset: number, pixelValue: readonly number[]): void {
  target[offset] = clamp(Math.round(pixelValue[0]!), 0, 255);
  target[offset + 1] = clamp(Math.round(pixelValue[1]!), 0, 255);
  target[offset + 2] = clamp(Math.round(pixelValue[2]!), 0, 255);
  target[offset + 3] = clamp(Math.round(pixelValue[3]!), 0, 255);
}

export function frameResult(
  context: ServerEffectRenderContext,
  data: Uint8ClampedArray,
  warnings: readonly string[] = []
): EffectRenderResult<RgbaFrame> {
  return {
    kind: "frame",
    backendId: context.backend.backendId,
    output: { width: context.width, height: context.height, data },
    degraded: false,
    warnings
  };
}

export function createParticleBuffer(
  context: ServerEffectRenderContext,
  count: number,
  primitive: ParticlePrimitive,
  options: Pick<ParticleTextureBuffer, "sourceComposite" | "spriteSlot" | "glow"> = {}
): ParticleTextureBuffer {
  const safeCount = Math.max(0, Math.floor(count));
  return {
    format: "codemotion-particle-buffer/v1",
    width: context.width,
    height: context.height,
    time: context.time,
    primitive,
    count: safeCount,
    positions: new Float32Array(safeCount * 2),
    velocities: new Float32Array(safeCount * 2),
    sizes: new Float32Array(safeCount),
    opacities: new Float32Array(safeCount),
    colors: new Uint8ClampedArray(safeCount * 4),
    ...options
  };
}

export function setParticle(
  buffer: ParticleTextureBuffer,
  index: number,
  values: {
    readonly x: number;
    readonly y: number;
    readonly vx: number;
    readonly vy: number;
    readonly size: number;
    readonly opacity: number;
    readonly color: readonly number[];
  }
): void {
  const vectorOffset = index * 2;
  const colorOffset = index * 4;
  buffer.positions[vectorOffset] = values.x;
  buffer.positions[vectorOffset + 1] = values.y;
  buffer.velocities[vectorOffset] = values.vx;
  buffer.velocities[vectorOffset + 1] = values.vy;
  buffer.sizes[index] = Math.max(0, values.size);
  buffer.opacities[index] = clamp(values.opacity, 0, 1);
  buffer.colors[colorOffset] = clamp(Math.round(values.color[0]!), 0, 255);
  buffer.colors[colorOffset + 1] = clamp(Math.round(values.color[1]!), 0, 255);
  buffer.colors[colorOffset + 2] = clamp(Math.round(values.color[2]!), 0, 255);
  buffer.colors[colorOffset + 3] = clamp(Math.round(values.color[3] ?? 255), 0, 255);
}

export function particleTextureResult(
  context: ServerEffectRenderContext,
  output: ParticleTextureBuffer,
  warnings: readonly string[] = []
): EffectRenderResult<ParticleTextureBuffer> {
  return {
    kind: "texture",
    backendId: context.backend.backendId,
    output,
    degraded: false,
    warnings
  };
}

export function opaquePixelIndices(frame: RgbaFrame): readonly number[] {
  const result: number[] = [];
  for (let pixelIndex = 0; pixelIndex < frame.width * frame.height; pixelIndex += 1) {
    if (frame.data[pixelIndex * 4 + 3]! > 0) result.push(pixelIndex);
  }
  if (result.length === 0) throw new RangeError("Authorized target image must contain at least one non-transparent pixel.");
  return result;
}

export function pixelAtIndex(frame: RgbaFrame, pixelIndex: number): readonly number[] {
  const offset = pixelIndex * 4;
  return [frame.data[offset]!, frame.data[offset + 1]!, frame.data[offset + 2]!, frame.data[offset + 3]!];
}
