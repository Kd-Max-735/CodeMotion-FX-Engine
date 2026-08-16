import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition, ServerEffectRenderContext } from "../../types.js";
import { CAMERA_BACKEND, cameraOutput, effectProgress, frameOutput, round, valid, type MotionEasing, type Vector3 } from "./helpers.js";

export interface OrbitParams extends JsonObject {
  azimuthDegrees: number;
  elevationDegrees: number;
  radius: number;
  duration: number;
  verticalFovDegrees: number;
  easing: MotionEasing;
}

export function renderOrbit(context: ServerEffectRenderContext, params: Readonly<OrbitParams>) {
  const progress = effectProgress(context, params.duration, params.easing);
  const azimuth = params.azimuthDegrees * progress * Math.PI / 180;
  const elevation = params.elevationDegrees * progress * Math.PI / 180;
  const horizontalRadius = params.radius * Math.cos(elevation);
  const position: Vector3 = {
    x: round(horizontalRadius * Math.sin(azimuth)),
    y: round(params.radius * Math.sin(elevation)),
    z: round(horizontalRadius * Math.cos(azimuth) - params.radius)
  };
  const rotation: Vector3 = {
    x: round(-params.elevationDegrees * progress),
    y: round(params.azimuthDegrees * progress),
    z: 0
  };
  return frameOutput(context, "camera_target_orbit", {
    sourceSlot: "source_video",
    targetSlot: "camera_target",
    ...cameraOutput("camera-target-orbit", position, rotation, params.verticalFovDegrees, progress),
    orbitRadius: params.radius,
    targetMode: "bound-camera-target"
  });
}

export const ORBIT_DEFINITION: EffectToolDefinition<OrbitParams> = {
  effectId: "fx.camera.orbit",
  toolName: "orbit",
  displayName: "环绕镜头",
  version: "1.0.0",
  category: "camera",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      azimuthDegrees: { type: "number", minimum: -360, maximum: 360, default: 90 },
      elevationDegrees: { type: "number", minimum: -80, maximum: 80, default: 10 },
      radius: { type: "number", minimum: 0.1, maximum: 100, default: 8 },
      duration: { type: "number", minimum: 0.5, maximum: 30, default: 5 },
      verticalFovDegrees: { type: "number", minimum: 10, maximum: 120, default: 50 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults: { azimuthDegrees: 90, elevationDegrees: 10, radius: 8, duration: 5, verticalFovDegrees: 50, easing: "ease_in_out" },
  presets: [
    { presetId: "orbit.product", displayName: "产品环绕", params: { azimuthDegrees: 120, elevationDegrees: 8, radius: 6, duration: 6, verticalFovDegrees: 45, easing: "ease_in_out" } },
    { presetId: "orbit.reverse", displayName: "反向半环", params: { azimuthDegrees: -180, elevationDegrees: 15, radius: 10, duration: 7, verticalFovDegrees: 50, easing: "ease_in_out" } },
    { presetId: "orbit.rise", displayName: "升高环绕", params: { azimuthDegrees: 90, elevationDegrees: 45, radius: 12, duration: 5, verticalFovDegrees: 55, easing: "ease_out" } }
  ],
  inputSlots: [
    { name: "source_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized source video or rendered scene stream." },
    { name: "camera_target", kind: "data", required: true, cardinality: "one", description: "Server-authorized orbit target binding." }
  ],
  primaryBackend: CAMERA_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Target-relative server-side camera orbit is required." },
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, azimuthDegrees: round(params.azimuthDegrees), elevationDegrees: round(params.elevationDegrees), radius: round(params.radius), duration: round(params.duration), verticalFovDegrees: round(params.verticalFovDegrees) }),
  validateParams: valid,
  render: renderOrbit
};
