import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ERROR_CODES, RENDERER_API_VERSION, type LayerDefinition } from "@codemotion/core";
import type { FrameContext, RendererAdapter, TextureDescriptor } from "@codemotion/renderer-api";
import {
  PIPELINE_VALIDATION_EFFECT,
  WEBGL_PIPELINE_VALIDATION_EFFECT,
  WebGLRendererAdapter,
  applyPixelMasks,
  compositePixelSurfaces,
  convertPixelSurface,
  executeValidationEffectStack,
  initializeFirstAvailableRenderer,
  type PixelSurface,
  type WebGLEffectPass
} from "../src/index.js";
import { FakeWebGL2Context } from "./fake-webgl.js";

const initialization = { width: 2, height: 2, colorSpace: "srgb" as const, quality: "preview" as const };
const frame: FrameContext = {
  time: 0,
  deltaTime: 1 / 30,
  frame: 0,
  fps: 30,
  width: 2,
  height: 2,
  seed: 42,
  quality: "preview",
  colorSpace: "srgb"
};
const descriptor: TextureDescriptor = {
  width: 2,
  height: 2,
  format: "rgba8",
  colorSpace: "srgb",
  samples: 1,
  usage: "intermediate"
};

function layer(color: string): LayerDefinition {
  const constant = <T extends string | number | { x: number; y: number; z: number }>(value: T) => ({ mode: "constant" as const, value });
  return {
    id: "layer",
    type: "shape",
    name: "Layer",
    visible: true,
    locked: false,
    solo: false,
    startTime: 0,
    endTime: 1,
    inPoint: 0,
    outPoint: 1,
    zIndex: 0,
    transform: {
      anchorPoint: constant({ x: 0, y: 0, z: 0 }),
      position: constant({ x: 0, y: 0, z: 0 }),
      scale: constant({ x: 1, y: 1, z: 1 }),
      rotation: constant({ x: 0, y: 0, z: 0 })
    },
    opacity: constant(1),
    blendMode: "normal",
    masks: [],
    effects: [],
    properties: { shapes: [], color }
  };
}

function fallbackAdapter(): RendererAdapter {
  let sequence = 0;
  return {
    id: "renderer.canvas-reference",
    backend: "canvas2d",
    apiVersion: RENDERER_API_VERSION,
    capabilities: {
      maxTextureSize: 4096,
      supportsAlpha: true,
      supportsFloatTextures: false,
      supportedColorSpaces: ["srgb"],
      supportedBlendModes: ["normal"]
    },
    initialize() {},
    createTexture(current) { return { id: `canvas.${++sequence}`, backend: "canvas2d", descriptor: current }; },
    releaseTexture() {},
    beginFrame() {},
    renderLayer() { return { type: "metadata", data: {} }; },
    composite(inputs) { return inputs[0]!; },
    endFrame() { return { type: "metadata", data: {} }; },
    dispose() {}
  };
}

function validationEffect(id: string): WebGLEffectPass {
  return { ...WEBGL_PIPELINE_VALIDATION_EFFECT, id };
}

function expectEachCreatedObjectDeletedOnce(created: readonly object[], deleted: readonly object[]): void {
  for (const object of created) expect(deleted.filter((candidate) => candidate === object)).toHaveLength(1);
}

