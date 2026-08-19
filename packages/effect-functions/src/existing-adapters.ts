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
import { visualAnchorsFromPixels, type VisualAnchorName } from "./batches/batch-01/common.js";

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
  T03: "1.2.0",
  D02: "1.3.0",
  D01: "1.1.0",
  D03: "1.1.0",
  D04: "2.0.0",
  L01: "2.0.0",
  L03: "1.1.0",
  L04: "1.3.0",
  H01: "2.0.0",
  C03: "2.0.0"
});

function slot(
  name: string,
  kind: EffectInputSlotDefinition["kind"],
  description: string
): EffectInputSlotDefinition {
  return Object.freeze({ name, kind, required: true, cardinality: "one", description });
}

function inputSlots(effect: P0CatalogEffectDefinition): readonly EffectInputSlotDefinition[] {
  if (effect.sourceId === "H01") {
    return Object.freeze([
      slot("source_frame", "image", "Owner-authorized bottom image or decoded video frame."),
      slot("target_frame", "image", "Owner-authorized target image or decoded video frame."),
      Object.freeze({
        name: "mask_layer",
        kind: "mask" as const,
        required: false,
        cardinality: "one" as const,
        description: "Optional owner-authorized custom reveal mask."
      })
    ]);
  }
  if (effect.sourceId === "D04") {
    return Object.freeze([
      slot("source_image", "image", "Owner-authorized image receiving the chalk effect."),
      slot("subject_mask", "mask", "Server-derived SAM3.1 mask for the requested visible target.")
    ]);
  }
  if (effect.sourceId === "L01") {
    return Object.freeze([
      slot("source_image", "image", "Owner-authorized image receiving object-scoped neon glow."),
      slot("subject_mask", "mask", "Server-derived SAM3.1 mask for the requested visible target.")
    ]);
  }
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
  if (effect.sourceId === "H01") {
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["progress", "feather", "invert", "shape", "motion", "centerX", "centerY", "rotation", "size"],
      properties: {
        progress: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 1 },
        feather: { type: "number", minimum: 0, maximum: 0.5, multipleOf: 0.005, default: 0.04 },
        invert: { type: "boolean", default: false },
        shape: { type: "string", enum: ["circle", "ellipse", "rectangle", "diamond", "triangle", "star", "custom"], default: "circle" },
        motion: { type: "string", enum: ["expand", "left_to_right", "right_to_left", "top_to_bottom", "bottom_to_top"], default: "expand" },
        centerX: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.5 },
        centerY: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.5 },
        rotation: { type: "number", minimum: -180, maximum: 180, multipleOf: 1, default: 0 },
        size: { type: "number", minimum: 0.1, maximum: 2, multipleOf: 0.01, default: 1 },
        duration: { type: "number", minimum: 0.2, maximum: 30, multipleOf: 0.1, default: 2 }
      }
    };
  }
  const schema = structuredClone(effect.parameterSchema) as JsonObject;
  const properties = schema.properties as JsonObject;
  for (const name of RESOURCE_FIELDS[effect.effectId] ?? []) delete properties[name];
  if (effect.sourceId === "D04") {
    properties.target = {
      type: "string",
      minLength: 1,
      maxLength: 80,
      pattern: "^[A-Za-z0-9][A-Za-z0-9 ,.'()/-]{0,79}$",
      default: "main subject"
    };
    properties.placement = { type: "string", enum: ["outline", "inside"], default: "outline" };
  }
  if (effect.sourceId === "L01") {
    properties.target = {
      type: "string",
      minLength: 1,
      maxLength: 80,
      pattern: "^[A-Za-z0-9][A-Za-z0-9 ,.'()/-]{0,79}$",
      default: "main subject"
    };
  }
  if (effect.sourceId === "C03") {
    properties.duration = { type: "number", minimum: 0.2, maximum: 30, multipleOf: 0.1, default: 2 };
  }
  if (effect.sourceId === "T02" || effect.sourceId === "T03" || effect.sourceId === "D01") {
    (properties.text as JsonObject).minLength = 1;
    (properties.color as JsonObject).pattern = "^#[0-9A-Fa-f]{6}$";
  }
  if (Array.isArray(schema.required)) {
    schema.required = schema.required.filter((name) => typeof name === "string" && name in properties);
    if (effect.sourceId === "D04") schema.required.push("target", "placement");
    if (effect.sourceId === "L01") schema.required.push("target");
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
  if (effect.sourceId === "D04") return "source_image";
  if (effect.sourceId === "L01") return "source_image";
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
    const anchor = anchors[params.centerMode as Exclude<VisualAnchorName, "coordinates">];
    output.center = [anchor.x, anchor.y];
  }
  if (effect.sourceId === "H01") output.mask = "context://mask";
  if (effect.sourceId === "H02") output.matteLayer = "context://secondary";
  if (effect.sourceId === "H04") output.map = "context://secondary";
  return output;
}

