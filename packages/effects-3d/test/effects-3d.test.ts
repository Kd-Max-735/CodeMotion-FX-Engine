import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EffectDefinition, JsonObject } from "@codemotion/core";
import { validateContract } from "@codemotion/schema";
import { WebGLRendererAdapter } from "@codemotion/renderer-webgl";
import { verifyGroup3TextExtrudeInterface } from "../../effects-2d/src/index.js";
import { FakeWebGL2Context } from "../../renderer-webgl/test/fake-webgl.js";
import {
  TEXT_EXTRUDE_3D,
  createTextExtrude3DEffect,
  createTextExtrude3DWebGLPass,
  createTextExtrusionGeometry,
  hashPixelSurface,
  makeTextExtrudePreviewInput,
  normalizeTextExtrude3DParams,
  qualityLayerCount
} from "../src/index.js";

const golden = JSON.parse(readFileSync(
  new URL("./fixtures/golden-frames.json", import.meta.url),
  "utf8"
)) as {
  schemaVersion: string;
  effectId: string;
  width: number;
  height: number;
  seed: number;
  quality: "final";
  frames: Record<string, string>;
};

const definitionKeys = [
  "schemaVersion", "effectId", "version", "displayName", "category", "description",
  "tags", "inputTypes", "outputType", "parameterSchema", "uiSchema", "defaultPreset",
  "renderBackends", "preferredBackend", "fallbackBackend", "deterministic", "supportsAlpha",
  "supportsMask", "supportsKeyframes", "supportsExpressions", "performanceClass",
  "qualityLevels", "validationRules", "migrations"
] as const;

function contractView(): EffectDefinition {
  return Object.fromEntries(
    definitionKeys.map((key) => [key, TEXT_EXTRUDE_3D[key]])
  ) as unknown as EffectDefinition;
}

function zeroMask(width: number, height: number) {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb" as const,
    alphaMode: "straight" as const
  };
}

