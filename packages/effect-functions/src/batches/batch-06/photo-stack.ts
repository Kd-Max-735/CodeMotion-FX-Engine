import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_GPU_BACKEND, frameResult, round, seededUnit, valid } from "./common.js";

export interface PhotoStackParams extends JsonObject {
  visibleCount: number;
  revealInterval: number;
  spreadX: number;
  spreadY: number;
  maxRotation: number;
  depthGap: number;
  startTime: number;
}

const defaults: PhotoStackParams = {
  visibleCount: 6,
  revealInterval: 0.35,
  spreadX: 0.16,
  spreadY: 0.1,
  maxRotation: 8,
  depthGap: 0.02,
  startTime: 0
};

export const PHOTO_STACK_DEFINITION: EffectToolDefinition<PhotoStackParams> = {
  effectId: "fx.media.photoStack",
  toolName: "photo_stack",
  displayName: "照片叠放",
  version: "1.0.0",
  category: "media",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      visibleCount: { type: "integer", minimum: 2, maximum: 32, default: 6 },
      revealInterval: { type: "number", minimum: 0, maximum: 10, default: 0.35 },
      spreadX: { type: "number", minimum: 0, maximum: 1, default: 0.16 },
      spreadY: { type: "number", minimum: 0, maximum: 1, default: 0.1 },
      maxRotation: { type: "number", minimum: 0, maximum: 45, default: 8 },
      depthGap: { type: "number", minimum: 0, maximum: 1, default: 0.02 },
      startTime: { type: "number", minimum: 0, maximum: 3600, default: 0 }
    }
  },
  defaults,
  presets: [
    { presetId: "photo_stack.neat", displayName: "整齐相册", params: { ...defaults, spreadX: 0.05, spreadY: 0.04, maxRotation: 3 } },
    { presetId: "photo_stack.casual", displayName: "随手叠放", params: { ...defaults } },
    { presetId: "photo_stack.scattered", displayName: "散落桌面", params: { ...defaults, visibleCount: 10, spreadX: 0.35, spreadY: 0.25, maxRotation: 20, revealInterval: 0.18 } }
  ],
  inputSlots: [{ name: "source_images", kind: "image", required: true, cardinality: "many", description: "Ordered owner-authorized photos." }],
  primaryBackend: SERVER_GPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const boundImages = context.inputs.source_images;
    if (!Array.isArray(boundImages) || boundImages.length === 0) {
      throw new TypeError("photo_stack requires at least one server-bound image.");
    }
    const availableCount = Math.min(params.visibleCount, boundImages.length);
    const elapsed = Math.max(0, context.time - params.startTime);
    const revealed = params.revealInterval === 0 ? availableCount
      : Math.min(availableCount, Math.floor(elapsed / params.revealInterval) + 1);
    const layers = Array.from({ length: revealed }, (_, index) => ({
      inputIndex: index,
      translate: [
        round((seededUnit(context.seed, index, 0) * 2 - 1) * params.spreadX),
        round((seededUnit(context.seed, index, 1) * 2 - 1) * params.spreadY),
        round(index * params.depthGap)
      ],
      rotation: round((seededUnit(context.seed, index, 2) * 2 - 1) * params.maxRotation)
    }));
    return frameResult(SERVER_GPU_BACKEND.backendId, {
      operation: "composite_photo_stack",
      sourceSlot: "source_images",
      revealed,
      layers
    }, boundImages.length < params.visibleCount
      ? ["visibleCount was limited by the number of authorized source images."]
      : []);
  }
};