describe("WebGL Renderer Adapter lifecycle", () => {
  it("implements the Renderer Adapter frame contract and releases each GPU resource once", () => {
    const gl = new FakeWebGL2Context();
    const adapter = new WebGLRendererAdapter({ contextFactory: () => gl });
    const contract: RendererAdapter = adapter;
    expect(contract.apiVersion).toBe(RENDERER_API_VERSION);
    adapter.initialize(initialization);
    adapter.beginFrame(frame);
    const rendered = adapter.renderLayer(layer("#ff804080"), frame);
    expect(rendered.type).toBe("texture");
    if (rendered.type !== "texture") throw new Error("Expected a texture output.");
    const second = adapter.createTexture(descriptor);
    const target = adapter.createTexture({ ...descriptor, usage: "output" });
    expect(adapter.composite([rendered.texture, second], { blendMode: "screen", opacity: 0.5, target }, frame)).toBe(target);
    expect(adapter.endFrame(frame)).toEqual({ type: "texture", texture: target });

    adapter.releaseTexture(second);
    adapter.releaseTexture(second);
    adapter.dispose();
    adapter.dispose();
    expect(gl.drawCalls).toBe(1);
    expect(gl.deletedTextures).toHaveLength(3);
    expect(gl.deletedFramebuffers).toHaveLength(3);
    expect(gl.deletedPrograms).toHaveLength(4);
    expectEachCreatedObjectDeletedOnce(gl.createdTextures, gl.deletedTextures);
    expectEachCreatedObjectDeletedOnce(gl.createdFramebuffers, gl.deletedFramebuffers);
  });

  it("uses explicit upload Alpha and color-space settings", () => {
    const gl = new FakeWebGL2Context();
    const adapter = new WebGLRendererAdapter({ contextFactory: () => gl });
    adapter.initialize(initialization);
    const texture = adapter.createTexture(descriptor);
    adapter.uploadTexture(texture, new Uint8Array([255, 128, 64, 128, 0, 0, 0, 0, 255, 255, 255, 255, 4, 8, 12, 255]), "straight");
    expect(gl.pixelStore.get(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)).toBe(false);
    expect(gl.pixelStore.get(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL)).toBe(gl.NONE);
    expect(gl.pixelStore.get(gl.UNPACK_ALIGNMENT)).toBe(1);
    expect([...(gl.lastUpload as Uint8Array)]).toEqual([128, 64, 32, 128, 0, 0, 0, 0, 255, 255, 255, 255, 4, 8, 12, 255]);
    adapter.dispose();
  });

  it("rejects every float format before allocating GPU objects when the extension is unavailable", () => {
    const gl = new FakeWebGL2Context();
    gl.supportsFloatTextures = false;
    const adapter = new WebGLRendererAdapter({ contextFactory: () => gl });
    adapter.initialize(initialization);
    for (const format of ["rgba16f", "rgba32f"] as const) {
      expect(() => adapter.createTexture({ ...descriptor, format })).toThrowError(
        expect.objectContaining({ code: ERROR_CODES.RENDERER_LIFECYCLE, details: { phase: "texture-format" } })
      );
    }
    const invalidDescriptors = [
      { ...descriptor, width: 0 },
      { ...descriptor, samples: 2 },
      { ...descriptor, colorSpace: "display-p3" as const },
      { ...descriptor, format: "invalid" as TextureDescriptor["format"] },
      { ...descriptor, usage: "invalid" as TextureDescriptor["usage"] }
    ];
    for (const invalid of invalidDescriptors) expect(() => adapter.createTexture(invalid)).toThrow();
    expect(gl.createdTextures).toHaveLength(0);
    expect(gl.createdFramebuffers).toHaveLength(0);
    expect(gl.deletedTextures).toHaveLength(0);
    expect(gl.deletedFramebuffers).toHaveLength(0);
    adapter.dispose();
    adapter.dispose();
    expect(gl.deletedTextures).toHaveLength(0);
    expect(gl.deletedFramebuffers).toHaveLength(0);
  });

  it.each([
    ["framebuffer allocation", (gl: FakeWebGL2Context) => { gl.failNextFramebufferCreation = true; }, 1, 0],
    ["texture initialization", (gl: FakeWebGL2Context) => { gl.throwNextTexImage2D = true; }, 1, 1],
    ["incomplete framebuffer", (gl: FakeWebGL2Context) => { gl.framebufferComplete = false; }, 1, 1]
  ] as const)("immediately owns and releases objects after %s failure", (_label, inject, textureCount, framebufferCount) => {
    const gl = new FakeWebGL2Context();
    const adapter = new WebGLRendererAdapter({ contextFactory: () => gl });
    adapter.initialize(initialization);
    inject(gl);
    expect(() => adapter.createTexture(descriptor)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.RENDERER_LIFECYCLE, details: { phase: "create-texture" } })
    );
    expect(gl.createdTextures).toHaveLength(textureCount);
    expect(gl.createdFramebuffers).toHaveLength(framebufferCount);
    expect(gl.deletedTextures).toHaveLength(textureCount);
    expect(gl.deletedFramebuffers).toHaveLength(framebufferCount);
    expectEachCreatedObjectDeletedOnce(gl.createdTextures, gl.deletedTextures);
    expectEachCreatedObjectDeletedOnce(gl.createdFramebuffers, gl.deletedFramebuffers);
    expect(gl.boundFramebuffer).toBeNull();
    expect([...gl.boundTextures.values()].every((texture) => texture === null)).toBe(true);
    adapter.dispose();
    adapter.dispose();
    expect(gl.deletedTextures).toHaveLength(textureCount);
    expect(gl.deletedFramebuffers).toHaveLength(framebufferCount);
  });

  it("does not register a failed allocation or consume its successful handle sequence", () => {
    const gl = new FakeWebGL2Context();
    const adapter = new WebGLRendererAdapter({ contextFactory: () => gl });
    adapter.initialize(initialization);
    gl.failNextFramebufferCreation = true;
    expect(() => adapter.createTexture(descriptor)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.RENDERER_LIFECYCLE })
    );
    const recovered = adapter.createTexture(descriptor);
    expect(recovered.id).toBe("renderer.webgl2.texture.1");
    adapter.releaseTexture(recovered);
    adapter.releaseTexture(recovered);
    adapter.dispose();
    adapter.dispose();
    expectEachCreatedObjectDeletedOnce(gl.createdTextures, gl.deletedTextures);
    expectEachCreatedObjectDeletedOnce(gl.createdFramebuffers, gl.deletedFramebuffers);
  });
});

