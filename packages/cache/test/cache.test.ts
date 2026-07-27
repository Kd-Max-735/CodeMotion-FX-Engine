import { describe, expect, it } from "vitest";
import { ERROR_CODES, type ColorSpace, type RenderBackend, type RenderQuality } from "@codemotion/core";
import { createCacheKey, createRenderTextureKey, type CacheKeyDescriptor } from "../src/index.js";

function descriptor(): CacheKeyDescriptor {
  return {
    resourceHash: "sha256:asset",
    effectVersion: "1.2.3",
    parameterHash: "sha256:params",
    timeRange: { start: 0, end: 1 },
    width: 1920,
    height: 1080,
    quality: "preview",
    colorSpace: "srgb",
    seed: 42,
    backend: "webgl"
  };
}

describe("deterministic cache keys", () => {
  it("is stable across three runs and changes for every invalidation field", () => {
    const base = descriptor();
    const key = createCacheKey(base);
    expect([createCacheKey(base), createCacheKey(base), createCacheKey(base)]).toEqual([key, key, key]);
    const variants: CacheKeyDescriptor[] = [
      { ...base, resourceHash: "other" },
      { ...base, effectVersion: "2.0.0" },
      { ...base, parameterHash: "other" },
      { ...base, timeRange: { start: 1, end: 2 } },
      { ...base, width: 1280 },
      { ...base, height: 720 },
      { ...base, quality: "final" as RenderQuality },
      { ...base, colorSpace: "linear-srgb" as ColorSpace },
      { ...base, seed: 43 },
      { ...base, backend: "canvas2d" as RenderBackend }
    ];
    expect(new Set(variants.map(createCacheKey)).size).toBe(variants.length);
    expect(variants.every((variant) => createCacheKey(variant) !== key)).toBe(true);
  });

  it("uses every RenderTexture pool field and rejects invalid dimensions", () => {
    const texture = { width: 100, height: 50, format: "rgba8" as const, colorSpace: "srgb" as const, samples: 1, usage: "intermediate" as const };
    const key = createRenderTextureKey(texture);
    expect(createRenderTextureKey({ ...texture, width: 101 })).not.toBe(key);
    expect(createRenderTextureKey({ ...texture, height: 51 })).not.toBe(key);
    expect(createRenderTextureKey({ ...texture, format: "rgba16f" })).not.toBe(key);
    expect(createRenderTextureKey({ ...texture, colorSpace: "linear-srgb" })).not.toBe(key);
    expect(createRenderTextureKey({ ...texture, samples: 4 })).not.toBe(key);
    expect(createRenderTextureKey({ ...texture, usage: "mask" })).not.toBe(key);
    expect(() => createRenderTextureKey({ ...texture, width: 0 })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.CACHE_KEY_INVALID })
    );
  });
});
