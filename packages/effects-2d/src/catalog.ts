import type {
  EffectDefinition,
  JsonObject,
  JsonValue
} from "@codemotion/core";
import type {
  EffectRenderContext,
  RenderOutput,
  TextureHandle
} from "@codemotion/renderer-api";
import {
  TEXT_EXTRUDE_3D,
  makeTextExtrudePreviewInput,
  type TextExtrude3DEffectDefinition
} from "@codemotion/effects-3d";
import {
  GROUP_2_BLUEPRINTS,
  GROUP_3_REQUIRED_EFFECT_ID
} from "./blueprints.js";
import { normalizeEffectParams, renderEffectPixels } from "./runtime.js";
import { createCatalogWebGLPass, type CatalogWebGLPass } from "./shader.js";
import type {
  EffectBlueprint,
  EffectPreset,
  P0EffectDefinition,
  ParameterSpec,
  PixelSurface
} from "./types.js";

interface EffectStackRenderer {
  applyEffectStack(
    source: TextureHandle,
    effects: readonly CatalogWebGLPass[]
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
    && "applyEffectStack" in value
    && typeof value.applyEffectStack === "function";
}

function hasMaskStack(value: unknown): value is MaskStackRenderer {
  return typeof value === "object" && value !== null
    && "applyMaskStack" in value
    && typeof value.applyMaskStack === "function";
}

function parameterJsonSchema(spec: ParameterSpec): JsonObject {
  if (spec.kind === "number") {
    return {
      type: "number",
      default: spec.default,
      minimum: spec.min,
      maximum: spec.max,
      multipleOf: spec.step
    };
  }
  if (spec.kind === "enum") {
    return { type: "string", default: spec.default, enum: [...spec.options] };
  }
  if (spec.kind === "text") {
    return {
      type: "string",
      default: spec.default,
      minLength: spec.minLength,
      maxLength: spec.maxLength
    };
  }
  if (spec.kind === "boolean") return { type: "boolean", default: spec.default };
  return {
    type: "array",
    default: [...spec.default],
    minItems: 2,
    maxItems: 2,
    items: {
      type: "number",
      minimum: spec.min,
      maximum: spec.max,
      multipleOf: spec.step
    }
  };
}

function parameterUiSchema(spec: ParameterSpec): JsonObject {
  return {
    label: spec.label,
    control: spec.kind === "number" ? "slider"
      : spec.kind === "enum" ? "select"
        : spec.kind === "boolean" ? "toggle"
          : spec.kind === "vector2" ? "vector2" : "text",
    unit: spec.unit,
    keyframeable: spec.keyframeable,
    expression: spec.expression,
    randomizable: spec.randomizable,
    performanceImpact: spec.performanceImpact,
    conflicts: [...spec.conflicts],
    nullBehavior: spec.nullBehavior
  };
}

function varyPresetValue(spec: ParameterSpec, index: number): JsonValue {
  if (spec.kind === "number") {
    const span = spec.max - spec.min;
    const offset = index === 0 ? -span * 0.12 : index === 2 ? span * 0.12 : 0;
    const raw = Math.min(spec.max, Math.max(spec.min, spec.default + offset));
    const steps = Math.round((raw - spec.min) / spec.step);
    return Math.min(spec.max, Math.max(spec.min, spec.min + steps * spec.step));
  }
  if (spec.kind === "enum") {
    const defaultIndex = Math.max(0, spec.options.indexOf(spec.default));
    return spec.options[(defaultIndex + index) % spec.options.length] ?? spec.default;
  }
  if (spec.kind === "boolean") return index === 2 ? !spec.default : spec.default;
  if (spec.kind === "vector2") {
    const delta = index === 0 ? -0.12 : index === 2 ? 0.12 : 0;
    return spec.default.map((value) => Math.min(spec.max, Math.max(spec.min, value + delta)));
  }
  return spec.default;
}

function makePreset(
  blueprint: EffectBlueprint,
  index: 0 | 1 | 2
): EffectPreset {
  const names = ["Gentle", "Balanced", "Bold"] as const;
  const params: JsonObject = {};
  for (const spec of blueprint.parameters) params[spec.name] = varyPresetValue(spec, index);
  return Object.freeze({
    presetId: `preset.${blueprint.sourceId.toLowerCase()}.${names[index].toLowerCase()}`,
    effectId: blueprint.effectId,
    version: "1.0.0",
    name: `${blueprint.displayName} ${names[index]}`,
    tags: Object.freeze([blueprint.category, names[index].toLowerCase(), "p0"]),
    params: Object.freeze(params),
    previewAsset: `./preview.html#${blueprint.sourceId}-${names[index].toLowerCase()}`
  });
}

function parseSurface(value: unknown): PixelSurface | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = value as Record<string, unknown>;
  if (!Number.isInteger(candidate.width) || !Number.isInteger(candidate.height)
    || typeof candidate.width !== "number" || typeof candidate.height !== "number"
    || !Array.isArray(candidate.data)) return undefined;
  if (candidate.data.some((byte) => typeof byte !== "number" || !Number.isFinite(byte))) return undefined;
  const colorSpace = candidate.colorSpace === "display-p3" || candidate.colorSpace === "linear-srgb"
    ? candidate.colorSpace : "srgb";
  const alphaMode = candidate.alphaMode === "none" || candidate.alphaMode === "premultiplied"
    ? candidate.alphaMode : "straight";
  return {
    width: candidate.width,
    height: candidate.height,
    data: new Uint8ClampedArray(candidate.data),
    colorSpace,
    alphaMode
  };
}

