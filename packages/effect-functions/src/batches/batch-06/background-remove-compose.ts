import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { REJECT_FALLBACK, SERVER_GPU_BACKEND, blockedRender, valid } from "./common.js";

export interface BackgroundRemoveComposeParams extends JsonObject {
  edgeFeather: number;
  edgeContract: number;
  spillSuppression: number;
  lightWrap: number;
  backgroundScale: number;
  backgroundBlur: number;
}

const defaults: BackgroundRemoveComposeParams = {
  edgeFeather: 2,
  edgeContract: 0,
  spillSuppression: 0.6,
  lightWrap: 0.15,
  backgroundScale: 1,
  backgroundBlur: 0
};

export const BACKGROUND_REMOVE_COMPOSE_DEFINITION: EffectToolDefinition<BackgroundRemoveComposeParams> = {
  effectId: "fx.media.backgroundRemoveCompose",
  toolName: "background_remove_compose",
  displayName: "去背景合成",
  version: "1.0.0",
  category: "media",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      edgeFeather: { type: "number", minimum: 0, maximum: 32, default: 2 },
      edgeContract: { type: "number", minimum: -16, maximum: 16, default: 0 },
      spillSuppression: { type: "number", minimum: 0, maximum: 1, default: 0.6 },
      lightWrap: { type: "number", minimum: 0, maximum: 1, default: 0.15 },
      backgroundScale: { type: "number", minimum: 0.25, maximum: 4, default: 1 },
      backgroundBlur: { type: "number", minimum: 0, maximum: 64, default: 0 }
    }
  },
  defaults,
  presets: [
    { presetId: "background_remove_compose.clean", displayName: "干净替换", params: { ...defaults } },
    { presetId: "background_remove_compose.soft", displayName: "柔边融合", params: { ...defaults, edgeFeather: 5, lightWrap: 0.3, backgroundBlur: 4 } },
    { presetId: "background_remove_compose.tight", displayName: "紧致边缘", params: { ...defaults, edgeFeather: 1, edgeContract: 2, spillSuppression: 0.85 } }
  ],
  inputSlots: [
    { name: "foreground_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized foreground video." },
    { name: "foreground_matte", kind: "mask", required: true, cardinality: "one", description: "Server-authorized matte aligned to the foreground." },
    { name: "background_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized replacement background." }
  ],
  primaryBackend: SERVER_GPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: () => blockedRender(
    "background_remove_compose",
    "an aligned foreground-video/matte/background decoder and server frame compositor adapter"
  )
};