const MASK_REVEAL_DEFAULTS: Readonly<JsonObject> = Object.freeze({
  progress: 1,
  feather: 0.04,
  invert: false,
  shape: "circle",
  motion: "expand",
  centerX: 0.5,
  centerY: 0.5,
  rotation: 0,
  size: 1,
  duration: 2
});

function directMaskValues(context: ServerEffectRenderContext, name: string): Uint8Array {
  const binding = singleBinding<Record<string, unknown>>(context, name);
  const data = binding.data;
  if (binding.width === context.width && binding.height === context.height
    && (data instanceof Uint8Array || data instanceof Uint8ClampedArray)) {
    if (data.length === context.width * context.height) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (data.length === context.width * context.height * 4) {
      return Uint8Array.from({ length: context.width * context.height }, (_, index) => data[index * 4 + 3]!);
    }
  }
  throw new TypeError(`${name} must contain one decoded mask.`);
}

function chalkNoise(seed: number, x: number, y: number, salt: number): number {
  let value = Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + salt, 0xc2b2ae35) ^ seed;
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 0xffffffff;
}

function chalkColor(value: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(value);
  return match === null ? [244, 240, 223] : [
    Number.parseInt(match[1]!, 16),
    Number.parseInt(match[2]!, 16),
    Number.parseInt(match[3]!, 16)
  ];
}

function maskBoundaryDistances(mask: Uint8Array, width: number, height: number): Float32Array {
  const distances = new Float32Array(mask.length).fill(width + height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    const inside = mask[index]! >= 128;
    if ((x === 0 ? inside : (mask[index - 1]! >= 128) !== inside)
      || (x + 1 === width ? inside : (mask[index + 1]! >= 128) !== inside)
      || (y === 0 ? inside : (mask[index - width]! >= 128) !== inside)
      || (y + 1 === height ? inside : (mask[index + width]! >= 128) !== inside)) {
      distances[index] = 0;
    }
  }
  const diagonal = Math.SQRT2;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const index = y * width + x;
    if (x > 0) distances[index] = Math.min(distances[index]!, distances[index - 1]! + 1);
    if (y > 0) distances[index] = Math.min(distances[index]!, distances[index - width]! + 1);
    if (x > 0 && y > 0) distances[index] = Math.min(distances[index]!, distances[index - width - 1]! + diagonal);
    if (x + 1 < width && y > 0) distances[index] = Math.min(distances[index]!, distances[index - width + 1]! + diagonal);
  }
  for (let y = height - 1; y >= 0; y -= 1) for (let x = width - 1; x >= 0; x -= 1) {
    const index = y * width + x;
    if (x + 1 < width) distances[index] = Math.min(distances[index]!, distances[index + 1]! + 1);
    if (y + 1 < height) distances[index] = Math.min(distances[index]!, distances[index + width]! + 1);
    if (x + 1 < width && y + 1 < height) {
      distances[index] = Math.min(distances[index]!, distances[index + width + 1]! + diagonal);
    }
    if (x > 0 && y + 1 < height) {
      distances[index] = Math.min(distances[index]!, distances[index + width - 1]! + diagonal);
    }
  }
  return distances;
}

function chalkStrokeFrame(context: ServerEffectRenderContext, params: Readonly<JsonObject>): PixelSurface {
  const source = rasterBinding(context, "source_image").surface;
  const mask = directMaskValues(context, "subject_mask");
  const distances = maskBoundaryDistances(mask, context.width, context.height);
  const color = chalkColor(params.color as string);
  const opacity = params.opacity as number;
  const grain = params.grain as number;
  const scatter = params.scatter as number;
  const progress = Math.min(1, Math.max(0, context.time)) * (params.progress as number);
  const placement = params.placement as string;
  const radius = Math.max(1, (params.strokeWidth as number) * Math.min(context.width, context.height));
  const output = new Uint8ClampedArray(source.data);
  for (let y = 0; y < context.height; y += 1) for (let x = 0; x < context.width; x += 1) {
    const index = y * context.width + x;
    const reveal = x / Math.max(1, context.width - 1);
    if (reveal > progress + (chalkNoise(context.seed, x, y, 7) - 0.5) * scatter * 0.12) continue;
    const inside = mask[index]! / 255;
    const distance = distances[index]!;
    const body = placement === "inside" ? inside : Math.max(0, Math.min(1, radius + 1 - distance));
    const dustRange = radius * (1.5 + scatter * 3.5);
    const dust = placement === "outline" && distance > radius && distance <= dustRange
      && chalkNoise(context.seed, x, y, 29) > 1 - scatter * 0.42 ? 0.28 : 0;
    if (body <= 0 && dust <= 0) continue;
    const fine = chalkNoise(context.seed, x, y, 53);
    const coarse = chalkNoise(context.seed, Math.floor(x / 3), Math.floor(y / 3), 97);
    const pigment = fine > grain * 0.62 ? 1 : fine > grain * 0.3 ? 0.52 : 0.14;
    const alpha = Math.min(1, (body * pigment * (0.72 + coarse * 0.28) + dust) * opacity);
    const offset = index * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = Math.round(
        source.data[offset + channel]! * (1 - alpha) + color[channel]! * alpha
      );
    }
  }
  return { ...source, data: output };
}