function frameOutput(surface: PixelSurface, effectId: string): RenderOutput {
  return {
    type: "frame",
    data: {
      effectId,
      width: surface.width,
      height: surface.height,
      colorSpace: surface.colorSpace,
      alphaMode: surface.alphaMode,
      pixels: Array.from(surface.data)
    }
  };
}

function definitionFields(blueprint: EffectBlueprint): EffectDefinition {
  const properties: JsonObject = {};
  const defaults: JsonObject = {};
  const fields: JsonObject = {};
  for (const spec of blueprint.parameters) {
    properties[spec.name] = parameterJsonSchema(spec);
    defaults[spec.name] = spec.default instanceof Array ? [...spec.default] : spec.default;
    fields[spec.name] = parameterUiSchema(spec);
  }
  return {
    schemaVersion: "1.0.0",
    effectId: blueprint.effectId,
    version: "1.0.0",
    displayName: blueprint.displayName,
    category: blueprint.category,
    description: blueprint.description,
    tags: [blueprint.category, "p0", "2d", blueprint.sourceId.toLowerCase()],
    inputTypes: blueprint.category === "transition" || blueprint.category === "composite"
      ? ["texture", "texture"] : ["texture"],
    outputType: "texture",
    parameterSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: blueprint.parameters.map((spec) => spec.name),
      properties,
      additionalProperties: false
    },
    uiSchema: {
      layout: "group",
      fields,
      order: blueprint.parameters.map((spec) => spec.name)
    },
    defaultPreset: defaults,
    renderBackends: ["webgl", "canvas2d"],
    preferredBackend: "webgl",
    fallbackBackend: "canvas2d",
    deterministic: true,
    supportsAlpha: true,
    supportsMask: true,
    supportsKeyframes: true,
    supportsExpressions: true,
    performanceClass: blueprint.performanceClass,
    qualityLevels: [
      { quality: "draft", settings: { sampleScale: 0.5, samples: 3 } },
      { quality: "preview", settings: { sampleScale: 1, samples: 5 } },
      { quality: "final", settings: { sampleScale: 1, samples: 9 } }
    ],
    validationRules: [
      {
        ruleId: `${blueprint.sourceId.toLowerCase()}.finite`,
        message: "All numeric parameters must be finite and within the declared range.",
        severity: "error",
        config: { action: "clamp" }
      },
      {
        ruleId: `${blueprint.sourceId.toLowerCase()}.texture-bounds`,
        message: "Input, secondary, and mask surfaces must have equal positive dimensions.",
        severity: "error",
        config: { action: "reject" }
      }
    ],
    migrations: [{ fromVersion: "0.9.0", toVersion: "1.0.0" }]
  };
}

