import { EngineError, ERROR_CODES, type ColorSpace, type RenderBackend, type RenderQuality } from "@codemotion/core";
import type { TextureDescriptor } from "@codemotion/renderer-api";

export interface CacheKeyDescriptor {
  readonly resourceHash: string;
  readonly effectVersion: string;
  readonly parameterHash: string;
  readonly timeRange: { readonly start: number; readonly end: number } | "static";
  readonly width: number;
  readonly height: number;
  readonly quality: RenderQuality;
  readonly colorSpace: ColorSpace;
  readonly seed: number;
  readonly backend: RenderBackend;
}

function keyError(message: string): EngineError {
  return new EngineError(ERROR_CODES.CACHE_KEY_INVALID, message);
}

function field(name: string, value: string | number): string {
  const encoded = String(value);
  return `${name.length}:${name}${encoded.length}:${encoded}`;
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) throw keyError(`${name} must be a positive integer.`);
}

export function createCacheKey(descriptor: CacheKeyDescriptor): string {
  if ([descriptor.resourceHash, descriptor.effectVersion, descriptor.parameterHash].some((value) => value.length === 0)) {
    throw keyError("Cache hash and version fields must be non-empty.");
  }
  positiveInteger(descriptor.width, "width");
  positiveInteger(descriptor.height, "height");
  if (!Number.isInteger(descriptor.seed) || descriptor.seed < 0 || descriptor.seed > 0xffff_ffff) {
    throw keyError("seed must be an unsigned 32-bit integer.");
  }
  const time = descriptor.timeRange === "static"
    ? "static"
    : `${descriptor.timeRange.start}:${descriptor.timeRange.end}`;
  if (descriptor.timeRange !== "static"
    && (!Number.isFinite(descriptor.timeRange.start)
      || !Number.isFinite(descriptor.timeRange.end)
      || descriptor.timeRange.end < descriptor.timeRange.start)) {
    throw keyError("timeRange must contain finite ordered values.");
  }
  return [
    field("resourceHash", descriptor.resourceHash),
    field("effectVersion", descriptor.effectVersion),
    field("parameterHash", descriptor.parameterHash),
    field("timeRange", time),
    field("width", descriptor.width),
    field("height", descriptor.height),
    field("quality", descriptor.quality),
    field("colorSpace", descriptor.colorSpace),
    field("seed", descriptor.seed),
    field("backend", descriptor.backend)
  ].join("|");
}

export function createRenderTextureKey(descriptor: TextureDescriptor): string {
  positiveInteger(descriptor.width, "width");
  positiveInteger(descriptor.height, "height");
  if (!Number.isInteger(descriptor.samples) || descriptor.samples < 1) {
    throw keyError("samples must be a positive integer.");
  }
  return [
    field("width", descriptor.width),
    field("height", descriptor.height),
    field("format", descriptor.format),
    field("colorSpace", descriptor.colorSpace),
    field("samples", descriptor.samples),
    field("usage", descriptor.usage)
  ].join("|");
}
