import { describe, expect, it } from "vitest";
import { ERROR_CODES, RENDERER_API_VERSION } from "@codemotion/core";
import { assertRendererCompatibility, type RendererAdapter } from "../src/index.js";

function adapterWithVersion(apiVersion: string): RendererAdapter {
  return {
    id: "renderer.test",
    backend: "canvas2d",
    apiVersion,
    capabilities: {
      maxTextureSize: 4096,
      supportsAlpha: true,
      supportsFloatTextures: false,
      supportedColorSpaces: ["srgb"],
      supportedBlendModes: ["normal"]
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