function createEffect(blueprint: EffectBlueprint): P0EffectDefinition {
  let disposed = false;
  const presets = Object.freeze([
    makePreset(blueprint, 0),
    makePreset(blueprint, 1),
    makePreset(blueprint, 2)
  ]) as unknown as P0EffectDefinition["presets"];
  const fields = definitionFields(blueprint);
  return Object.freeze({
    ...fields,
    sourceId: blueprint.sourceId,
    implementationOwner: "Group 2",
    presets,
    preview: Object.freeze({
      asset: `./preview.html#${blueprint.sourceId}`,
      width: 160,
      height: 90,
      frameProgress: 0.5,
      alt: `${blueprint.displayName} deterministic P0 preview`
    }),
    alphaBehavior: blueprint.category === "vector" || blueprint.category === "draw"
      ? "Generates straight Alpha only at procedural stroke coverage; zero-alpha pixels are RGB-zeroed."
      : blueprint.category === "light"
      ? "Preserves source alpha while adding RGB glow in straight color; premultiplied inputs are unassociated before processing."
      : "Preserves straight or premultiplied alpha and never introduces RGB outside zero-alpha pixels.",
    maskBehavior: blueprint.category === "composite"
      ? "Consumes the explicit mask/matte input without mutating the source layer."
      : "Applies the context mask after the effect; coverage multiplies output alpha.",
    fallbackBehavior: "Canvas2D/CPU path uses the same normalized parameters, seed, progress, quality grade, Alpha, and mask rules.",
    benchmarkBudgetMs: blueprint.benchmarkBudgetMs,
    documentation: Object.freeze({
      readme: `README.md#${blueprint.sourceId.toLowerCase()}-${blueprint.effectId.replaceAll(".", "").toLowerCase()}`,
      changelog: `CHANGELOG.md#${blueprint.sourceId.toLowerCase()}`
    }),
    migrationHandlers: Object.freeze([{
      fromVersion: "0.9.0",
      toVersion: "1.0.0",
      migrate(params: JsonObject): JsonObject {
        return normalizeEffectParams(blueprint.effectId, params);
      }
    }]),
    async render(context: EffectRenderContext): Promise<RenderOutput> {
      if (disposed) throw new Error(`${blueprint.effectId} has been disposed.`);
      const params = normalizeEffectParams(blueprint.effectId, context.params);
      const progress = typeof params.progress === "number"
        ? params.progress : Math.min(1, Math.max(0, context.time - Math.floor(context.time)));
      if (context.renderer.backend === "webgl" && context.inputTextures[0] && hasEffectStack(context.renderer)) {
        let source = context.inputTextures[0];
        let compositeIntermediate: TextureHandle | undefined;
        if ((blueprint.category === "transition" || blueprint.category === "composite")
          && context.inputTextures[1]) {
          const opacity = blueprint.category === "transition"
            ? progress
            : blueprint.sourceId === "H03"
              ? (typeof params.opacity === "number" ? params.opacity : 1)
                * (typeof params.mix === "number" ? params.mix : 1)
              : 1;
          source = await context.renderer.composite(
            [source, context.inputTextures[1]],
            {
              blendMode: blueprint.sourceId === "H03" && typeof params.mode === "string"
                ? params.mode : "normal",
              opacity
            },
            context
          );
          compositeIntermediate = source;
        }
        const result = context.renderer.applyEffectStack(
          source,
          [createCatalogWebGLPass(
            blueprint,
            params,
            progress,
            context.seed,
            context.quality,
            context.width,
            context.height
          )]
        );
        if (compositeIntermediate) context.renderer.releaseTexture(compositeIntermediate);
        if (result.failures[0]) throw result.failures[0].error;
        const output = context.mask && hasMaskStack(context.renderer)
          ? context.renderer.applyMaskStack(result.output, [{
            texture: context.mask,
            mode: "add",
            opacity: 1
          }])
          : result.output;
        if (output.id !== result.output.id) context.renderer.releaseTexture(result.output);
        return { type: "texture", texture: output };
      }
      const source = parseSurface(context.data?.pixelSurface);
      if (!source) {
        throw new Error(`${blueprint.effectId} canvas2d fallback requires data.pixelSurface.`);
      }
      const secondary = parseSurface(context.data?.secondarySurface);
      const mask = parseSurface(context.data?.maskSurface);
      const output = renderEffectPixels(blueprint.effectId, source, params, {
        progress,
        seed: context.seed,
        quality: context.quality,
        ...(secondary ? { secondary } : {}),
        ...(mask ? { mask } : {})
      });
      return frameOutput(output, blueprint.effectId);
    },
    renderPixels(
      source: PixelSurface,
      params: Readonly<Record<string, unknown>> = {},
      options = {}
    ): PixelSurface {
      if (disposed) throw new Error(`${blueprint.effectId} has been disposed.`);
      return renderEffectPixels(blueprint.effectId, source, params, options);
    },
    dispose(): void {
      disposed = true;
    }
  });
}