describe("failure isolation and backend contract", () => {
  it("isolates a Shader failure and continues the effect stack", () => {
    const gl = new FakeWebGL2Context();
    const adapter = new WebGLRendererAdapter({ contextFactory: () => gl });
    adapter.initialize(initialization);
    adapter.beginFrame(frame);
    const source = adapter.createTexture(descriptor);
    const mask = adapter.createTexture({ ...descriptor, format: "alpha8", usage: "mask" });
    const secondMask = adapter.createTexture({ ...descriptor, format: "alpha8", usage: "mask" });
    const masked = adapter.applyMaskStack(source, [
      { texture: mask, mode: "add", opacity: 0.75 },
      { texture: secondMask, mode: "subtract", inverted: true, opacity: 0.5 }
    ]);
    const broken: WebGLEffectPass = {
      id: "internal.pipeline.broken-validation",
      fragmentSource: "INVALID_SHADER",
      catalogContribution: false
    };
    const result = adapter.applyEffectStack(masked, [broken, WEBGL_PIPELINE_VALIDATION_EFFECT]);
    expect(result.output.id).not.toBe(masked.id);
    expect(result.failures).toMatchObject([{
      effectId: broken.id,
      error: { code: ERROR_CODES.EFFECT_EXECUTION_FAILED }
    }]);
    expect(gl.drawCalls).toBe(4);
    adapter.endFrame(frame);
    adapter.dispose();
  });

  it("normalizes context creation/loss and falls back to the next Renderer Adapter", async () => {
    const unavailable = new WebGLRendererAdapter({ id: "renderer.webgl.unavailable", contextFactory: () => null });
    expect(() => unavailable.initialize(initialization)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.RENDERER_LIFECYCLE, details: { phase: "context-create" } })
    );

    const gl = new FakeWebGL2Context();
    const lost = new WebGLRendererAdapter({ contextFactory: () => gl });
    lost.initialize(initialization);
    gl.contextLost = true;
    expect(() => lost.beginFrame(frame)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.RENDERER_LIFECYCLE, details: { phase: "context-lost" } })
    );
    lost.dispose();

    const fallback = fallbackAdapter();
    const selected = await initializeFirstAvailableRenderer([
      new WebGLRendererAdapter({ id: "renderer.webgl.failed", contextFactory: () => null }),
      fallback
    ], initialization);
    expect(selected.adapter).toBe(fallback);
    expect(selected.failures).toMatchObject([{
      adapterId: "renderer.webgl.failed",
      backend: "webgl",
      error: { code: ERROR_CODES.RENDERER_LIFECYCLE }
    }]);
  });

  it.each([
    ["middle", ["A", "B", "C"], 2, 4],
    ["first", ["B", "C"], 1, 3],
    ["tail", ["A", "B"], 2, 2]
  ] as const)("isolates a one-shot draw error at the stack %s", (_position, ids, failingDraw, outputSequence) => {
    const gl = new FakeWebGL2Context();
    const adapter = new WebGLRendererAdapter({ contextFactory: () => gl });
    adapter.initialize(initialization);
    adapter.beginFrame(frame);
    const source = adapter.createTexture(descriptor);
    gl.injectDrawErrorOnce(failingDraw);
    const result = adapter.applyEffectStack(source, ids.map(validationEffect));

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      effectId: "B",
      error: { code: ERROR_CODES.EFFECT_EXECUTION_FAILED }
    });
    expect(result.output.id).toBe(`renderer.webgl2.texture.${outputSequence}`);
    const failedTarget = gl.createdTextures[failingDraw]!;
    expect(gl.deletedTextures.filter((texture) => texture === failedTarget)).toHaveLength(1);
    expect(gl.deletedFramebuffers.filter((framebuffer) => framebuffer === gl.createdFramebuffers[failingDraw])).toHaveLength(1);

    if (_position === "middle") expect(gl.drawInputTextures[2]).toBe(gl.drawInputTextures[1]);
    if (_position === "first") expect(gl.drawInputTextures[1]).toBe(gl.drawInputTextures[0]);
    expect(gl.boundFramebuffer).toBeNull();
    expect(gl.currentProgram).toBeNull();
    expect(gl.activeTextureUnit).toBe(gl.TEXTURE0);
    expect([...gl.boundTextures.values()].every((texture) => texture === null)).toBe(true);
    expect(gl.getError()).toBe(gl.NO_ERROR);

    adapter.endFrame(frame);
    adapter.dispose();
    adapter.dispose();
    expectEachCreatedObjectDeletedOnce(gl.createdTextures, gl.deletedTextures);
    expectEachCreatedObjectDeletedOnce(gl.createdFramebuffers, gl.deletedFramebuffers);
  });
});

