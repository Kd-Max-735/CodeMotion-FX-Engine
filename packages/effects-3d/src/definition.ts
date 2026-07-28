import type { EffectDefinition, JsonObject } from "@codemotion/core";
import type {
  EffectRenderContext,
  RenderOutput,
  TextureHandle
} from "@codemotion/renderer-api";
import {
  defaultTextExtrude3DParams,
  normalizeTextExtrude3DParams,
  renderTextExtrude3DPixels
} from "./runtime.js";
import { createTextExtrude3DWebGLPass, type TextExtrude3DWebGLPass } from "./shader.js";
import type {
  PixelSurface,
  TextExtrude3DEffectDefinition,
  TextExtrude3DPreset,
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
    masks: readonly [{
      readonly texture: TextureHandle;
      readonly mode: "add";
      readonly opacity: 1;
    }]
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

function parseSurface(value: unknown): PixelSurface | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!Number.isInteger(candidate.width) || !Number.isInteger(candidate.height)
    || typeof candidate.width !== "number" || typeof candidate.height !== "number"
    || !Array.isArray(candidate.data)) return undefined;
  return {
    width: candidate.width,
    height: candidate.height,
    data: new Uint8ClampedArray(candidate.data.filter((value): value is number => typeof value === "number")),
    colorSpace: candidate.colorSpace === "display-p3" || candidate.colorSpace === "linear-srgb"
      ? candidate.colorSpace : "srgb",
    alphaMode: candidate.alphaMode === "none" || candidate.alphaMode === "premultiplied"
      ? candidate.alphaMode : "straight"
  };
}

