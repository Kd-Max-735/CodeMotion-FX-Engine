import type { JsonObject, JsonSchema } from "@codemotion/core";
import {
  P0_EFFECTS,
  createServerTextRasterSourceV1,
  normalizeEffectParams,
  rasterizeLayerInput,
  type EffectRuntimeOptions,
  type P0CatalogEffectDefinition,
  type PixelSurface
} from "@codemotion/effects-2d";
import {
  normalizeTextExtrude3DParams,
  type TextExtrude3DRasterInput
} from "@codemotion/effects-3d";
import type {
  AuthorizedEffectInput,
  EffectInputSlotDefinition,
  EffectPerformanceGrade,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "./types.js";
import { visualAnchorsFromPixels } from "./batches/batch-01/common.js";

interface ExistingIdentity {
  readonly toolName: string;
  readonly displayName: string;
}

export interface ExistingRasterBinding {
  readonly surface: PixelSurface;
  readonly rasterInput: EffectRuntimeOptions["rasterInput"];
}

export interface ExistingPathBinding {
  readonly path: string;
}

export interface ExistingMorphPathsBinding {
  readonly fromPath: string;
  readonly toPath: string;
}

export interface ExistingBrushBinding {
  readonly reference: string;
  readonly coverage: NonNullable<EffectRuntimeOptions["brushCoverage"]>;
}

const EXISTING_SERVER_CPU_BACKEND = Object.freeze({
  backendId: "effect-functions-existing-cpu-v1",
  kind: "server-cpu" as const,
  version: "1.0.0",
  deterministic: true
});

const IDENTITIES: Readonly<Record<string, ExistingIdentity>> = Object.freeze({
  "fx.motion.fade": { toolName: "fade", displayName: "淡入淡出" },
  "fx.motion.slide": { toolName: "slide", displayName: "方向划入" },
  "fx.motion.scalePop": { toolName: "scale_pop", displayName: "弹性缩放出现" },
  "fx.motion.rotateIn": { toolName: "rotate_in", displayName: "旋转进入" },
  "fx.motion.bounce": { toolName: "bounce", displayName: "重力弹跳" },
  "fx.motion.elastic": { toolName: "elastic", displayName: "阻尼弹性" },
  "fx.motion.float": { toolName: "float", displayName: "循环漂浮" },
  "fx.motion.shake": { toolName: "shake", displayName: "冲击震动" },
  "fx.text.typewriter": { toolName: "typewriter", displayName: "打字机显现" },
  "fx.text.characterCascade": { toolName: "character_cascade", displayName: "字符级联" },
  "fx.text.kineticTypography": { toolName: "kinetic_typography", displayName: "动感排版" },
  "fx.text.textPathReveal": { toolName: "text_path_reveal", displayName: "路径文字显现" },
  "fx.text.textMorph": { toolName: "text_morph", displayName: "文字变形" },
  "fx.text.scrambleDecode": { toolName: "scramble_decode", displayName: "乱码解码" },
  "fx.text.wordExplode": { toolName: "word_explode", displayName: "文字爆散" },
  "fx.text.textExtrude3D": { toolName: "text_extrude_3d", displayName: "三维文字挤出" },
  "fx.vector.pathTrim": { toolName: "path_trim", displayName: "路径修剪" },
  "fx.vector.pathMorph": { toolName: "path_morph", displayName: "路径变形" },
  "fx.vector.shapeRepeater": { toolName: "shape_repeater", displayName: "图形重复器" },
  "fx.vector.radialBurst": { toolName: "radial_burst", displayName: "径向爆发" },
  "fx.draw.handwriting": { toolName: "handwriting", displayName: "手写笔迹" },
  "fx.draw.brushReveal": { toolName: "brush_reveal", displayName: "笔刷显现" },
  "fx.draw.inkSpread": { toolName: "ink_spread", displayName: "墨水扩散" },
  "fx.draw.chalkStroke": { toolName: "chalk_stroke", displayName: "粉笔描边" },
  "fx.light.neonGlow": { toolName: "neon_glow", displayName: "霓虹发光" },
  "fx.light.scanBeam": { toolName: "scan_beam", displayName: "扫描光束" },
  "fx.light.lensFlare": { toolName: "lens_flare", displayName: "镜头光晕" },
  "fx.light.energyPulse": { toolName: "energy_pulse", displayName: "能量脉冲" },
  "fx.post.gaussianBlur": { toolName: "gaussian_blur", displayName: "高斯模糊" },
  "fx.post.directionalBlur": { toolName: "directional_blur", displayName: "方向模糊" },
  "fx.post.radialBlur": { toolName: "radial_blur", displayName: "径向模糊" },
  "fx.post.motionBlur": { toolName: "motion_blur", displayName: "运动模糊" },
  "fx.transition.wipe": { toolName: "wipe", displayName: "线性擦除" },
  "fx.transition.radialWipe": { toolName: "radial_wipe", displayName: "径向擦除" },
  "fx.transition.liquidWipe": { toolName: "liquid_wipe", displayName: "液态擦除" },
  "fx.transition.pixelDissolve": { toolName: "pixel_dissolve", displayName: "像素溶解" },
  "fx.composite.maskReveal": { toolName: "mask_reveal", displayName: "遮罩显现" },
  "fx.composite.trackMatte": { toolName: "track_matte", displayName: "轨道遮罩" },
  "fx.composite.blend": { toolName: "blend", displayName: "图层混合" },
  "fx.composite.displacementMap": { toolName: "displacement_map", displayName: "置换贴图" }
});

const RESOURCE_FIELDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "fx.text.textPathReveal": Object.freeze(["path"]),
  "fx.vector.pathMorph": Object.freeze(["fromPath", "toPath"]),
  "fx.draw.handwriting": Object.freeze(["path"]),
  "fx.draw.brushReveal": Object.freeze(["brushTexture"]),
  "fx.composite.maskReveal": Object.freeze(["mask"]),
  "fx.composite.trackMatte": Object.freeze(["matteLayer"]),
  "fx.composite.displacementMap": Object.freeze(["map"])
});

