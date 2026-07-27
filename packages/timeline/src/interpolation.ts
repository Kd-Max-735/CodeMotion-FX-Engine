import {
  EngineError,
  ERROR_CODES,
  type Animatable,
  type DataBindingDefinition,
  type ExpressionDefinition,
  type JsonValue,
  type Keyframe,
  type Vector2,
  type Vector3
} from "@codemotion/core";
import { evaluateEasing } from "./easing.js";

export interface AnimatableResolvers<T extends JsonValue> {
  expression?(definition: ExpressionDefinition, time: number): T;
  binding?(definition: DataBindingDefinition, time: number): T;
}

function keyframeError(message: string): EngineError {
  return new EngineError(ERROR_CODES.KEYFRAME_INVALID, message);
}

function isVector2(value: JsonValue): value is Vector2 {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof value.x === "number" && typeof value.y === "number" && value.z === undefined;
}

function isVector3(value: JsonValue): value is Vector3 {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof value.x === "number" && typeof value.y === "number" && typeof value.z === "number";
}

function interpolateScalar(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function tangentValue(tangent: readonly number[] | undefined, index: number): number {
  return tangent?.[index] ?? 0;
}

function hermiteScalar(
  from: number,
  to: number,
  progress: number,
  duration: number,
  outTangent: number,
  inTangent: number
): number {
  const t2 = progress * progress;
  const t3 = t2 * progress;
  return (2 * t3 - 3 * t2 + 1) * from
    + (t3 - 2 * t2 + progress) * outTangent * duration
    + (-2 * t3 + 3 * t2) * to
    + (t3 - t2) * inTangent * duration;
}

function interpolateValue<T extends JsonValue>(
  from: T,
  to: T,
  progress: number,
  duration: number,
  interpolation: Keyframe<T>["interpolation"],
  outTangent?: readonly number[],
  inTangent?: readonly number[]
): T {
  const useHermite = interpolation === "bezier";
  const scalar = (start: number, end: number, index: number): number => useHermite
    ? hermiteScalar(start, end, progress, duration, tangentValue(outTangent, index), tangentValue(inTangent, index))
    : interpolateScalar(start, end, progress);

  if (typeof from === "number" && typeof to === "number") {
    return scalar(from, to, 0) as T;
  }
  if (isVector3(from) && isVector3(to)) {
    return { x: scalar(from.x, to.x, 0), y: scalar(from.y, to.y, 1), z: scalar(from.z, to.z, 2) } as unknown as T;
  }
  if (isVector2(from) && isVector2(to)) {
    return { x: scalar(from.x, to.x, 0), y: scalar(from.y, to.y, 1) } as unknown as T;
  }
  return progress < 1 ? from : to;
}

export function evaluateKeyframes<T extends JsonValue>(keyframes: readonly Keyframe<T>[], time: number): T {
  if (!Number.isFinite(time)) throw keyframeError("Keyframe time must be finite.");
  if (keyframes.length === 0) throw keyframeError("At least one keyframe is required.");
  for (const keyframe of keyframes) {
    if (!Number.isFinite(keyframe.time) || keyframe.time < 0) {
      throw keyframeError("Keyframe times must be finite and non-negative.");
    }
  }
  const sorted = keyframes.map((keyframe, order) => ({ keyframe, order })).sort((left, right) => {
    return left.keyframe.time - right.keyframe.time || left.order - right.order;
  }).map(({ keyframe }) => keyframe);

  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) throw keyframeError("At least one keyframe is required.");
  if (time < first.time) return first.value;
  if (time >= last.time) return last.value;

  const rightIndex = sorted.findIndex((keyframe) => keyframe.time > time);
  if (rightIndex < 1) return first.value;
  const left = sorted[rightIndex - 1];
  const right = sorted[rightIndex];
  if (left === undefined || right === undefined) return last.value;
  if (left.interpolation === "hold") return left.value;

  const duration = right.time - left.time;
  if (duration <= 0) return right.value;
  let progress = (time - left.time) / duration;
  if (left.interpolation === "spline") progress = progress * progress * (3 - 2 * progress);
  const easing = left.easing ?? (left.interpolation === "spring" ? { type: "spring" } : undefined);
  progress = evaluateEasing(easing, progress);
  return interpolateValue(
    left.value,
    right.value,
    progress,
    duration,
    left.interpolation,
    left.outTangent,
    right.inTangent
  );
}

export function evaluateAnimatable<T extends JsonValue>(
  animatable: Animatable<T>,
  time: number,
  resolvers: AnimatableResolvers<T> = {}
): T {
  switch (animatable.mode) {
    case "constant": return animatable.value;
    case "keyframes": return evaluateKeyframes(animatable.keyframes, time);
    case "expression": {
      if (resolvers.expression === undefined) throw keyframeError("Expression resolver is required.");
      return resolvers.expression(animatable.expression, time);
    }
    case "binding": {
      if (resolvers.binding === undefined) throw keyframeError("Binding resolver is required.");
      return resolvers.binding(animatable.source, time);
    }
  }
}

export function evaluateNumber(animatable: Animatable<number>, time: number): number {
  const value = evaluateAnimatable(animatable, time);
  if (!Number.isFinite(value)) throw keyframeError("Evaluated number must be finite.");
  return value;
}
