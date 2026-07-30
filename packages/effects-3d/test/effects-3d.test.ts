import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type {
  EffectDefinition,
  EffectInstance,
  JsonObject,
  NullLayer,
  TransformDefinition
} from "@codemotion/core";
import type {
  LayerRasterizationOutput,
  TemporalEffectRenderContext,
  TextureHandle
} from "@codemotion/renderer-api";
import { P0_EFFECTS, P0_EFFECTS_BY_ID } from "@codemotion/effects-2d";
import { WebGLRendererAdapter } from "@codemotion/renderer-webgl";
import { validateContract } from "@codemotion/schema";
import {
  resolveEffectTimeSample,
  resolveLayerTimeSample,
  resolveProjectTimeSample
} from "@codemotion/timeline";
import { FakeWebGL2Context } from "../../renderer-webgl/test/fake-webgl.js";
import {
  TEXT_EXTRUDE_3D,
  createTextExtrude3DEffect,
  createTextExtrude3DWebGLPass,
  createTextExtrusionGeometry,
  hashPixelSurface,
  makeTextExtrudeMask,
  makeTextExtrudeRasterFixture,
  normalizeTextExtrude3DParams,
  qualityLayerCount,
  type TextExtrude3DRasterInput
} from "../src/index.js";

const golden = JSON.parse(readFileSync(
  new URL("./fixtures/golden-frames.json", import.meta.url),
  "utf8"
)) as {
  schemaVersion: string;
  timeContractVersion: string;
  effectId: string;
  effectInstanceId: string;
  text: string;
  width: number;
  height: number;
  seed: number;
  quality: "final";
  duration: number;
  fps: number;
  frames: Record<string, string>;
};

const definitionKeys = [
  "schemaVersion", "effectId", "version", "displayName", "category", "description",
  "tags", "inputTypes", "outputType", "parameterSchema", "uiSchema", "defaultPreset",
  "renderBackends", "preferredBackend", "fallbackBackend", "deterministic", "supportsAlpha",
  "supportsMask", "supportsKeyframes", "supportsExpressions", "performanceClass",
  "qualityLevels", "validationRules", "migrations"
] as const;

const transform: TransformDefinition = {
  anchorPoint: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
  position: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
  scale: { mode: "constant", value: { x: 100, y: 100, z: 100 } },
  rotation: { mode: "constant", value: { x: 0, y: 0, z: 0 } }
};

function resolved(
  effectInstanceId: string,
  progress: number,
  duration = 1,
  fps = 30,
  projectStart = 0
) {
  const instance: EffectInstance = {
    id: effectInstanceId,
    effectId: TEXT_EXTRUDE_3D.effectId,
    version: TEXT_EXTRUDE_3D.version,
    enabled: true,
    startTime: 0,
    endTime: duration,
    mix: { mode: "constant", value: 1 },
    params: TEXT_EXTRUDE_3D.defaultPreset
  };
  const layer: NullLayer = {
    id: `layer.${effectInstanceId}`,
    type: "null",
    name: "T08 official time fixture",
    visible: true,
    locked: false,
    solo: false,
    startTime: projectStart + 17,
    endTime: projectStart + 17 + duration,
    inPoint: 0,
    outPoint: duration,
    zIndex: 0,
    transform,
    opacity: { mode: "constant", value: 1 },
    blendMode: "normal",
    masks: [],
    effects: [instance],
    properties: {}
  };
  const projectTime = layer.startTime + progress * duration;
  const project = resolveProjectTimeSample({
    projectTime,
    previousProjectTime: Math.max(layer.startTime, projectTime - 1 / fps),
    fps
  });
  const layerTime = resolveLayerTimeSample(layer, project);
  return {
    instance,
    layer,
    project,
    layerTime,
    effectTime: resolveEffectTimeSample(instance, layerTime, project, duration)
  } as const;
}