function frameOutput(surface: PixelSurface): RenderOutput {
  return {
    type: "frame",
    data: {
      effectId: "fx.text.textExtrude3D",
      width: surface.width,
      height: surface.height,
      colorSpace: surface.colorSpace,
      alphaMode: surface.alphaMode,
      degraded: true,
      degradation: "Deterministic Canvas2D/CPU layered extrusion",
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
      params: Object.freeze({ depth: 0.16, bevel: 0.04, material: "matte", light: "studio", rotationX: 12, rotationY: -18, perspective: 0.4, progress: 0.5 }),
      previewAsset: "./preview.html#T08-soft-studio"
    }),
    Object.freeze({
      presetId: "preset.t08.chrome-rim",
      effectId: "fx.text.textExtrude3D",
      version: "1.0.0",
      name: "Chrome Rim",
      tags: Object.freeze(["text", "3d", "metal", "p0"]),
      params: Object.freeze({ depth: 0.32, bevel: 0.08, material: "metal", light: "rim", rotationX: 18, rotationY: -28, perspective: 0.6, progress: 0.5 }),
      previewAsset: "./preview.html#T08-chrome-rim"
    }),
    Object.freeze({
      presetId: "preset.t08.glass-top",
      effectId: "fx.text.textExtrude3D",
      version: "1.0.0",
      name: "Glass Top",
      tags: Object.freeze(["text", "3d", "glass", "p0"]),
      params: Object.freeze({ depth: 0.48, bevel: 0.12, material: "glass", light: "top", rotationX: 26, rotationY: 34, perspective: 0.72, progress: 0.5 }),
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
    description: "Deterministic P0 text extrusion with geometry, material and directional-light shading.",
    tags: ["text", "3d", "extrude", "p0", "t08"],
    inputTypes: ["texture"],
    outputType: "texture",
    parameterSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["depth", "bevel", "material", "light", "rotationX", "rotationY", "perspective", "progress"],
      properties: {
        depth: { type: "number", default: defaults.depth, minimum: 0, maximum: 1, multipleOf: 0.01 },
        bevel: { type: "number", default: defaults.bevel, minimum: 0, maximum: 0.25, multipleOf: 0.01 },
        material: { type: "string", default: defaults.material, enum: ["matte", "metal", "glass"] },
        light: { type: "string", default: defaults.light, enum: ["studio", "rim", "top"] },
        rotationX: { type: "number", default: defaults.rotationX, minimum: -60, maximum: 60, multipleOf: 1 },
        rotationY: { type: "number", default: defaults.rotationY, minimum: -90, maximum: 90, multipleOf: 1 },
        perspective: { type: "number", default: defaults.perspective, minimum: 0, maximum: 1, multipleOf: 0.01 },
        progress: { type: "number", default: defaults.progress, minimum: 0, maximum: 1, multipleOf: 0.01 }
      },
      additionalProperties: false
    },
    uiSchema: {
      layout: "group",
      order: ["depth", "bevel", "material", "light", "rotationX", "rotationY", "perspective", "progress"],
      fields: {
        depth: { label: "Depth", control: "slider", unit: "ratio", keyframeable: true, performanceImpact: "high", nullBehavior: "use-default" },
        bevel: { label: "Bevel", control: "slider", unit: "ratio", keyframeable: true, performanceImpact: "medium", nullBehavior: "use-default" },
        material: { label: "Material", control: "select", keyframeable: false, performanceImpact: "low", nullBehavior: "use-default" },
        light: { label: "Light", control: "select", keyframeable: false, performanceImpact: "low", nullBehavior: "use-default" },
        rotationX: { label: "Rotation X", control: "slider", unit: "deg", keyframeable: true, performanceImpact: "low", nullBehavior: "use-default" },
        rotationY: { label: "Rotation Y", control: "slider", unit: "deg", keyframeable: true, performanceImpact: "low", nullBehavior: "use-default" },
        perspective: { label: "Perspective", control: "slider", unit: "ratio", keyframeable: true, performanceImpact: "low", nullBehavior: "use-default" },
        progress: { label: "Progress", control: "slider", unit: "ratio", keyframeable: true, performanceImpact: "medium", nullBehavior: "use-default" }
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
        ruleId: "t08.finite-bounds",
        message: "T08 numeric parameters are clamped to their declared finite bounds.",
        severity: "error",
        config: { action: "clamp" }
      },
      {
        ruleId: "t08.texture-mask-size",
        message: "Source and optional mask must have equal positive dimensions.",
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
      alt: "T08 deterministic extruded 3D text preview"
    }),
    alphaBehavior: "Treats source Alpha as glyph occupancy, preserves straight/premultiplied association, and RGB-zeros every transparent output pixel.",
    maskBehavior: "Applies the context mask after lighting; mask Alpha multiplies output Alpha without altering the source.",
    fallbackBehavior: "If the WebGL effect-stack seam is unavailable, a deterministic Canvas2D/CPU layered extrusion uses the same normalized geometry, material, light, quality, Alpha and mask rules; frame metadata declares degradation.",
    benchmarkBudgetMs: 35,
    migrationHandlers: Object.freeze([{
      fromVersion: "0.9.0",
      toVersion: "1.0.0",
      migrate(params: JsonObject): JsonObject {
        return { ...normalizeTextExtrude3DParams(params) };
      }
    }]),
    async render(context: EffectRenderContext): Promise<RenderOutput> {
      if (disposed) throw new Error("fx.text.textExtrude3D has been disposed.");
      const params = normalizeTextExtrude3DParams({
        ...context.params,
        progress: context.params.progress ?? Math.min(1, Math.max(0, context.time - Math.floor(context.time)))
      });
      if (context.renderer.backend === "webgl" && context.inputTextures[0] && hasEffectStack(context.renderer)) {
        const result = context.renderer.applyEffectStack(
          context.inputTextures[0],
          [createTextExtrude3DWebGLPass(params, context.quality)]
        );
        if (result.failures[0]) throw result.failures[0].error;
        const output = context.mask && hasMaskStack(context.renderer)
          ? context.renderer.applyMaskStack(result.output, [{ texture: context.mask, mode: "add", opacity: 1 }])
          : result.output;
        if (output.id !== result.output.id) context.renderer.releaseTexture(result.output);
        return { type: "texture", texture: output };
      }
      const source = parseSurface(context.data?.pixelSurface);
      if (!source) throw new Error("fx.text.textExtrude3D fallback requires data.pixelSurface.");
      const mask = parseSurface(context.data?.maskSurface);
      return frameOutput(renderTextExtrude3DPixels(source, { ...params }, {
        progress: params.progress,
        seed: context.seed,
        quality: context.quality,
        ...(mask ? { mask } : {})
      }));
    },
    renderPixels(
      source: PixelSurface,
      params: Readonly<Record<string, unknown>> = {},
      options: Partial<TextExtrude3DRenderOptions> = {}
    ) {
      if (disposed) throw new Error("fx.text.textExtrude3D has been disposed.");
      return renderTextExtrude3DPixels(source, params, options);
    },
    dispose(): void {
      disposed = true;
    }
  });
}

export const TEXT_EXTRUDE_3D = createTextExtrude3DEffect();