function neonGlowFrame(context: ServerEffectRenderContext, params: Readonly<JsonObject>): PixelSurface {
  const source = rasterBinding(context, "source_image").surface;
  const intensity = params.intensity as number;
  if (intensity <= 0) return { ...source, data: new Uint8ClampedArray(source.data) };
  const mask = directMaskValues(context, "subject_mask");
  const distances = maskBoundaryDistances(mask, context.width, context.height);
  const color = chalkColor(params.color as string);
  const radius = Math.max(1, (params.radius as number) * Math.min(context.width, context.height));
  const flickerAmount = params.flicker as number;
  const flicker = Math.max(0.08, 1 - flickerAmount * (0.28 + 0.22 * Math.sin(
    context.time * Math.PI * 17 + context.seed * 0.0001
  )));
  const output = new Uint8ClampedArray(source.data);
  for (let index = 0; index < mask.length; index += 1) {
    const distance = distances[index]!;
    if (distance > radius * 3.2) continue;
    const inside = mask[index]! / 255;
    const coreWidth = Math.max(0.75, radius * 0.09);
    const core = Math.exp(-(distance * distance) / (2 * coreWidth * coreWidth));
    const bloom = Math.exp(-distance / Math.max(1, radius * 0.72));
    const selectedBody = inside * Math.exp(-distance / Math.max(1, radius * 1.35)) * 0.16;
    const light = Math.min(1, (core * 0.82 + bloom * 0.38 + selectedBody) * intensity * flicker);
    if (light <= 0.002) continue;
    const offset = index * 4;
    const alpha = Math.min(0.94, light * 0.72);
    for (let channel = 0; channel < 3; channel += 1) {
      output[offset + channel] = Math.round(Math.min(255,
        source.data[offset + channel]! * (1 - alpha) + color[channel]! * alpha
          + color[channel]! * light * 0.2
      ));
    }
  }
  return { ...source, data: output };
}

function directPixelSurface(context: ServerEffectRenderContext, name: string): PixelSurface {
  const binding = singleBinding<Record<string, unknown>>(context, name);
  const surface = binding.surface as PixelSurface | undefined;
  if (surface !== undefined && surface.width === context.width && surface.height === context.height
    && (surface.data instanceof Uint8Array || surface.data instanceof Uint8ClampedArray)) {
    return surface;
  }
  const data = binding.data;
  if (binding.width === context.width && binding.height === context.height
    && (data instanceof Uint8Array || data instanceof Uint8ClampedArray)
    && data.length === context.width * context.height * 4) {
    return {
      width: context.width,
      height: context.height,
      data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      colorSpace: "srgb",
      alphaMode: "straight"
    };
  }
  throw new TypeError(`${name} must contain one decoded RGBA frame.`);
}