describe("Group 3 Stage 5 T08", () => {
  it("publishes one versioned definition on the frozen Group 2 seam", () => {
    expect(TEXT_EXTRUDE_3D.sourceId).toBe("T08");
    expect(TEXT_EXTRUDE_3D.effectId).toBe("fx.text.textExtrude3D");
    expect(TEXT_EXTRUDE_3D.version).toBe("1.0.0");
    expect(TEXT_EXTRUDE_3D.implementationOwner).toBe("Group 3");
    const validation = validateContract("EffectDefinition", contractView());
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(verifyGroup3TextExtrudeInterface(TEXT_EXTRUDE_3D)).toEqual({
      effectId: "fx.text.textExtrude3D",
      available: true,
      compatible: true,
      missing: []
    });
  });

  it("has constrained parameter/UI schemas, defaults and three valid presets", () => {
    const schema = TEXT_EXTRUDE_3D.parameterSchema as JsonObject;
    const required = schema.required as string[];
    const properties = schema.properties as JsonObject;
    const fields = TEXT_EXTRUDE_3D.uiSchema.fields as JsonObject;
    expect(required).toEqual(["depth", "bevel", "material", "light", "rotationX", "rotationY", "perspective", "progress"]);
    expect(Object.keys(properties)).toEqual(required);
    expect(Object.keys(fields)).toEqual(required);
    expect(TEXT_EXTRUDE_3D.presets).toHaveLength(3);
    expect(new Set(TEXT_EXTRUDE_3D.presets.map((preset) => preset.presetId)).size).toBe(3);
    for (const preset of TEXT_EXTRUDE_3D.presets) {
      expect(preset.effectId).toBe(TEXT_EXTRUDE_3D.effectId);
      expect(preset.version).toBe(TEXT_EXTRUDE_3D.version);
      expect(normalizeTextExtrude3DParams(preset.params)).toEqual(preset.params);
    }
  });

  it("builds bounded text geometry and scales detail by quality", () => {
    const source = makeTextExtrudePreviewInput(64, 36);
    const params = normalizeTextExtrude3DParams(TEXT_EXTRUDE_3D.defaultPreset);
    const draft = createTextExtrusionGeometry(source, params, "draft");
    const final = createTextExtrusionGeometry(source, params, "final");
    expect(draft.occupiedCells).toBeGreaterThan(0);
    expect(final.occupiedCells).toBeGreaterThan(draft.occupiedCells);
    expect(final.frontTriangles).toBe(final.occupiedCells * 4);
    expect(final.sideTriangles).toBeGreaterThan(0);
    expect(final.bounds[5]).toBe(params.depth);
    expect(qualityLayerCount("draft")).toBe(6);
    expect(qualityLayerCount("preview")).toBe(12);
    expect(qualityLayerCount("final")).toBe(24);
  });

  it("locks 0/25/50/75/100% Golden Frames", () => {
    const source = makeTextExtrudePreviewInput(golden.width, golden.height);
    expect(golden.schemaVersion).toBe("1.0.0");
    expect(golden.effectId).toBe(TEXT_EXTRUDE_3D.effectId);
    expect(new Set(Object.keys(golden.frames))).toEqual(new Set(["0", "0.25", "0.5", "0.75", "1"]));
    const actual = new Set<string>();
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const hash = hashPixelSurface(TEXT_EXTRUDE_3D.renderPixels(
        source,
        { ...TEXT_EXTRUDE_3D.defaultPreset, progress },
        { progress, seed: golden.seed, quality: golden.quality }
      ));
      expect(hash, `T08@${progress}`).toBe(golden.frames[String(progress)]);
      actual.add(hash);
    }
    expect(actual.size).toBe(5);
  });

  it("preserves transparent Alpha, premultiplied bounds and a zero mask", () => {
    const transparent = zeroMask(24, 14);
    const empty = TEXT_EXTRUDE_3D.renderPixels(transparent, TEXT_EXTRUDE_3D.defaultPreset, {
      progress: 0.5, seed: 7, quality: "draft"
    });
    expect(empty.data.every((byte) => byte === 0)).toBe(true);

    const source = makeTextExtrudePreviewInput(24, 14);
    const masked = TEXT_EXTRUDE_3D.renderPixels(source, TEXT_EXTRUDE_3D.defaultPreset, {
      progress: 0.5, seed: 7, quality: "draft", mask: zeroMask(24, 14)
    });
    expect(masked.data.every((byte) => byte === 0)).toBe(true);

    const premultiplied = { ...source, alphaMode: "premultiplied" as const };
    const premultipliedOutput = TEXT_EXTRUDE_3D.renderPixels(premultiplied, TEXT_EXTRUDE_3D.defaultPreset);
    for (let offset = 0; offset < premultipliedOutput.data.length; offset += 4) {
      const alpha = premultipliedOutput.data[offset + 3]!;
      expect(premultipliedOutput.data[offset]).toBeLessThanOrEqual(alpha);
      expect(premultipliedOutput.data[offset + 1]).toBeLessThanOrEqual(alpha);
      expect(premultipliedOutput.data[offset + 2]).toBeLessThanOrEqual(alpha);
    }
  });

  it("clamps extreme/null-like values and is identical across three runs", () => {
    const source = makeTextExtrudePreviewInput(32, 18);
    const extremes = {
      depth: Number.POSITIVE_INFINITY,
      bevel: Number.NEGATIVE_INFINITY,
      material: "__invalid__",
      light: null,
      rotationX: Number.POSITIVE_INFINITY,
      rotationY: -9999,
      perspective: Number.NaN,
      progress: 9999
    };
    const normalized = normalizeTextExtrude3DParams(extremes);
    expect(normalized).toEqual({
      ...TEXT_EXTRUDE_3D.defaultPreset,
      rotationY: -90,
      progress: 1
    });
    const hashes = Array.from({ length: 3 }, () => hashPixelSurface(TEXT_EXTRUDE_3D.renderPixels(
      source,
      extremes,
      { progress: 0.75, seed: 20260728, quality: "final" }
    )));
    expect(new Set(hashes).size).toBe(1);
  });

  it("declares and compiles the material/light WebGL2 path", () => {
    const params = normalizeTextExtrude3DParams(TEXT_EXTRUDE_3D.defaultPreset);
    const pass = createTextExtrude3DWebGLPass(params, "final");
    expect(pass.fragmentSource).toContain("#version 300 es");
    expect(pass.fragmentSource).toContain("shade(");
    expect(pass.fragmentSource).toContain("lightDirection");
    expect(pass.uniforms.u_samples).toBe(24);
    expect(pass.uniforms.u_depth).toBe(params.depth);
  });

  it("executes WebGL, applies a mask and releases every GPU allocation once", async () => {
    const gl = new FakeWebGL2Context();
    const adapter = new WebGLRendererAdapter({ contextFactory: () => gl });
    adapter.initialize({ width: 32, height: 18, colorSpace: "srgb", quality: "preview" });
    const descriptor = {
      width: 32,
      height: 18,
      format: "rgba8" as const,
      colorSpace: "srgb" as const,
      samples: 1,
      usage: "input" as const
    };
    const source = adapter.createTexture(descriptor);
    const mask = adapter.createTexture({ ...descriptor, usage: "mask" });
    const context = {
      time: 0.5,
      deltaTime: 1 / 30,
      frame: 15,
      fps: 30,
      width: 32,
      height: 18,
      seed: 20260728,
      quality: "preview" as const,
      colorSpace: "srgb" as const,
      inputTextures: [source],
      params: TEXT_EXTRUDE_3D.defaultPreset,
      mask,
      renderer: adapter
    };
    adapter.beginFrame(context);
    const output = await TEXT_EXTRUDE_3D.render(context);
    expect(output.type).toBe("texture");
    if (output.type === "texture") adapter.releaseTexture(output.texture);
    adapter.endFrame(context);
    adapter.releaseTexture(source);
    adapter.releaseTexture(mask);
    adapter.dispose();
    expect(gl.drawCalls).toBeGreaterThanOrEqual(2);
    for (const texture of gl.createdTextures) {
      expect(gl.deletedTextures.filter((deleted) => deleted === texture)).toHaveLength(1);
    }
    for (const framebuffer of gl.createdFramebuffers) {
      expect(gl.deletedFramebuffers.filter((deleted) => deleted === framebuffer)).toHaveLength(1);
    }
  });

  it("marks the Canvas2D/CPU fallback as degraded and disposes safely", async () => {
    const effect = createTextExtrude3DEffect();
    const source = makeTextExtrudePreviewInput(16, 9);
    const renderer = {
      backend: "canvas2d",
      id: "test-canvas",
      apiVersion: "1.1.0",
      capabilities: {
        maxTextureSize: 4096,
        supportsAlpha: true,
        supportsFloatTextures: false,
        supportedColorSpaces: ["srgb"],
        supportedBlendModes: ["normal"]
      }
    };
    const output = await effect.render({
      time: 0.5,
      deltaTime: 1 / 30,
      frame: 15,
      fps: 30,
      width: 16,
      height: 9,
      seed: 7,
      quality: "draft",
      colorSpace: "srgb",
      inputTextures: [],
      params: effect.defaultPreset,
      data: {
        pixelSurface: {
          ...source,
          data: Array.from(source.data)
        }
      },
      renderer
    } as never);
    expect(output.type).toBe("frame");
    if (output.type === "frame") {
      expect(output.data.degraded).toBe(true);
      expect(output.data.degradation).toContain("Canvas2D/CPU");
    }
    effect.dispose();
    expect(() => effect.renderPixels(source)).toThrow("disposed");
    await expect(effect.render({} as never)).rejects.toThrow("disposed");
  });

  it("documents preview, quality, performance and explicit Stage 9 exclusions", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    const preview = readFileSync(new URL("../preview.html", import.meta.url), "utf8");
    expect(TEXT_EXTRUDE_3D.performanceClass).toBe("heavy");
    expect(TEXT_EXTRUDE_3D.qualityLevels.map((level) => level.quality)).toEqual(["draft", "preview", "final"]);
    expect(TEXT_EXTRUDE_3D.benchmarkBudgetMs).toBeGreaterThan(0);
    expect(TEXT_EXTRUDE_3D.fallbackBehavior).toContain("degradation");
    expect(readme).toContain("fx.text.textExtrude3D");
    expect(readme).toContain("no general scene graph");
    expect(changelog).toContain("### T08");
    expect(preview).toContain("makeTextExtrudePreviewInput");
    expect(preview).toContain("dataset.fingerprint");
  });
});
