import { describe, expect, it } from "vitest";
import { ERROR_CODES, RENDERER_API_VERSION, type RenderBackend } from "@codemotion/core";
import {
  assertRendererCompatibility,
  detectRendererCapabilities,
  selectRendererAdapter,
  type RendererAdapter,
  type RendererCapabilities
} from "../src/index.js";

function adapterWithVersion(
  apiVersion: string,
  overrides: { id?: string; backend?: RenderBackend; capabilities?: Partial<RendererCapabilities> } = {}
): RendererAdapter {
  return {
    id: overrides.id ?? "renderer.test",
    backend: overrides.backend ?? "canvas2d",
    apiVersion,
    capabilities: {
      maxTextureSize: 4096,
      supportsAlpha: true,
      supportsFloatTextures: false,
      supportedColorSpaces: ["srgb"],
      supportedBlendModes: ["normal"],
      ...overrides.capabilities
    },
    initialize() {},
    createTexture(descriptor) {
      return { id: "texture.test", backend: "canvas2d", descriptor };
    },
    releaseTexture() {},
    beginFrame() {},
    renderLayer() {
      return { type: "metadata", data: {} };
    },
    composite(_inputs, options) {
      if (options.target === undefined) throw new Error("Test adapter needs a target.");
      return options.target;
    },
    endFrame() {
      return { type: "metadata", data: {} };
    },
    dispose() {}
  };
}

describe("renderer API version contract", () => {
  it("accepts the current adapter API", () => {
    expect(() => assertRendererCompatibility(adapterWithVersion(RENDERER_API_VERSION))).not.toThrow();
  });

  it("rejects incompatible adapters with a stable error code", () => {
    expect(() => assertRendererCompatibility(adapterWithVersion("0.9.0"))).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.RENDERER_INCOMPATIBLE })
    );
  });
});

describe("renderer capability and fallback contracts", () => {
  const requirements = {
    width: 1920,
    height: 1080,
    requiresAlpha: true,
    requiresFloatTextures: true,
    colorSpace: "linear-srgb" as const,
    blendModes: ["normal", "screen"]
  };

  it("reports every missing capability without assuming a GPU backend", () => {
    expect(detectRendererCapabilities(adapterWithVersion(RENDERER_API_VERSION), requirements)).toEqual({
      adapterId: "renderer.test",
      backend: "canvas2d",
      supported: false,
      missing: ["floatTextures", "colorSpace:linear-srgb", "blendMode:screen"]
    });
  });

  it("selects a fully capable adapter in explicit backend order", () => {
    const incompatible = adapterWithVersion("0.9.0", { id: "old", backend: "webgl" });
    const canvas = adapterWithVersion(RENDERER_API_VERSION, { id: "canvas", backend: "canvas2d" });
    const webgl = adapterWithVersion(RENDERER_API_VERSION, {
      id: "webgl",
      backend: "webgl",
      capabilities: {
        supportsFloatTextures: true,
        supportedColorSpaces: ["srgb", "linear-srgb"],
        supportedBlendModes: ["normal", "screen"]
      }
    });
    expect(selectRendererAdapter([incompatible, canvas, webgl], requirements, {
      backendOrder: ["webgl", "canvas2d"], mode: "preview"
    })).toMatchObject({ adapter: { id: "webgl" }, degraded: false, report: { supported: true } });
  });

  it("requires explicit degradation and separate final-render approval", () => {
    const canvas = adapterWithVersion(RENDERER_API_VERSION, { id: "canvas" });
    expect(selectRendererAdapter([canvas], requirements, {
      backendOrder: ["canvas2d"], mode: "preview", allowDegraded: true
    })).toMatchObject({ adapter: { id: "canvas" }, degraded: true });
    expect(() => selectRendererAdapter([canvas], requirements, {
      backendOrder: ["canvas2d"], mode: "final", allowDegraded: true
    })).toThrowError(expect.objectContaining({ code: ERROR_CODES.RENDERER_CAPABILITY_UNAVAILABLE }));
    expect(selectRendererAdapter([canvas], requirements, {
      backendOrder: ["canvas2d"], mode: "final", allowDegraded: true, approveFinalDegradation: true
    })).toMatchObject({ degraded: true });
  });
});