function fixture(
  text: string,
  instanceId: string,
  progress: number,
  duration = 1,
  fps = 30,
  projectStart = 0,
  width = 64,
  height = 36
) {
  const timing = resolved(instanceId, progress, duration, fps, projectStart);
  return {
    ...timing,
    textRaster: makeTextExtrudeRasterFixture(text, width, height, timing.layerTime)
  } as const;
}

function rasterOutput(input: TextExtrude3DRasterInput, texture: TextureHandle): LayerRasterizationOutput {
  return {
    texture,
    sourceKind: "text",
    contentBounds: { x: 0, y: 0, width: input.surface.width, height: input.surface.height },
    coveredPixelCount: input.surface.data.filter((_, index) => index % 4 === 3 && input.surface.data[index]! > 0).length,
    contentDigest: `${input.rasterInput.source.font.assetHash}:${input.rasterInput.source.text}`,
    alphaMode: "premultiplied",
    usedSolidFallback: false
  };
}

function fallbackContext(
  text: string,
  instanceId: string,
  progress: number,
  duration = 1,
  fps = 30,
  projectStart = 0
): TemporalEffectRenderContext {
  const current = fixture(text, instanceId, progress, duration, fps, projectStart);
  return {
    time: current.project.projectTime,
    deltaTime: current.project.deltaTime,
    frame: current.project.frame,
    fps: current.project.fps,
    width: current.textRaster.surface.width,
    height: current.textRaster.surface.height,
    seed: 20260729,
    quality: "final",
    colorSpace: "srgb",
    inputTextures: [],
    params: TEXT_EXTRUDE_3D.defaultPreset,
    data: { textRaster: current.textRaster },
    renderer: { backend: "canvas2d" } as TemporalEffectRenderContext["renderer"],
    timing: {
      frame: {
        time: current.project.projectTime,
        projectTime: current.project.projectTime,
        deltaTime: current.project.deltaTime,
        frame: current.project.frame,
        fps: current.project.fps,
        width: current.textRaster.surface.width,
        height: current.textRaster.surface.height,
        seed: 20260729,
        quality: "final",
        colorSpace: "srgb"
      },
      layerTime: current.layerTime,
      effectTime: current.effectTime
    }
  };
}

function contractView(): EffectDefinition {
  return Object.fromEntries(
    definitionKeys.map((key) => [key, TEXT_EXTRUDE_3D[key]])
  ) as unknown as EffectDefinition;
}

