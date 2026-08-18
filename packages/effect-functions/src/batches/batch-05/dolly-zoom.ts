import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition, ServerEffectRenderContext } from "../../types.js";
import { CAMERA_BACKEND, cameraOutput, cameraTravel, frameOutput, invalid, round, valid, type CameraTravelDirection, type MotionEasing, type Vector3 } from "./helpers.js";

export interface DollyZoomParams extends JsonObject {
  direction: CameraTravelDirection;
  travelDistance: number;
  initialTargetDistance: number;
  initialFovDegrees: number;
  duration: number;
  easing: MotionEasing;
}

export function compensatedFovDegrees(initialDistance: number, currentDistance: number, initialFovDegrees: number): number {
  const initialHalfFov = initialFovDegrees * Math.PI / 360;
  return 2 * Math.atan((initialDistance / currentDistance) * Math.tan(initialHalfFov)) * 180 / Math.PI;
}

export function renderDollyZoom(context: ServerEffectRenderContext, params: Readonly<DollyZoomParams>) {
  const travel = cameraTravel(context, params.duration, params.easing, params.direction);
  const travelled = params.travelDistance * travel.displacement;
  const currentDistance = params.initialTargetDistance + travelled;
  const fov = compensatedFovDegrees(params.initialTargetDistance, currentDistance, params.initialFovDegrees);
  const position: Vector3 = { x: 0, y: 0, z: round(travelled) };
  const rotation: Vector3 = { x: 0, y: 0, z: 0 };
  return frameOutput(context, "camera_dolly_zoom", {
    sourceSlot: "source_video",
    targetSlot: "camera_target",
    ...cameraOutput("camera-dolly-zoom", position, rotation, fov, travel.progress),
    targetDistance: round(currentDistance),
    projectionCompensation: "constant-subject-scale"
  });
}

export const DOLLY_ZOOM_DEFINITION: EffectToolDefinition<DollyZoomParams> = {
  effectId: "fx.camera.dollyZoom",
  toolName: "dolly_zoom",
  displayName: "推拉变焦镜头",
  version: "1.2.0",
  category: "camera",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      direction: { type: "string", enum: ["forward", "backward", "forward_then_backward", "backward_then_forward"], default: "forward" },
      travelDistance: { type: "number", minimum: 0.1, maximum: 80, default: 4 },
      initialTargetDistance: { type: "number", minimum: 1, maximum: 200, default: 12 },
      initialFovDegrees: { type: "number", minimum: 10, maximum: 100, default: 50 },
      duration: { type: "number", minimum: 0.5, maximum: 30, default: 4 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults: { direction: "forward", travelDistance: 4, initialTargetDistance: 12, initialFovDegrees: 50, duration: 4, easing: "ease_in_out" },
  presets: [
    { presetId: "dolly_zoom.classic_in", displayName: "经典前推", params: { direction: "forward", travelDistance: 4, initialTargetDistance: 14, initialFovDegrees: 50, duration: 4, easing: "ease_in_out" } },
    { presetId: "dolly_zoom.pull_out", displayName: "反向拉远", params: { direction: "backward", travelDistance: 8, initialTargetDistance: 12, initialFovDegrees: 45, duration: 5, easing: "ease_in_out" } },
    { presetId: "dolly_zoom.intense", displayName: "强烈压缩", params: { direction: "forward", travelDistance: 7, initialTargetDistance: 10, initialFovDegrees: 60, duration: 2.5, easing: "ease_in" } }
  ],
  inputSlots: [
    { name: "source_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized source video or rendered scene stream." },
    { name: "camera_target", kind: "data", required: true, cardinality: "one", description: "Server-derived locked subject target used for projection compensation." }
  ],
  primaryBackend: CAMERA_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Synchronized camera translation and projection compensation are required." },
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, travelDistance: round(params.travelDistance), initialTargetDistance: round(params.initialTargetDistance), initialFovDegrees: round(params.initialFovDegrees), duration: round(params.duration) }),
  validateParams: (params) => !["forward", "forward_then_backward"].includes(params.direction) || params.travelDistance < params.initialTargetDistance * 0.9
    ? valid()
    : invalid("$.travelDistance", "forward travelDistance must remain below 90% of initialTargetDistance"),
  render: renderDollyZoom
};
