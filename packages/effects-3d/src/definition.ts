import type { EffectDefinition, JsonObject } from "@codemotion/core";
import {
  assertLayerRasterizationOutput,
  assertTemporalEffectContext,
  type LayerRasterizationOutput,
  type RenderOutput,
  type TemporalEffectRenderContext,
  type TextureHandle
} from "@codemotion/renderer-api";
import { createTextExtrusionGeometry } from "./geometry.js";
import {
  assertTextExtrude3DRasterInput,
  assertTextExtrude3DTime,
  defaultTextExtrude3DParams,
  normalizeTextExtrude3DParams,
  renderTextExtrude3DPixels
} from "./runtime.js";
import { createTextExtrude3DWebGLPass, type TextExtrude3DWebGLPass } from "./shader.js";
import type {
  PixelSurface,
  TextExtrude3DEffectDefinition,
  TextExtrude3DPreset,
  TextExtrude3DRasterInput,
  TextExtrude3DRenderOptions
} from "./types.js";

interface EffectStackRenderer {
  applyEffectStack(
    source: TextureHandle,
    effects: readonly TextExtrude3DWebGLPass[]
  ): { readonly output: TextureHandle; readonly failures: readonly { readonly error: Error }[] };
}

interface MaskStackRenderer {
  applyMaskStack(
    source: TextureHandle,
    masks: readonly [{ readonly texture: TextureHandle; readonly mode: "add"; readonly opacity: 1 }]
  ): TextureHandle;
}

function hasEffectStack(value: unknown): value is EffectStackRenderer {
  return typeof value === "object" && value !== null
    && "applyEffectStack" in value && typeof value.applyEffectStack === "function";
}

function hasMaskStack(value: unknown): value is MaskStackRenderer {
  return typeof value === "object" && value !== null
    && "applyMaskStack" in value && typeof value.applyMaskStack === "function";
}

function requireTextRaster(value: unknown): TextExtrude3DRasterInput {
  if (typeof value !== "object" || value === null
    || !("rasterInput" in value) || !("surface" in value)) {
    throw new TypeError("T08 requires data.textRaster with real glyph and raster provenance.");
  }
  const input = value as TextExtrude3DRasterInput;
  assertTextExtrude3DRasterInput(input);
  return input;
}

function requireRasterOutput(
  value: unknown,
  input: TextExtrude3DRasterInput,
  texture: TextureHandle
): LayerRasterizationOutput {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("T08 WebGL requires data.rasterOutput from the real text rasterizer.");
  }
  const output = value as LayerRasterizationOutput;
  assertLayerRasterizationOutput(input.rasterInput, output);
  if (output.texture.id !== texture.id || output.sourceKind !== "text") {
    throw new TypeError("T08 WebGL texture must be the declared real text raster output.");
  }
  return output;
}

function frameOutput(surface: PixelSurface, context: TemporalEffectRenderContext): RenderOutput {
  return {
    type: "frame",
    data: {
      effectId: context.timing.effectTime.effectId,
      effectInstanceId: context.timing.effectTime.effectInstanceId,
      contractVersion: context.timing.effectTime.contractVersion,
      width: surface.width,
      height: surface.height,
      colorSpace: surface.colorSpace,
      alphaMode: surface.alphaMode,
      degraded: true,
      degradation: "Deterministic Canvas2D/CPU glyph-mesh extrusion",
      pixels: Array.from(surface.data)
    }
  };
}

