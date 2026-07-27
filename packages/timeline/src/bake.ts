import { type Animatable, type JsonValue, type Keyframe } from "@codemotion/core";
import { evaluateAnimatable, type AnimatableResolvers } from "./interpolation.js";
import { fixedFrameRange } from "./time.js";

export interface BakeRange {
  startFrame: number;
  endFrame: number;
  fps: number;
}

export function bakeKeyframes<T extends JsonValue>(
  animatable: Animatable<T>,
  range: BakeRange,
  resolvers: AnimatableResolvers<T> = {}
): Keyframe<T>[] {
  return fixedFrameRange(range.startFrame, range.endFrame, range.fps).map(({ seconds }) => ({
    time: seconds,
    value: evaluateAnimatable(animatable, seconds, resolvers),
    interpolation: "linear"
  }));
}

export function bakeAnimatable<T extends JsonValue>(
  animatable: Animatable<T>,
  range: BakeRange,
  resolvers: AnimatableResolvers<T> = {}
): Animatable<T> {
  return { mode: "keyframes", keyframes: bakeKeyframes(animatable, range, resolvers) };
}
