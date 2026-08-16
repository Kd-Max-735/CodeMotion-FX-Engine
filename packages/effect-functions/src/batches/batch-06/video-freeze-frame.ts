import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { FFMPEG_BACKEND, REJECT_FALLBACK, blockedRender, valid } from "./common.js";

export interface VideoFreezeFrameParams extends JsonObject {
  freezeAt: number;
  freezeDuration: number;
  zoomScale: number;
  vignette: number;
}

const defaults: VideoFreezeFrameParams = {
  freezeAt: 2,
  freezeDuration: 1.5,
  zoomScale: 1,
  vignette: 0
};

export const VIDEO_FREEZE_FRAME_DEFINITION: EffectToolDefinition<VideoFreezeFrameParams> = {
  effectId: "fx.media.videoFreezeFrame",
  toolName: "video_freeze_frame",
  displayName: "视频定格",
  version: "1.0.0",
  category: "media",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      freezeAt: { type: "number", minimum: 0, maximum: 3600, default: 2 },
      freezeDuration: { type: "number", exclusiveMinimum: 0, maximum: 60, default: 1.5 },
      zoomScale: { type: "number", minimum: 1, maximum: 2, default: 1 },
      vignette: { type: "number", minimum: 0, maximum: 1, default: 0 }
    }
  },
  defaults,
  presets: [
    { presetId: "video_freeze_frame.clean", displayName: "干净定格", params: { ...defaults } },
    { presetId: "video_freeze_frame.emphasis", displayName: "强调定格", params: { ...defaults, freezeDuration: 2, zoomScale: 1.08, vignette: 0.25 } },
    { presetId: "video_freeze_frame.quick", displayName: "快速停顿", params: { ...defaults, freezeDuration: 0.5 } }
  ],
  inputSlots: [{ name: "source_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized source video decoded at explicit sample times." }],
  primaryBackend: FFMPEG_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: () => blockedRender(
    "video_freeze_frame",
    "a random-access server video decoder and freeze-frame compositor adapter"
  )
};