const PRESETS: readonly [TextExtrude3DPreset, TextExtrude3DPreset, TextExtrude3DPreset] =
  Object.freeze([
    Object.freeze({
      presetId: "preset.t08.soft-studio",
      effectId: "fx.text.textExtrude3D",
      version: "1.0.0",
      name: "Soft Studio",
      tags: Object.freeze(["text", "3d", "matte", "p0"]),
      params: Object.freeze({ depth: 0.16, bevel: 0.04, material: "matte", light: "studio", rotationX: 12, rotationY: -18, perspective: 0.4 }),
      previewAsset: "./preview.html#T08-soft-studio"
    }),
    Object.freeze({
      presetId: "preset.t08.chrome-rim",
      effectId: "fx.text.textExtrude3D",
      version: "1.0.0",
      name: "Chrome Rim",
      tags: Object.freeze(["text", "3d", "metal", "p0"]),
      params: Object.freeze({ depth: 0.32, bevel: 0.08, material: "metal", light: "rim", rotationX: 18, rotationY: -28, perspective: 0.6 }),
      previewAsset: "./preview.html#T08-chrome-rim"
    }),
    Object.freeze({
      presetId: "preset.t08.glass-top",
      effectId: "fx.text.textExtrude3D",
      version: "1.0.0",
      name: "Glass Top",
      tags: Object.freeze(["text", "3d", "glass", "p0"]),
      params: Object.freeze({ depth: 0.48, bevel: 0.12, material: "glass", light: "top", rotationX: 26, rotationY: 34, perspective: 0.72 }),
      previewAsset: "./preview.html#T08-glass-top"
    })
  ]);

function definitionFields(): EffectDefinition {
  const defaults = normalizeTextExtrude3DParams();
  return {
    schemaVersion: "1.0.0",
    effectId: "fx.text.textExtrude3D",
    version: "1.0.0",
    displayName: "Text Extrude 3D",
    category: "text",
    description: "Deterministic P0 extrusion of validated rasterized Unicode glyph geometry.",
    tags: ["text", "3d", "extrude", "p0", "t08", "temporal-1.1"],
    inputTypes: ["texture"],
    outputType: "texture",
    parameterSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["depth", "bevel", "material", "light", "rotationX", "rotationY", "perspective"],
      properties: {
        depth: { type: "number", default: defaults.depth, minimum: 0, maximum: 1, multipleOf: 0.01 },
        bevel: { type: "number", default: defaults.bevel, minimum: 0, maximum: 0.25, multipleOf: 0.01 },
        material: { type: "string", default: defaults.material, enum: ["matte", "metal", "glass"] },
        light: { type: "string", default: defaults.light, enum: ["studio", "rim", "top"] },
        rotationX: { type: "number", default: defaults.rotationX, minimum: -60, maximum: 60, multipleOf: 1 },
        rotationY: { type: "number", default: defaults.rotationY, minimum: -90, maximum: 90, multipleOf: 1 },
        perspective: { type: "number", default: defaults.perspective, minimum: 0, maximum: 1, multipleOf: 0.01 }
      },
      additionalProperties: false
    },
    uiSchema: {
      layout: "group",
      order: ["depth", "bevel", "material", "light", "rotationX", "rotationY", "perspective"],
      fields: {
        depth: { label: "Depth", control: "slider", unit: "ratio", keyframeable: true, performanceImpact: "high", nullBehavior: "use-default" },
        bevel: { label: "Bevel", control: "slider", unit: "ratio", keyframeable: true, performanceImpact: "medium", nullBehavior: "use-default" },
        material: { label: "Material", control: "select", keyframeable: false, performanceImpact: "low", nullBehavior: "use-default" },
        light: { label: "Light", control: "select", keyframeable: false, performanceImpact: "low", nullBehavior: "use-default" },
        rotationX: { label: "Rotation X", control: "slider", unit: "deg", keyframeable: true, performanceImpact: "low", nullBehavior: "use-default" },
        rotationY: { label: "Rotation Y", control: "slider", unit: "deg", keyframeable: true, performanceImpact: "low", nullBehavior: "use-default" },
        perspective: { label: "Perspective", control: "slider", unit: "ratio", keyframeable: true, performanceImpact: "low", nullBehavior: "use-default" }
      }
    },
    defaultPreset: defaultTextExtrude3DParams(),
    renderBackends: ["webgl", "canvas2d"],
    preferredBackend: "webgl",
    fallbackBackend: "canvas2d",
    deterministic: true,
    supportsAlpha: true,
    supportsMask: true,
    supportsKeyframes: true,
    supportsExpressions: true,
    performanceClass: "heavy",
    qualityLevels: [
      { quality: "draft", settings: { geometryStride: 3, extrusionLayers: 6 } },
      { quality: "preview", settings: { geometryStride: 2, extrusionLayers: 12 } },
      { quality: "final", settings: { geometryStride: 1, extrusionLayers: 24 } }
    ],
    validationRules: [
      {
        ruleId: "t08.temporal-identity",
        message: "Time contract 1.1 requires exact effectId and explicit effectInstanceId.",
        severity: "error",
        config: { action: "reject" }
      },
      {
        ruleId: "t08.real-text-raster",
        message: "Only validated TextRasterSource glyph coverage and matching raster output are accepted.",
        severity: "error",
        config: { action: "reject" }
      }
    ],
    migrations: [{ fromVersion: "0.9.0", toVersion: "1.0.0" }]
  };
}