const ADAPTER_VERSIONS: Readonly<Record<string, string>> = Object.freeze({
  M01: "1.1.0",
  M05: "1.1.0",
  M07: "1.2.0",
  T02: "1.2.0",
  T03: "1.1.0",
  D02: "1.2.0",
  D01: "1.1.0",
  D03: "1.1.0",
  D04: "1.1.0",
  L04: "1.2.0"
});

function slot(
  name: string,
  kind: EffectInputSlotDefinition["kind"],
  description: string
): EffectInputSlotDefinition {
  return Object.freeze({ name, kind, required: true, cardinality: "one", description });
}

function inputSlots(effect: P0CatalogEffectDefinition): readonly EffectInputSlotDefinition[] {
  if (effect.sourceId === "T08") {
    return Object.freeze([slot("text_raster", "data", "Server-rasterized glyph geometry and pixels.")]);
  }
  if (effect.sourceId === "T02") {
    return Object.freeze([slot("source_image", "image", "Owner-authorized background image.")]);
  }
  if (effect.sourceId === "D01") {
    return Object.freeze([slot("source_image", "image", "Owner-authorized image receiving the handwriting overlay.")]);
  }
  if (effect.sourceId === "T03") {
    return Object.freeze([slot("source_image", "image", "Owner-authorized background image for kinetic text.")]);
  }
  if (effect.sourceId === "D03") {
    return Object.freeze([slot("source_image", "image", "Owner-authorized image receiving organic ink diffusion.")]);
  }
  if (effect.sourceId === "D02") {
    return Object.freeze([
      slot("source_frame", "image", "Owner-authorized starting image."),
      slot("target_frame", "image", "Owner-authorized target image revealed by the brush."),
      slot("brush_texture", "texture", "Server-derived brush bristle coverage.")
    ]);
  }
  const primary = effect.category === "text"
    ? slot("text_raster", "data", "Server-rasterized text layer and glyph coverage.")
    : effect.category === "vector" || effect.category === "draw"
      ? slot("vector_source", "data", "Server-rasterized vector or drawing source.")
      : effect.category === "light" || effect.category === "post"
        ? slot("source_frame", "image", "Owner-authorized decoded source frame.")
        : effect.category === "transition"
          ? slot("source_frame", "image", "Owner-authorized decoded source frame A.")
          : slot("source_layer", "data", "Server-resolved primary layer.");
  const slots: EffectInputSlotDefinition[] = [primary];
  if (effect.category === "transition") {
    slots.push(slot("target_frame", "image", "Owner-authorized decoded source frame B."));
  }
  if (effect.sourceId === "T04") slots.push(slot("motion_path", "data", "Server-bound text motion path."));
  if (effect.sourceId === "V02") slots.push(slot("morph_paths", "data", "Server-bound source and target vector paths."));
  if (effect.sourceId === "H01") slots.push(slot("mask_layer", "mask", "Owner-authorized reveal mask."));
  if (effect.sourceId === "H02") slots.push(slot("matte_layer", "mask", "Owner-authorized track matte."));
  if (effect.sourceId === "H03") slots.push(slot("overlay_layer", "image", "Owner-authorized overlay layer."));
  if (effect.sourceId === "H04") slots.push(slot("displacement_map", "texture", "Owner-authorized displacement map."));
  return Object.freeze(slots);
}

