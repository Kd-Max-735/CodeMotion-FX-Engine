import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition, ServerEffectRenderContext } from "../../types.js";
import { CAMERA_BACKEND, cameraOutput, effectProgress, round, valid, type MotionEasing, type Vector3 } from "./helpers.js";

export interface PanTiltParams extends JsonObject {
  panDegrees: number;
  tiltDegrees: number;
  duration: number;
  verticalFovDegrees: number;
  easing: MotionEasing;
}

export function renderPanTilt(context: ServerEffectRenderContext, params: Readonly<PanTiltParams>) {
  const progress = effectProgress(context, params.duration, params.easing);
  const position: Vector3 = { x: 0, y: 0, z: 0 };
  const rotation: Vector3 = { x: round(params.tiltDegrees * progress), y: round(params.panDegrees * progress), z: 0 };
  return {
    kind: "metadata" as const,
    backendId: CAMERA_BACKEND.backendId,
    output: cameraOutput("camera-pan-tilt", position, rotation, params.verticalFovDegrees, progress),
    degraded: false,
    warnings: []
  };
}

export const PAN_TILT_DEFINITION: EffectToolDefinition<PanTiltParams> = {
  effectId: "fx.camera.panTilt",
  toolName: "pan_tilt",
  displayName: "摇移俯仰镜头",
  version: "1.0.0",
  category: "camera",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      panDegrees: { type: "number", minimum: -180, maximum: 180, default: 30 },
      tiltDegrees: { type: "number", minimum: -90, maximum: 90, default: 0 },
      duration: { type: "number", minimum: 0.2, maximum: 20, default: 2 },
      verticalFovDegrees: { type: "number", minimum: 10, maximum: 120, default: 50 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults: { panDegrees: 30, tiltDegrees: 0, duration: 2, verticalFovDegrees: 50, easing: "ease_in_out" },
  presets: [
    { presetId: "pan_tilt.reveal_left", displayName: "向左揭示", params: { panDegrees: -45, tiltDegrees: 0, duration: 2.5, verticalFovDegrees: 50, easing: "ease_in_out" } },
    { presetId: "pan_tilt.look_up", displayName: "缓慢仰拍", params: { panDegrees: 0, tiltDegrees: 35, duration: 3, verticalFovDegrees: 45, easing: "ease_out" } },
    { presetId: "pan_tilt.diagonal", displayName: "斜向扫视", params: { panDegrees: 60, tiltDegrees: -20, duration: 1.5, verticalFovDegrees: 55, easing: "ease_in_out" } }
  ],
  inputSlots: [
    { name: "source_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized source video or rendered scene stream." },
    { name: "camera_target", kind: "data", required: false, cardinality: "one", description: "Optional server-authorized camera target binding." }
  ],
  primaryBackend: CAMERA_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "A real server-side camera transform is required." },
  performanceGrade: "light",
  normalizeParams: (params) => ({ ...params, panDegrees: round(params.panDegrees), tiltDegrees: round(params.tiltDegrees), duration: round(params.duration), verticalFovDegrees: round(params.verticalFovDegrees) }),
  validateParams: valid,
  render: renderPanTilt
};
