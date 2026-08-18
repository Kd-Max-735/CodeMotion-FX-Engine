import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition, ServerEffectRenderContext } from "../../types.js";
import { CAMERA_BACKEND, cameraOutput, cameraTravel, frameOutput, hasInput, round, valid, type CameraTravelDirection, type MotionEasing, type Vector3 } from "./helpers.js";

export interface DollyParams extends JsonObject {
  direction: CameraTravelDirection;
  distance: number;
  heightOffset: number;
  duration: number;
  verticalFovDegrees: number;
  easing: MotionEasing;
}

export function renderDolly(context: ServerEffectRenderContext, params: Readonly<DollyParams>) {
  const travel = cameraTravel(context, params.duration, params.easing, params.direction);
  const position: Vector3 = {
    x: 0,
    y: round(params.heightOffset * Math.abs(travel.displacement)),
    z: round(params.distance * travel.displacement)
  };
  const rotation: Vector3 = { x: 0, y: 0, z: 0 };
  return frameOutput(context, "camera_linear_dolly", {
    sourceSlot: "source_video",
    targetSlot: hasInput(context, "camera_target") ? "camera_target" : null,
    ...cameraOutput("camera-linear-dolly", position, rotation, params.verticalFovDegrees, travel.progress)
  });
}

export const DOLLY_DEFINITION: EffectToolDefinition<DollyParams> = {
  effectId: "fx.camera.dolly",
  toolName: "dolly",
  displayName: "轨道推拉镜头",
  version: "1.1.0",
  category: "camera",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      direction: { type: "string", enum: ["forward", "backward", "forward_then_backward", "backward_then_forward"], default: "forward" },
      distance: { type: "number", minimum: 0, maximum: 100, default: 5 },
      heightOffset: { type: "number", minimum: -20, maximum: 20, default: 0 },
      duration: { type: "number", minimum: 0.2, maximum: 30, default: 3 },
      verticalFovDegrees: { type: "number", minimum: 10, maximum: 120, default: 50 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults: { direction: "forward", distance: 5, heightOffset: 0, duration: 3, verticalFovDegrees: 50, easing: "ease_in_out" },
  presets: [
    { presetId: "dolly.slow_push", displayName: "缓慢推进", params: { direction: "forward", distance: 4, heightOffset: 0, duration: 4, verticalFovDegrees: 50, easing: "ease_in_out" } },
    { presetId: "dolly.pull_back", displayName: "快速拉远", params: { direction: "backward", distance: 8, heightOffset: 0, duration: 2, verticalFovDegrees: 55, easing: "ease_out" } },
    { presetId: "dolly.rise", displayName: "升高推进", params: { direction: "forward", distance: 6, heightOffset: 2.5, duration: 3.5, verticalFovDegrees: 45, easing: "ease_in_out" } }
  ],
  inputSlots: [
    { name: "source_video", kind: "video", required: true, cardinality: "one", description: "Server-authorized source video or rendered scene stream." },
    { name: "camera_target", kind: "data", required: false, cardinality: "one", description: "Optional server-authorized camera target binding." }
  ],
  primaryBackend: CAMERA_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "A real server-side camera translation is required." },
  performanceGrade: "light",
  normalizeParams: (params) => ({ ...params, distance: round(params.distance), heightOffset: round(params.heightOffset), duration: round(params.duration), verticalFovDegrees: round(params.verticalFovDegrees) }),
  validateParams: valid,
  render: renderDolly
};