describe("Group 3 Stage 5R T08", () => {
  it("publishes the frozen definition as a RegisteredTemporalEffectDefinition", () => {
    expect(TEXT_EXTRUDE_3D.sourceId).toBe("T08");
    expect(TEXT_EXTRUDE_3D.effectId).toBe("fx.text.textExtrude3D");
    expect(TEXT_EXTRUDE_3D.version).toBe("1.0.0");
    expect(TEXT_EXTRUDE_3D.implementationOwner).toBe("Group 3");
    const validation = validateContract("EffectDefinition", contractView());
    expect(validation.valid).toBe(true);
    expect(validation.issues).toEqual([]);
  });

  it("removes progress from parameters and keeps schemas, defaults and three presets aligned", () => {
    const schema = TEXT_EXTRUDE_3D.parameterSchema as JsonObject;
    const required = schema.required as string[];
    const properties = schema.properties as JsonObject;
    const fields = TEXT_EXTRUDE_3D.uiSchema.fields as JsonObject;
    expect(required).toEqual(["depth", "bevel", "material", "light", "rotationX", "rotationY", "perspective"]);
    expect(Object.keys(properties)).toEqual(required);
    expect(Object.keys(fields)).toEqual(required);
    expect("progress" in TEXT_EXTRUDE_3D.defaultPreset).toBe(false);
    expect(TEXT_EXTRUDE_3D.presets).toHaveLength(3);
    for (const preset of TEXT_EXTRUDE_3D.presets) {
      expect(normalizeTextExtrude3DParams(preset.params)).toEqual(preset.params);
      expect("progress" in preset.params).toBe(false);
    }
  });

  it("is consumable from the sole frozen 40-item catalog with valid AI parameters and fallback metadata", () => {
    const catalogEntry = P0_EFFECTS_BY_ID.get("fx.text.textExtrude3D");
    expect(P0_EFFECTS).toHaveLength(40);
    expect(P0_EFFECTS[15]).toBe(catalogEntry);
    expect(catalogEntry).toMatchObject({
      sourceId: "T08",
      effectId: TEXT_EXTRUDE_3D.effectId,
      version: TEXT_EXTRUDE_3D.version,
      parameterSchema: TEXT_EXTRUDE_3D.parameterSchema,
      defaultPreset: TEXT_EXTRUDE_3D.defaultPreset,
      presets: TEXT_EXTRUDE_3D.presets,
      fallbackBackend: "canvas2d",
      fallbackBehavior: TEXT_EXTRUDE_3D.fallbackBehavior
    });
    if (!catalogEntry || catalogEntry.sourceId !== "T08") {
      throw new Error("T08 is missing from the frozen aggregate catalog.");
    }

    const validateParams = new Ajv2020({ allErrors: true, strict: true })
      .compile(catalogEntry.parameterSchema);
    expect(validateParams(catalogEntry.defaultPreset), JSON.stringify(validateParams.errors)).toBe(true);
    const schemaProperties = (catalogEntry.parameterSchema as JsonObject).properties as JsonObject;
    for (const [name, value] of Object.entries(catalogEntry.defaultPreset)) {
      expect((schemaProperties[name] as JsonObject).default, name).toBe(value);
    }
    for (const preset of catalogEntry.presets) {
      expect(preset.effectId).toBe(catalogEntry.effectId);
      expect(preset.version).toBe(catalogEntry.version);
      expect(validateParams(preset.params), `${preset.presetId}: ${JSON.stringify(validateParams.errors)}`).toBe(true);
    }
    expect(validateParams({
      ...catalogEntry.defaultPreset,
      depth: 0.29,
      material: "glass"
    }), JSON.stringify(validateParams.errors)).toBe(true);
    expect(validateParams({
      ...catalogEntry.defaultPreset,
      depth: 1.01,
      material: "unsupported"
    })).toBe(false);

    expect(catalogEntry.fallbackBehavior).toContain("degradation is explicit");
  });

  it("renders official resolveEffectTimeSample output directly and preserves both identities", async () => {
    const context = fallbackContext("立体", "instance.t08.official", 0.43, 7.3, 48, 111);
    const output = await TEXT_EXTRUDE_3D.render(context);
    expect(output.type).toBe("frame");
    if (output.type !== "frame") return;
    expect(output.data.contractVersion).toBe("1.1.0");
    expect(output.data.effectId).toBe(TEXT_EXTRUDE_3D.effectId);
    expect(output.data.effectInstanceId).toBe("instance.t08.official");
    expect(output.data.pixels).toBeInstanceOf(Array);
  });

  it("rejects missing time, wrong effectId, empty instance ID and inconsistent clocks", async () => {
    const current = fixture("FX", "instance.t08.identity", 0.5);
    expect(() => TEXT_EXTRUDE_3D.renderPixels(
      current.textRaster,
      {},
      undefined as never
    )).toThrow(/non-optional time/u);
    expect(() => TEXT_EXTRUDE_3D.renderPixels(current.textRaster, {}, {
      time: { ...current.effectTime, effectId: "fx.motion.fade" },
      seed: 1,
      quality: "draft"
    })).toThrow(/effectId/u);
    expect(() => TEXT_EXTRUDE_3D.renderPixels(current.textRaster, {}, {
      time: { ...current.effectTime, effectInstanceId: "" },
      seed: 1,
      quality: "draft"
    })).toThrow(/effectInstanceId/u);
    const context = fallbackContext("FX", "instance.t08.clock", 0.5);
    await expect(TEXT_EXTRUDE_3D.render({
      ...context,
      timing: { ...context.timing, frame: { ...context.timing.frame, projectTime: 999 } }
    })).rejects.toThrow(/clocks/u);
  });

  it("requires real non-empty glyph coverage and rejects generic pixel impersonation", async () => {
    const current = fixture("AΩ", "instance.t08.raster", 0.5);
    expect(() => TEXT_EXTRUDE_3D.renderPixels(
      current.textRaster.surface as never,
      {},
      { time: current.effectTime, seed: 1, quality: "draft" }
    )).toThrow(/real TextRasterSource|rasterInput/u);
    const emptyGlyphs = {
      ...current.textRaster,
      rasterInput: {
        ...current.textRaster.rasterInput,
        source: { ...current.textRaster.rasterInput.source, glyphs: [] }
      }
    } as never;
    expect(() => TEXT_EXTRUDE_3D.renderPixels(emptyGlyphs, {}, {
      time: current.effectTime, seed: 1, quality: "draft"
    })).toThrow(/rasterized glyph/u);
    const missing = fallbackContext("FX", "instance.t08.missing", 0.5);
    await expect(TEXT_EXTRUDE_3D.render({ ...missing, data: {} })).rejects.toThrow(/data.textRaster/u);
  });

  it("uses different reviewed Unicode glyph rasters", () => {
    const hashes = ["FX", "立体", "AΩ"].map((text, index) => {
      const current = fixture(text, `instance.t08.unicode.${index}`, 0.6);
      return hashPixelSurface(TEXT_EXTRUDE_3D.renderPixels(current.textRaster, {}, {
        time: current.effectTime,
        seed: 5,
        quality: "final"
      }));
    });
    expect(new Set(hashes).size).toBe(3);
  });

  it("is invariant at equal effect-local progress across arbitrary duration, FPS and project translation", () => {
    const cases = [
      fixture("立体", "instance.t08.invariant", 0.37, 0.8, 24, 0),
      fixture("立体", "instance.t08.invariant", 0.37, 11.75, 60, 300),
      fixture("立体", "instance.t08.invariant", 0.37, 3.2, 120, 9000)
    ];
    const hashes = cases.map((current) => hashPixelSurface(TEXT_EXTRUDE_3D.renderPixels(
      current.textRaster,
      TEXT_EXTRUDE_3D.defaultPreset,
      { time: current.effectTime, seed: 17, quality: "final" }
    )));
    expect(new Set(hashes).size).toBe(1);
  });

  it("keeps same-type instances explicit and three-run deterministic", async () => {
    const contexts = [
      fallbackContext("FX", "instance.t08.A", 0.61, 5, 50),
      fallbackContext("FX", "instance.t08.B", 0.61, 5, 50)
    ];
    for (const context of contexts) {
      const outputs = await Promise.all(Array.from({ length: 3 }, () => TEXT_EXTRUDE_3D.render(context)));
      expect(outputs.every((output) => output.type === "frame")).toBe(true);
      const frames = outputs.filter((output) => output.type === "frame");
      expect(new Set(frames.map((output) => JSON.stringify(output.data.pixels))).size).toBe(1);
      expect(frames[0]!.data.effectInstanceId).toBe(context.timing.effectTime.effectInstanceId);
    }
  });

  it("builds actual indexed front/back/side glyph geometry at three quality grades", () => {
    const current = fixture("立体", "instance.t08.geometry", 0.5);
    const params = normalizeTextExtrude3DParams(TEXT_EXTRUDE_3D.defaultPreset);
    const draft = createTextExtrusionGeometry(current.textRaster, params, "draft");
    const preview = createTextExtrusionGeometry(current.textRaster, params, "preview");
    const final = createTextExtrusionGeometry(current.textRaster, params, "final");
    expect(draft.occupiedCells).toBeGreaterThan(0);
    expect(preview.occupiedCells).toBeGreaterThan(draft.occupiedCells);
    expect(final.occupiedCells).toBeGreaterThan(preview.occupiedCells);
    expect(final.vertices.length).toBeGreaterThan(0);
    expect(final.indices.length).toBe((final.frontTriangles + final.sideTriangles) * 3);
    expect(final.indices.length % 3).toBe(0);
    expect(qualityLayerCount("draft")).toBe(6);
    expect(qualityLayerCount("preview")).toBe(12);
    expect(qualityLayerCount("final")).toBe(24);
  });

  it("makes every declared parameter observably affect rendered output", () => {
    const current = fixture("立体", "instance.t08.params", 0.73);
    const candidates: Readonly<Record<string, unknown>> = {
      depth: 0.8,
      bevel: 0.22,
      material: "glass",
      light: "top",
      rotationX: -52,
      rotationY: 73,
      perspective: 0.95
    };
    const baseline = hashPixelSurface(TEXT_EXTRUDE_3D.renderPixels(
      current.textRaster,
      TEXT_EXTRUDE_3D.defaultPreset,
      { time: current.effectTime, seed: 19, quality: "final" }
    ));
    for (const [name, value] of Object.entries(candidates)) {
      const changed = hashPixelSurface(TEXT_EXTRUDE_3D.renderPixels(
        current.textRaster,
        { ...TEXT_EXTRUDE_3D.defaultPreset, [name]: value },
        { time: current.effectTime, seed: 19, quality: "final" }
      ));
      expect(changed, name).not.toBe(baseline);
    }
  });

  it("locks official-time 0/25/50/75/100% Golden Frames", () => {
    expect(golden.timeContractVersion).toBe("1.1.0");
    expect(new Set(Object.keys(golden.frames))).toEqual(new Set(["0", "0.25", "0.5", "0.75", "1"]));
    const actual = new Set<string>();
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const current = fixture(
        golden.text,
        golden.effectInstanceId,
        progress,
        golden.duration,
        golden.fps,
        73,
        golden.width,
        golden.height
      );
      const hash = hashPixelSurface(TEXT_EXTRUDE_3D.renderPixels(
        current.textRaster,
        TEXT_EXTRUDE_3D.defaultPreset,
        { time: current.effectTime, seed: golden.seed, quality: golden.quality }
      ));
      expect(hash, `T08@${progress}`).toBe(golden.frames[String(progress)]);
      actual.add(hash);
    }
    expect(actual.size).toBe(5);
  });

  it("preserves premultiplied Alpha and obeys a zero mask", () => {
    const current = fixture("AΩ", "instance.t08.alpha", 0.5, 2.4, 48, 0, 40, 24);
    const output = TEXT_EXTRUDE_3D.renderPixels(current.textRaster, {}, {
      time: current.effectTime, seed: 7, quality: "final"
    });
    for (let offset = 0; offset < output.data.length; offset += 4) {
      const alpha = output.data[offset + 3]!;
      expect(output.data[offset]).toBeLessThanOrEqual(alpha);
      expect(output.data[offset + 1]).toBeLessThanOrEqual(alpha);
      expect(output.data[offset + 2]).toBeLessThanOrEqual(alpha);
      if (alpha === 0) expect(output.data.slice(offset, offset + 3)).toEqual(new Uint8ClampedArray(3));
    }
    const masked = TEXT_EXTRUDE_3D.renderPixels(current.textRaster, {}, {
      time: current.effectTime,
      seed: 7,
      quality: "final",
      mask: makeTextExtrudeMask(40, 24, 0)
    });
    expect(masked.data.every((byte) => byte === 0)).toBe(true);
  });

  it("keeps straight/premultiplied physical Alpha equivalent and preserves color-space provenance", () => {
    const spaces = ["srgb", "linear-srgb", "display-p3"] as const;
    for (const colorSpace of spaces) {
      const timing = resolved(`instance.t08.color.${colorSpace}`, 0.55);
      const premultiplied = makeTextExtrudeRasterFixture(
        "AΩ", 40, 24, timing.layerTime, colorSpace
      );
      const straightData = new Uint8ClampedArray(premultiplied.surface.data);
      for (let offset = 0; offset < straightData.length; offset += 4) {
        const alpha = straightData[offset + 3]! / 255;
        if (alpha > 0) {
          straightData[offset] = Math.round(straightData[offset]! / alpha);
          straightData[offset + 1] = Math.round(straightData[offset + 1]! / alpha);
          straightData[offset + 2] = Math.round(straightData[offset + 2]! / alpha);
        }
      }
      const straight = {
        ...premultiplied,
        surface: {
          ...premultiplied.surface,
          data: straightData,
          alphaMode: "straight" as const
        }
      };
      const options = { time: timing.effectTime, seed: 3, quality: "final" as const };
      const associatedOutput = TEXT_EXTRUDE_3D.renderPixels(premultiplied, {}, options);
      const straightOutput = TEXT_EXTRUDE_3D.renderPixels(straight, {}, options);
      expect(associatedOutput.colorSpace).toBe(colorSpace);
      expect(straightOutput.colorSpace).toBe(colorSpace);
      for (let offset = 0; offset < associatedOutput.data.length; offset += 4) {
        const alpha = straightOutput.data[offset + 3]! / 255;
        expect(Math.abs(associatedOutput.data[offset]! - Math.round(straightOutput.data[offset]! * alpha))).toBeLessThanOrEqual(2);
        expect(Math.abs(associatedOutput.data[offset + 1]! - Math.round(straightOutput.data[offset + 1]! * alpha))).toBeLessThanOrEqual(2);
        expect(Math.abs(associatedOutput.data[offset + 2]! - Math.round(straightOutput.data[offset + 2]! * alpha))).toBeLessThanOrEqual(2);
        expect(associatedOutput.data[offset + 3]).toBe(straightOutput.data[offset + 3]);
      }
    }
  });

  it("executes multiple sizes, seeds and all quality grades without hidden time defaults", () => {
    for (const [width, height] of [[32, 18], [64, 36], [96, 54]] as const) {
      const current = fixture("FX", `instance.t08.size.${width}`, 0.42, 9.1, 59, 2, width, height);
      const hashes = ["draft", "preview", "final"].map((quality) =>
        hashPixelSurface(TEXT_EXTRUDE_3D.renderPixels(current.textRaster, {}, {
          time: current.effectTime,
          seed: width + height,
          quality: quality as "draft" | "preview" | "final"
        }))
      );
      expect(hashes.every((hash) => hash !== "00000000")).toBe(true);
      const alternateSeed = hashPixelSurface(TEXT_EXTRUDE_3D.renderPixels(current.textRaster, {}, {
        time: current.effectTime,
        seed: width + height + 1,
        quality: "final"
      }));
      expect(alternateSeed).toBe(hashes[2]);
    }
  });

  it("clamps extreme values and remains deterministic across three executions", () => {
    const current = fixture("FX", "instance.t08.extreme", 0.75);
    const extremes = {
      depth: Number.POSITIVE_INFINITY,
      bevel: Number.NEGATIVE_INFINITY,
      material: "__invalid__",
      light: null,
      rotationX: Number.POSITIVE_INFINITY,
      rotationY: -9999,
      perspective: Number.NaN
    };
    expect(normalizeTextExtrude3DParams(extremes)).toEqual({
      ...TEXT_EXTRUDE_3D.defaultPreset,
      rotationY: -90
    });
    const hashes = Array.from({ length: 3 }, () => hashPixelSurface(TEXT_EXTRUDE_3D.renderPixels(
      current.textRaster,
      extremes,
      { time: current.effectTime, seed: 20260729, quality: "final" }
    )));
    expect(new Set(hashes).size).toBe(1);
  });

  it("executes the WebGL2 material/light path, mask and balanced resource release", async () => {
    const current = fixture("立体", "instance.t08.webgl", 0.5, 4, 30, 0, 32, 18);
    const gl = new FakeWebGL2Context();
    const adapter = new WebGLRendererAdapter({ contextFactory: () => gl });
    adapter.initialize({ width: 32, height: 18, colorSpace: "srgb", quality: "preview" });
    const source = adapter.createTexture(current.textRaster.rasterInput.target);
    const mask = adapter.createTexture({ ...current.textRaster.rasterInput.target, usage: "mask" });
    const frame = {
      time: current.project.projectTime,
      projectTime: current.project.projectTime,
      deltaTime: current.project.deltaTime,
      frame: current.project.frame,
      fps: current.project.fps,
      width: 32,
      height: 18,
      seed: 20260729,
      quality: "preview" as const,
      colorSpace: "srgb" as const
    };
    const context: TemporalEffectRenderContext = {
      ...frame,
      inputTextures: [source],
      params: TEXT_EXTRUDE_3D.defaultPreset,
      mask,
      renderer: adapter,
      data: {
        textRaster: current.textRaster,
        rasterOutput: rasterOutput(current.textRaster, source)
      },
      timing: { frame, layerTime: current.layerTime, effectTime: current.effectTime }
    };
    const geometry = createTextExtrusionGeometry(
      current.textRaster,
      normalizeTextExtrude3DParams(),
      "preview"
    );
    const pass = createTextExtrude3DWebGLPass(
      normalizeTextExtrude3DParams(),
      current.effectTime,
      "preview",
      geometry
    );
    expect(pass.vertexSource).toContain("a_position");
    expect(pass.geometryFragmentSource).toContain("v_normal");
    expect(pass.geometry.indices.length).toBeGreaterThan(0);
    expect(pass.fragmentSource).toContain("lightDirection");
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

  it("marks CPU degradation and makes dispose terminal", async () => {
    const effect = createTextExtrude3DEffect();
    const context = fallbackContext("FX", "instance.t08.dispose", 0.5);
    const output = await effect.render(context);
    expect(output.type).toBe("frame");
    if (output.type === "frame") expect(output.data.degradation).toContain("glyph-mesh");
    effect.dispose();
    expect(() => effect.renderPixels(
      fixture("FX", "instance.t08.disposed", 0.5).textRaster,
      {},
      { time: context.timing.effectTime, seed: 1, quality: "draft" }
    )).toThrow(/disposed/u);
    await expect(effect.render(context)).rejects.toThrow(/disposed/u);
  });

  it("publishes exactly 20 S5R evidence dimensions", () => {
    const matrix = JSON.parse(readFileSync(
      new URL("./fixtures/s5r-self-check.json", import.meta.url),
      "utf8"
    )) as {
      dimensions: string[];
      rows: Array<{ sourceId: string; checks: Record<string, { status: string }> }>;
      totals: { effects: number; dimensions: number; checks: number; passed: number };
    };
    expect(new Set(matrix.dimensions).size).toBe(20);
    expect(matrix.rows).toHaveLength(1);
    expect(matrix.rows[0]?.sourceId).toBe("T08");
    expect(Object.keys(matrix.rows[0]!.checks)).toEqual(matrix.dimensions);
    expect(Object.values(matrix.rows[0]!.checks).every((check) => check.status === "PASS")).toBe(true);
    expect(matrix.totals).toEqual({ effects: 1, dimensions: 20, checks: 20, passed: 20 });
    const webglGolden = JSON.parse(readFileSync(
      new URL("./fixtures/webgl-golden-frames.json", import.meta.url),
      "utf8"
    )) as { frames: Record<string, string>; resources: string };
    expect(new Set(Object.keys(webglGolden.frames))).toEqual(new Set(["0", "0.25", "0.5", "0.75", "1"]));
    expect(new Set(Object.values(webglGolden.frames)).size).toBe(5);
    expect(webglGolden.resources).toBe("balanced");
  });

  it("documents temporal/raster requirements, preview, performance and Stage 9 exclusions", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
    const preview = readFileSync(new URL("../preview.html", import.meta.url), "utf8");
    expect(TEXT_EXTRUDE_3D.performanceClass).toBe("heavy");
    expect(TEXT_EXTRUDE_3D.qualityLevels.map((level) => level.quality)).toEqual(["draft", "preview", "final"]);
    expect(readme).toContain("EffectTimeSample 1.1.0");
    expect(readme).toContain("TextRasterSource");
    expect(readme).toContain("no general scene graph");
    expect(changelog).toContain("Stage 5R");
    expect(preview).toContain("resolveEffectTimeSample");
    expect(preview).toContain("dataset.fingerprint");
  });
});