function withoutResourceFields(effectId: string, value: Readonly<JsonObject>): JsonObject {
  const excluded = new Set(RESOURCE_FIELDS[effectId] ?? []);
  return Object.fromEntries(Object.entries(value).filter(([name]) => !excluded.has(name))) as JsonObject;
}

function parameterSchema(effect: P0CatalogEffectDefinition): JsonSchema {
  const schema = structuredClone(effect.parameterSchema) as JsonObject;
  const properties = schema.properties as JsonObject;
  for (const name of RESOURCE_FIELDS[effect.effectId] ?? []) delete properties[name];
  if (effect.sourceId === "T02" || effect.sourceId === "T03" || effect.sourceId === "D01") {
    (properties.text as JsonObject).minLength = 1;
    (properties.color as JsonObject).pattern = "^#[0-9A-Fa-f]{6}$";
  }
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.filter((name) => typeof name === "string" && name in properties);
  }
  return schema as JsonSchema;
}

function singleBinding<T>(context: ServerEffectRenderContext, name: string): T {
  const input = context.inputs[name];
  if (input === undefined || Array.isArray(input)) {
    throw new TypeError(`Expected one server binding for ${name}.`);
  }
  return (input as AuthorizedEffectInput<T>).binding;
}

function rasterBinding(context: ServerEffectRenderContext, name: string): ExistingRasterBinding {
  const binding = singleBinding<ExistingRasterBinding>(context, name);
  if (typeof binding !== "object" || binding === null || !("surface" in binding) || !("rasterInput" in binding)) {
    throw new TypeError(`${name} must contain a server raster binding.`);
  }
  return binding;
}

function primarySlotName(effect: P0CatalogEffectDefinition): string {
  if (effect.sourceId === "T02") return "source_image";
  if (effect.sourceId === "D01") return "source_image";
  if (effect.sourceId === "T03") return "source_image";
  if (effect.sourceId === "D03") return "source_image";
  if (effect.sourceId === "D02") return "source_frame";
  if (effect.category === "text") return "text_raster";
  if (effect.category === "vector" || effect.category === "draw") return "vector_source";
  if (effect.category === "light" || effect.category === "post" || effect.category === "transition") {
    return "source_frame";
  }
  return "source_layer";
}