export function createGroup2P0Effects(): readonly P0EffectDefinition[] {
  return Object.freeze(GROUP_2_BLUEPRINTS.map((blueprint) => createEffect(blueprint)));
}

export const GROUP_2_P0_EFFECTS: readonly P0EffectDefinition[] = createGroup2P0Effects();

export const GROUP_2_P0_BY_ID: ReadonlyMap<string, P0EffectDefinition> =
  new Map(GROUP_2_P0_EFFECTS.map((effect) => [effect.effectId, effect]));

export type P0CatalogEffectDefinition = P0EffectDefinition | TextExtrude3DEffectDefinition;

const T08_SLOT_INDEX = GROUP_2_P0_EFFECTS.findIndex((effect) => effect.sourceId === "V01");
if (T08_SLOT_INDEX !== 15) throw new Error("Frozen P0 catalog slot 16 must precede V01.");

export const P0_EFFECTS: readonly P0CatalogEffectDefinition[] = Object.freeze([
  ...GROUP_2_P0_EFFECTS.slice(0, T08_SLOT_INDEX),
  TEXT_EXTRUDE_3D,
  ...GROUP_2_P0_EFFECTS.slice(T08_SLOT_INDEX)
]);

export const P0_EFFECTS_BY_ID: ReadonlyMap<string, P0CatalogEffectDefinition> =
  new Map(P0_EFFECTS.map((effect) => [effect.effectId, effect]));

export { makeTextExtrudePreviewInput };

export interface ExternalEffectInterfaceReport {
  readonly effectId: typeof GROUP_3_REQUIRED_EFFECT_ID;
  readonly available: boolean;
  readonly compatible: boolean;
  readonly missing: readonly string[];
}

export function verifyGroup3TextExtrudeInterface(
  external: Readonly<Pick<EffectDefinition, "effectId" | "version" | "parameterSchema" | "renderBackends">> | undefined
): ExternalEffectInterfaceReport {
  if (!external) {
    return {
      effectId: GROUP_3_REQUIRED_EFFECT_ID,
      available: false,
      compatible: false,
      missing: Object.freeze(["implementation"])
    };
  }
  const missing: string[] = [];
  if (external.effectId !== GROUP_3_REQUIRED_EFFECT_ID) missing.push("effectId");
  if (external.version !== "1.0.0") missing.push("version");
  if (!external.renderBackends.includes("three") && !external.renderBackends.includes("webgl")) missing.push("3d-backend");
  const schema = typeof external.parameterSchema === "object" && external.parameterSchema !== null
    ? external.parameterSchema as JsonObject : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const properties = typeof schema.properties === "object" && schema.properties !== null
    && !Array.isArray(schema.properties) ? schema.properties as JsonObject : {};
  for (const name of ["depth", "bevel", "material", "light"]) {
    if (!required.includes(name) || properties[name] === undefined) missing.push(`parameter:${name}`);
  }
  return {
    effectId: GROUP_3_REQUIRED_EFFECT_ID,
    available: true,
    compatible: missing.length === 0,
    missing: Object.freeze(missing)
  };
}
