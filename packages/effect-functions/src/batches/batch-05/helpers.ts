import type { JsonObject } from "@codemotion/core";
import type {
  AuthorizedEffectInput,
  EffectBackendDefinition,
  EffectParameterValidationResult,
  EffectRenderResult,
  ServerEffectRenderContext
} from "../../types.js";

export type MotionEasing = "linear" | "ease_in" | "ease_out" | "ease_in_out";
export type CameraTravelDirection = "forward" | "backward" | "forward_then_backward" | "backward_then_forward";

export interface Vector3 extends JsonObject {
  x: number;
  y: number;
  z: number;
}

export const TRANSITION_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "server-gpu-transition-v1",
  kind: "server-gpu",
  version: "1.0.0",
  deterministic: true
});

export const CAMERA_BACKEND: EffectBackendDefinition = Object.freeze({
  backendId: "server-three-camera-v1",
  kind: "server-three",
  version: "1.0.0",
  deterministic: true
});

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function round(value: number, digits = 4): number {
  const scale = 10 ** digits;
  const result = Math.round(value * scale) / scale;
  return Object.is(result, -0) ? 0 : result;
}

export function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

export function ease(progress: number, easing: MotionEasing): number {
  const value = clamp(progress, 0, 1);
  switch (easing) {
    case "ease_in":
      return value * value;
    case "ease_out":
      return 1 - (1 - value) ** 2;
    case "ease_in_out":
      return value < 0.5 ? 2 * value * value : 1 - ((-2 * value + 2) ** 2) / 2;
    default:
      return value;
  }
}

export function effectProgress(
  context: ServerEffectRenderContext,
  duration: number,
  easing: MotionEasing
): number {
  return round(ease(clamp(context.time / duration, 0, 1), easing));
}

export function cameraTravel(
  context: ServerEffectRenderContext,
  duration: number,
  easing: MotionEasing,
  direction: CameraTravelDirection
): Readonly<{ progress: number; displacement: number }> {
  const timelineProgress = clamp(context.time / duration, 0, 1);
  const startsForward = direction === "forward" || direction === "forward_then_backward";
  const sign = startsForward ? -1 : 1;
  if (direction === "forward" || direction === "backward") {
    const progress = round(ease(timelineProgress, easing));
    return Object.freeze({ progress, displacement: round(sign * progress) });
  }
  const returning = timelineProgress > 0.5;
  const legProgress = ease(returning ? (timelineProgress - 0.5) * 2 : timelineProgress * 2, easing);
  const displacement = sign * (returning ? 1 - legProgress : legProgress);
  return Object.freeze({ progress: round(timelineProgress), displacement: round(displacement) });
}

function singleInput(context: ServerEffectRenderContext, slot: string): AuthorizedEffectInput | undefined {
  const value = context.inputs[slot];
  return Array.isArray(value) ? value[0] : value as AuthorizedEffectInput | undefined;
}

export function hasInput(context: ServerEffectRenderContext, slot: string): boolean {
  return singleInput(context, slot) !== undefined;
}

export function assertDistinctInputBindings(
  context: ServerEffectRenderContext,
  firstSlot: string,
  secondSlot: string
): void {
  const first = singleInput(context, firstSlot);
  const second = singleInput(context, secondSlot);
  if (first !== undefined && second !== undefined && Object.is(first.binding, second.binding)) {
    throw new TypeError(`Input slots ${firstSlot} and ${secondSlot} require distinct server bindings.`);
  }
}

export function frameOutput(
  context: ServerEffectRenderContext,
  operation: string,
  output: JsonObject
): EffectRenderResult<JsonObject> {
  return {
    kind: "frame",
    backendId: context.backend.backendId,
    output: {
      operation,
      frame: context.frame,
      sampleTime: round(context.time, 6),
      ...output
    },
    degraded: false,
    warnings: []
  };
}

export function valid(): EffectParameterValidationResult {
  return { valid: true };
}

export function invalid(path: string, message: string): EffectParameterValidationResult {
  return { valid: false, issues: [{ path, message }] };
}

function multiply3(left: readonly number[], right: readonly number[]): number[] {
  const output: number[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let value = 0;
      for (let index = 0; index < 3; index += 1) {
        value += left[row * 3 + index]! * right[index * 3 + column]!;
      }
      output.push(value);
    }
  }
  return output;
}

export function viewMatrix(
  position: Vector3,
  rotationDegrees: Vector3
): readonly number[] {
  const pitch = rotationDegrees.x * Math.PI / 180;
  const yaw = rotationDegrees.y * Math.PI / 180;
  const roll = rotationDegrees.z * Math.PI / 180;
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cz = Math.cos(roll);
  const sz = Math.sin(roll);
  const rotationX = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const rotationY = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rotationZ = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  const rotation = multiply3(multiply3(rotationY, rotationX), rotationZ);
  const [r00, r01, r02, r10, r11, r12, r20, r21, r22] = rotation;
  return Object.freeze([
    round(r00!), round(r10!), round(r20!), 0,
    round(r01!), round(r11!), round(r21!), 0,
    round(r02!), round(r12!), round(r22!), 0,
    round(-(r00! * position.x + r10! * position.y + r20! * position.z)),
    round(-(r01! * position.x + r11! * position.y + r21! * position.z)),
    round(-(r02! * position.x + r12! * position.y + r22! * position.z)),
    1
  ]);
}

export function cameraOutput(
  algorithm: string,
  position: Vector3,
  rotationDegrees: Vector3,
  verticalFovDegrees: number,
  progress: number
): JsonObject {
  return {
    algorithm,
    progress,
    position,
    rotationDegrees,
    verticalFovDegrees: round(verticalFovDegrees),
    viewMatrix: [...viewMatrix(position, rotationDegrees)]
  };
}