function characterCascadeBinding(
  context: ServerEffectRenderContext,
  params: Readonly<JsonObject>
): ExistingRasterBinding {
  const background = rasterBinding(context, "source_image");
  const source = createServerTextRasterSourceV1({
    text: params.text as string,
    fontFamily: params.fontFamily as "song" | "kai" | "sans",
    fontSize: params.fontSize as number,
    color: params.color as string,
    positionX: params.positionX as number,
    positionY: params.positionY as number,
    width: context.width,
    height: context.height
  });
  const layerId = `single-tool:character-cascade:${context.requestId}`;
  const rasterInput: EffectRuntimeOptions["rasterInput"] = Object.freeze({
    ...background.rasterInput,
    layerId,
    layerType: "text" as const,
    source,
    time: Object.freeze({ ...background.rasterInput.time, layerId })
  });
  return Object.freeze({ surface: rasterizeLayerInput(rasterInput), rasterInput });
}

function serverTextBinding(
  context: ServerEffectRenderContext,
  params: Readonly<JsonObject>,
  sourceId: "character-cascade" | "handwriting" | "kinetic-typography"
): ExistingRasterBinding {
  const background = rasterBinding(context, "source_image");
  const source = createServerTextRasterSourceV1({
    text: params.text as string,
    fontFamily: params.fontFamily as "song" | "kai" | "sans",
    fontSize: params.fontSize as number,
    color: params.color as string,
    positionX: params.positionX as number,
    positionY: params.positionY as number,
    width: context.width,
    height: context.height
  });
  const layerId = `single-tool:${sourceId}:${context.requestId}`;
  const rasterInput: EffectRuntimeOptions["rasterInput"] = Object.freeze({
    ...background.rasterInput,
    layerId,
    layerType: "text" as const,
    source,
    time: Object.freeze({ ...background.rasterInput.time, layerId })
  });
  return Object.freeze({ surface: rasterizeLayerInput(rasterInput), rasterInput });
}

function internalParams(
  effect: P0CatalogEffectDefinition,
  context: ServerEffectRenderContext,
  params: Readonly<JsonObject>
): JsonObject {
  const output: JsonObject = { ...params };
  if (effect.sourceId === "T04") output.path = singleBinding<ExistingPathBinding>(context, "motion_path").path;
  if (effect.sourceId === "V02") {
    const paths = singleBinding<ExistingMorphPathsBinding>(context, "morph_paths");
    output.fromPath = paths.fromPath;
    output.toPath = paths.toPath;
  }
  if (effect.sourceId === "D02") {
    output.brushTexture = singleBinding<ExistingBrushBinding>(context, "brush_texture").reference;
  }
  if (effect.sourceId === "L04" && params.centerMode !== "coordinates") {
    const source = rasterBinding(context, "source_frame").surface;
    const anchors = visualAnchorsFromPixels(source.width, source.height, source.data);
    output.center = params.centerMode === "brightest"
      ? [anchors.brightest.x, anchors.brightest.y]
      : [anchors.subject_center.x, anchors.subject_center.y];
  }
  if (effect.sourceId === "H01") output.mask = "context://mask";
  if (effect.sourceId === "H02") output.matteLayer = "context://secondary";
  if (effect.sourceId === "H04") output.map = "context://secondary";
  return output;
}

function effectTime(effectId: string, context: ServerEffectRenderContext) {
  return Object.freeze({
    contractVersion: "1.1.0" as const,
    effectId,
    effectInstanceId: `single-tool:${context.requestId}`,
    active: true,
    projectTime: context.time,
    layerTime: context.time,
    effectTime: context.time,
    progress: Math.min(1, Math.max(0, context.time)),
    deltaTime: context.deltaTime,
    fps: context.fps,
    frame: context.frame
  });
}

function secondarySlotName(effect: P0CatalogEffectDefinition): string | undefined {
  if (effect.sourceId === "D02") return "target_frame";
  if (effect.category === "transition") return "target_frame";
  if (effect.sourceId === "H01") return "mask_layer";
  if (effect.sourceId === "H02") return "matte_layer";
  if (effect.sourceId === "H03") return "overlay_layer";
  if (effect.sourceId === "H04") return "displacement_map";
  return undefined;
}