function smoothUnit(edge0: number, edge1: number, value: number): number {
  if (Math.abs(edge1 - edge0) <= Number.EPSILON) return value < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function maskRevealFrame(
  context: ServerEffectRenderContext,
  params: Readonly<JsonObject>
): PixelSurface {
  const source = directPixelSurface(context, "source_frame");
  const target = directPixelSurface(context, "target_frame");
  const limit = Math.min(1, Math.max(0, params.progress as number));
  const duration = params.duration as number;
  const reveal = Math.min(limit, Math.max(0, context.time / duration) * limit);
  if (reveal <= 0) return { ...source, data: new Uint8ClampedArray(source.data) };
  if (reveal >= 1) return { ...target, data: new Uint8ClampedArray(target.data) };
  const shape = params.shape as string;
  const motion = params.motion as string;
  const feather = params.feather as number;
  const centerX = params.centerX as number;
  const centerY = params.centerY as number;
  const radians = (params.rotation as number) * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const size = params.size as number;
  const custom = shape === "custom" ? directPixelSurface(context, "mask_layer") : undefined;
  const output = new Uint8ClampedArray(source.data.length);
  for (let y = 0; y < context.height; y += 1) for (let x = 0; x < context.width; x += 1) {
    const u = x / Math.max(1, context.width - 1);
    const v = y / Math.max(1, context.height - 1);
    let metric: number;
    if (custom !== undefined) {
      const offset = (y * context.width + x) * 4;
      const alpha = custom.data[offset + 3]! / 255;
      const luminance = (custom.data[offset]! * 0.2126 + custom.data[offset + 1]! * 0.7152
        + custom.data[offset + 2]! * 0.0722) / 255;
      metric = 1 - (alpha < 0.999 ? alpha : luminance);
    } else if (motion !== "expand") {
      metric = motion === "right_to_left" ? 1 - u
        : motion === "top_to_bottom" ? v
          : motion === "bottom_to_top" ? 1 - v : u;
    } else {
      const dx = u - centerX;
      const dy = v - centerY;
      const rx = dx * cosine + dy * sine;
      const ry = -dx * sine + dy * cosine;
      const extent = Math.max(
        Math.hypot(centerX, centerY),
        Math.hypot(1 - centerX, centerY),
        Math.hypot(centerX, 1 - centerY),
        Math.hypot(1 - centerX, 1 - centerY),
        0.001
      ) * size;
      const radius = Math.hypot(rx, ry);
      const angle = Math.atan2(ry, rx) - Math.PI / 2;
      metric = shape === "rectangle" ? Math.max(Math.abs(rx) / 0.82, Math.abs(ry) / 0.58) / extent
        : shape === "diamond" ? (Math.abs(rx) + Math.abs(ry)) / (extent * 1.38)
          : shape === "triangle" ? radius / (extent * Math.max(0.34,
              Math.cos(Math.PI / 3) / Math.cos(((angle + Math.PI / 3) % (Math.PI * 2 / 3)
                + Math.PI * 2 / 3) % (Math.PI * 2 / 3) - Math.PI / 3)))
            : shape === "star" ? radius / (extent * (0.58 + 0.24 * Math.cos(angle * 5)))
          : shape === "ellipse" ? Math.hypot(rx, ry / 0.62) / extent
            : radius / extent;
    }
    let coverage = 1 - smoothUnit(reveal - feather, reveal + feather, metric);
    if (params.invert === true) coverage = 1 - coverage;
    const offset = (y * context.width + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      output[offset + channel] = Math.round(
        source.data[offset + channel]! * (1 - coverage) + target.data[offset + channel]! * coverage
      );
    }
  }
  return { ...source, data: output };
}

function effectTime(effectId: string, context: ServerEffectRenderContext, duration = 1) {
  return Object.freeze({
    contractVersion: "1.1.0" as const,
    effectId,
    effectInstanceId: `single-tool:${context.requestId}`,
    active: true,
    projectTime: context.time,
    layerTime: context.time,
    effectTime: context.time,
    progress: Math.min(1, Math.max(0, context.time / duration)),
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
  const defaults = effect.sourceId === "H01"
    ? MASK_REVEAL_DEFAULTS
    : effect.sourceId === "D04"
      ? Object.freeze({
          ...withoutResourceFields(effect.effectId, effect.defaultPreset),
          target: "main subject",
          placement: "outline"
        })
    : effect.sourceId === "L01"
      ? Object.freeze({
          ...withoutResourceFields(effect.effectId, effect.defaultPreset),
          target: "main subject"
        })
    : effect.sourceId === "C03"
      ? Object.freeze({ ...withoutResourceFields(effect.effectId, effect.defaultPreset), duration: 2 })
      : Object.freeze(withoutResourceFields(effect.effectId, effect.defaultPreset));
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
      const normalized = effect.sourceId === "H01"
        ? { ...params }
        : effect.sourceId === "D04" || effect.sourceId === "L01"
          ? {
              ...normalizeEffectParams(effect.effectId, params),
              target: (params.target as string).trim().toLowerCase(),
              ...(effect.sourceId === "D04" ? { placement: params.placement } : {})
            }
        : effect.sourceId === "T08"
        ? normalizeTextExtrude3DParams(params)
        : normalizeEffectParams(effect.effectId, params);
      return withoutResourceFields(effect.effectId, normalized as JsonObject);
    },
    validateParams: () => ({ valid: true as const }),
    render(context: ServerEffectRenderContext, params: Readonly<JsonObject>) {
      const time = effectTime(effect.effectId, context,
        effect.sourceId === "C03" ? params.duration as number : 1);
      const resolved = internalParams(effect, context, params);
      let output: PixelSurface;
      if (effect.sourceId === "H01") {
        output = maskRevealFrame(context, params);
      } else if (effect.sourceId === "D04") {
        output = chalkStrokeFrame(context, params);
      } else if (effect.sourceId === "L01") {
        output = neonGlowFrame(context, params);
      } else if (effect.sourceId === "T08") {
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