describe("multi-backend pixels and Golden Frame", () => {
  it("normalizes straight/sRGB and premultiplied/linear inputs to the same contract", () => {
    const straight: PixelSurface = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([188, 137, 99, 128]),
      colorSpace: "srgb",
      alphaMode: "straight"
    };
    const normalized = convertPixelSurface(straight, "linear-srgb", "premultiplied");
    const alternate: PixelSurface = {
      width: 1,
      height: 1,
      data: normalized.data,
      colorSpace: "linear-srgb",
      alphaMode: "premultiplied"
    };
    expect(convertPixelSurface(alternate, "srgb", "straight").data).toEqual(straight.data);
  });

  it("matches the fixed Stage 3 RGBA Golden Frame", () => {
    const backdrop: PixelSurface = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 255, 255, 255, 255, 255, 0
      ]),
      colorSpace: "srgb",
      alphaMode: "straight"
    };
    const source: PixelSurface = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        255, 255, 255, 192, 255, 128, 0, 192,
        0, 255, 255, 192, 255, 0, 255, 192
      ]),
      colorSpace: "srgb",
      alphaMode: "straight"
    };
    const mask: PixelSurface = {
      width: 2,
      height: 2,
      data: new Uint8ClampedArray([
        0, 0, 0, 255, 0, 0, 0, 128,
        0, 0, 0, 0, 0, 0, 0, 64
      ]),
      colorSpace: "srgb",
      alphaMode: "straight"
    };
    const masked = applyPixelMasks(source, [{ surface: mask, mode: "add", opacity: 0.8 }]);
    const effected = executeValidationEffectStack(masked, [PIPELINE_VALIDATION_EFFECT]);
    const actual = compositePixelSurfaces(backdrop, effected, "screen", 0.75, "srgb", "premultiplied");
    const expected = JSON.parse(readFileSync(new URL("./fixtures/golden-frame.rgba.json", import.meta.url), "utf8")) as number[];
    expect([...actual.data]).toEqual(expected);
    expect(PIPELINE_VALIDATION_EFFECT.catalogContribution).toBe(false);
    expect(WEBGL_PIPELINE_VALIDATION_EFFECT.catalogContribution).toBe(false);
  });
});
