import { Ajv2020 } from "ajv/dist/2020.js";
import type { JsonObject } from "@codemotion/core";
import { P0_EFFECTS, effectCardForEffectId } from "@codemotion/effects-2d";
import type { BrandConstraint } from "./provider.js";

export const P0_GENERATION_EFFECT_IDS: readonly string[] = Object.freeze(P0_EFFECTS.map((effect) => effect.effectId));
export type P0GenerationEffectId = string;
/** @deprecated Use P0_GENERATION_EFFECT_IDS. */
export const V22_GENERATION_EFFECT_IDS = P0_GENERATION_EFFECT_IDS;
/** @deprecated Use P0GenerationEffectId. */
export type V22GenerationEffectId = P0GenerationEffectId;

export type AiAssetPurpose = "reference-image" | "reference-video" | "reference-audio" | "logo";

export interface AiAssetReference {
  readonly assetId: string;
  readonly purpose: AiAssetPurpose;
}

export interface AiCanvasConstraint {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

export interface AiPlanningInputV1 {
  readonly contract: "ai-task/v1";
  readonly prompt: string;
  readonly selectedEffectId?: P0GenerationEffectId;
  readonly assets: readonly AiAssetReference[];
  readonly canvas: AiCanvasConstraint;
  readonly durationSeconds: number;
  readonly style: readonly string[];
  readonly brand: BrandConstraint;
}

const AI_PLANNING_INPUT_SCHEMA: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: ["contract", "prompt", "assets", "canvas", "durationSeconds", "style", "brand"],
  properties: {
    contract: { const: "ai-task/v1" },
    prompt: { type: "string", maxLength: 20_000 },
    selectedEffectId: { enum: [...P0_GENERATION_EFFECT_IDS] },
    assets: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["assetId", "purpose"],
        properties: {
          assetId: { type: "string", pattern: "^asset_[a-fA-F0-9]{24}$" },
          purpose: { enum: ["reference-image", "reference-video", "reference-audio", "logo"] }
        }
      }
    },
    canvas: {
      type: "object",
      additionalProperties: false,
      required: ["width", "height", "fps"],
      properties: {
        width: { type: "integer", minimum: 2, maximum: 8192 },
        height: { type: "integer", minimum: 2, maximum: 8192 },
        fps: { type: "integer", minimum: 1, maximum: 60 }
      }
    },
    durationSeconds: { type: "number", minimum: 0.5, maximum: 60 },
    style: { type: "array", maxItems: 16, items: { type: "string", maxLength: 200 } },
    brand: {
      type: "object",
      additionalProperties: false,
      required: ["colors", "tone", "requiredText", "forbiddenContent", "logoAssetIds"],
      properties: {
        colors: {
          type: "array",
          maxItems: 16,
          items: { type: "string", pattern: "^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$" }
        },
        tone: { type: "array", maxItems: 16, items: { type: "string", maxLength: 200 } },
        requiredText: { type: "array", maxItems: 16, items: { type: "string", maxLength: 500 } },
        forbiddenContent: { type: "array", maxItems: 16, items: { type: "string", maxLength: 500 } },
        logoAssetIds: {
          type: "array",
          maxItems: 8,
          items: { type: "string", pattern: "^asset_[a-fA-F0-9]{24}$" }
        }
      }
    }
  }
};

const validate = new Ajv2020({ allErrors: true, strict: true }).compile(AI_PLANNING_INPUT_SCHEMA);

export function parseAiPlanningInputV1(value: unknown): AiPlanningInputV1 {
  if (!validate(value)) throw new TypeError("Request must match the closed ai-task/v1 input contract.");
  const input = structuredClone(value) as AiPlanningInputV1;
  const assetIds = input.assets.map((asset) => asset.assetId);
  if (new Set(assetIds).size !== assetIds.length) {
    throw new TypeError("ai-task/v1 asset IDs must be unique.");
  }
  if (input.prompt.trim().length === 0) {
    throw new TypeError("ai-task/v1 requires a non-empty natural-language prompt.");
  }
  const visualAssets = input.assets.filter((asset) => asset.purpose !== "reference-audio");
  const dualInput = input.selectedEffectId !== undefined
    && effectCardForEffectId(input.selectedEffectId)?.fixture.secondaryInput === true;
  if (input.selectedEffectId && visualAssets.length !== (dualInput ? 2 : 1)) {
    throw new TypeError(`Selected effect ${input.selectedEffectId} has an invalid visual asset count.`);
  }
  if (input.canvas.width * input.canvas.height > 33_554_432) {
    throw new TypeError("ai-task/v1 canvas exceeds the pixel limit.");
  }
  const logoAssets = new Set(input.assets
    .filter((asset) => asset.purpose === "logo")
    .map((asset) => asset.assetId));
  if (new Set(input.brand.logoAssetIds).size !== input.brand.logoAssetIds.length
    || input.brand.logoAssetIds.some((assetId) => !logoAssets.has(assetId))) {
    throw new TypeError("brand.logoAssetIds must be a unique subset of purpose=logo assets.");
  }
  return input;
}