function grade(effect: P0CatalogEffectDefinition): EffectPerformanceGrade {
  return effect.performanceClass === "heavy" ? "heavy"
    : effect.performanceClass === "medium" ? "medium" : "light";
}

function createExistingAdapter(effect: P0CatalogEffectDefinition): EffectToolDefinition {
  const identity = IDENTITIES[effect.effectId];
  if (identity === undefined) throw new TypeError(`Missing existing effect identity for ${effect.effectId}.`);
  const defaults = Object.freeze(withoutResourceFields(effect.effectId, effect.defaultPreset));
  return Object.freeze({
    effectId: effect.effectId,
    toolName: identity.toolName,
    displayName: identity.displayName,
    version: ADAPTER_VERSIONS[effect.sourceId] ?? "1.0.0",
    category: effect.category,
    parameterSchema: parameterSchema(effect),
    defaults,
    presets: Object.freeze([Object.freeze({
      presetId: `existing.${effect.sourceId.toLowerCase()}.default`,
      displayName: `${identity.displayName} 默认`,
      params: defaults
    })]),
    inputSlots: inputSlots(effect),
    primaryBackend: EXISTING_SERVER_CPU_BACKEND,
    fallbackStrategy: Object.freeze({
      kind: "reject" as const,
      reason: "The existing deterministic CPU renderer is required by this adapter."
    }),
    performanceGrade: grade(effect),
    normalizeParams(params: Readonly<JsonObject>): JsonObject {
      const normalized = effect.sourceId === "T08"
        ? normalizeTextExtrude3DParams(params)
        : normalizeEffectParams(effect.effectId, params);
      return withoutResourceFields(effect.effectId, normalized as JsonObject);
    },
    validateParams: () => ({ valid: true as const }),
    render(context: ServerEffectRenderContext, params: Readonly<JsonObject>) {
      const time = effectTime(effect.effectId, context);
      const resolved = internalParams(effect, context, params);
      let output: PixelSurface;
      if (effect.sourceId === "T08") {
        const input = singleBinding<TextExtrude3DRasterInput>(context, "text_raster");
        output = effect.renderPixels(input, resolved, {
          time,
          seed: context.seed,
          quality: context.quality
        });
      } else {
        const primary = effect.sourceId === "T02"
          ? serverTextBinding(context, params, "character-cascade")
          : effect.sourceId === "T03"
            ? serverTextBinding(context, params, "kinetic-typography")
          : effect.sourceId === "D01"
            ? serverTextBinding(context, params, "handwriting")
          : rasterBinding(context, primarySlotName(effect));
        const secondaryName = secondarySlotName(effect);
        const secondary = secondaryName === undefined ? undefined : rasterBinding(context, secondaryName);
        const brush = effect.sourceId === "D02"
          ? singleBinding<ExistingBrushBinding>(context, "brush_texture") : undefined;
        output = effect.renderPixels(primary.surface, resolved, {
          time,
          seed: context.seed,
          quality: context.quality,
          rasterInput: primary.rasterInput,
          ...(secondary === undefined ? {} : {
            secondary: secondary.surface,
            secondaryRasterInput: secondary.rasterInput
          }),
          ...(brush === undefined ? {} : {
            brushCoverage: brush.coverage,
            brushAssetId: brush.reference
          })
        });
      }
      return {
        kind: "frame" as const,
        backendId: EXISTING_SERVER_CPU_BACKEND.backendId,
        output,
        degraded: false,
        warnings: Object.freeze([])
      };
    }
  });
}

export const EXISTING_EFFECT_TOOL_DEFINITIONS: readonly EffectToolDefinition[] = Object.freeze(
  P0_EFFECTS.map(createExistingAdapter)
);