export function createTextExtrude3DEffect(): TextExtrude3DEffectDefinition {
  let disposed = false;
  return Object.freeze({
    ...definitionFields(),
    sourceId: "T08",
    implementationOwner: "Group 3",
    presets: PRESETS,
    preview: Object.freeze({
      asset: "./preview.html#T08",
      width: 160,
      height: 90,
      frameProgress: 0.5,
      alt: "T08 Unicode glyph extrusion at official 50% effect time"
    }),
    alphaBehavior: "Consumes premultiplied text raster Alpha as glyph occupancy, shades unassociated color, then restores association and RGB-zeros transparent pixels.",
    maskBehavior: "Applies the context mask after geometry/material/light shading; mask Alpha multiplies output Alpha.",
    fallbackBehavior: "If WebGL is unavailable, deterministic CPU glyph-mesh extrusion consumes the same required EffectTimeSample 1.1 and TextRasterSource; degradation is explicit in frame metadata.",
    benchmarkBudgetMs: 35,
    migrationHandlers: Object.freeze([{
      fromVersion: "0.9.0",
      toVersion: "1.0.0",
      migrate(params: JsonObject): JsonObject {
        return { ...normalizeTextExtrude3DParams(params) };
      }
    }]),
    async render(context: TemporalEffectRenderContext): Promise<RenderOutput> {
      if (disposed) throw new Error("fx.text.textExtrude3D has been disposed.");
      assertTemporalEffectContext(context.timing);
      assertTextExtrude3DTime(context.timing.effectTime);
      const input = requireTextRaster(context.data?.textRaster);
      if (input.rasterInput.time !== context.timing.layerTime
        && (input.rasterInput.time.layerId !== context.timing.layerTime.layerId
          || input.rasterInput.time.localTime !== context.timing.layerTime.localTime)) {
        throw new TypeError("T08 text raster layer time must match the temporal render context.");
      }
      const params = normalizeTextExtrude3DParams(context.params);
      const geometry = createTextExtrusionGeometry(input, params, context.quality);
      if (context.renderer.backend === "webgl" && context.inputTextures[0] && hasEffectStack(context.renderer)) {
        requireRasterOutput(context.data?.rasterOutput, input, context.inputTextures[0]);
        const result = context.renderer.applyEffectStack(context.inputTextures[0], [
          createTextExtrude3DWebGLPass(params, context.timing.effectTime, context.quality, geometry)
        ]);
        if (result.failures[0]) throw result.failures[0].error;
        const output = context.mask && hasMaskStack(context.renderer)
          ? context.renderer.applyMaskStack(result.output, [{ texture: context.mask, mode: "add", opacity: 1 }])
          : result.output;
        if (output.id !== result.output.id) context.renderer.releaseTexture(result.output);
        return { type: "texture", texture: output };
      }
      const mask = context.data?.maskSurface as PixelSurface | undefined;
      return frameOutput(renderTextExtrude3DPixels(input, { ...params }, {
        time: context.timing.effectTime,
        seed: context.seed,
        quality: context.quality,
        ...(mask ? { mask } : {})
      }), context);
    },
    renderPixels(
      input: TextExtrude3DRasterInput,
      params: Readonly<Record<string, unknown>>,
      options: TextExtrude3DRenderOptions
    ) {
      if (disposed) throw new Error("fx.text.textExtrude3D has been disposed.");
      return renderTextExtrude3DPixels(input, params, options);
    },
    dispose(): void {
      disposed = true;
    }
  });
}

export const TEXT_EXTRUDE_3D = createTextExtrude3DEffect();
