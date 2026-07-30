import {
  TIME_CONTRACT_VERSION,
  LEGACY_TIME_CONTRACT_VERSION,
  createSeededRandom,
  type Animatable,
  type AnimatableEvaluationTimes,
  type AnimatableTimeScope,
  type EffectInstance,
  type EffectTimeSample,
  type JsonValue,
  type LegacyEffectTimeSampleV1,
  type LayerDefinition,
  type LayerTimeSample,
  type ProjectTimeSample,
  type SeededRandom
} from "@codemotion/core";
import { evaluateAnimatable, type AnimatableResolvers } from "./interpolation.js";
import { assertFps, resolveLayerTime, secondsToFrame } from "./time.js";

export const LEGACY_ABSOLUTE_EFFECT_TIME_VERSION = "0.0.0" as const;

export interface ProjectTimeInput {
  readonly projectTime: number;
  readonly previousProjectTime?: number;
  readonly fps: number;
}

export interface LegacyAbsoluteEffectTiming {
  readonly contractVersion: typeof LEGACY_ABSOLUTE_EFFECT_TIME_VERSION;
  readonly startTime?: number;
  readonly endTime?: number;
}

export interface LocalEffectTiming {
  readonly contractVersion: typeof TIME_CONTRACT_VERSION;
  readonly startTime?: number;
  readonly endTime?: number;
}

function finiteTime(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function resolveProjectTimeSample(input: ProjectTimeInput): ProjectTimeSample {
  assertFps(input.fps);
  finiteTime(input.projectTime, "projectTime");
  const previousProjectTime = input.previousProjectTime ?? input.projectTime;
  finiteTime(previousProjectTime, "previousProjectTime");
  if (previousProjectTime > input.projectTime) {
    throw new RangeError("previousProjectTime must not exceed projectTime.");
  }
  return Object.freeze({
    contractVersion: TIME_CONTRACT_VERSION,
    projectTime: input.projectTime,
    previousProjectTime,
    deltaTime: input.projectTime - previousProjectTime,
    frame: secondsToFrame(input.projectTime, input.fps, "floor"),
    fps: input.fps
  });
}

export function resolveLayerTimeSample(
  layer: LayerDefinition,
  project: ProjectTimeSample
): LayerTimeSample {
  const current = resolveLayerTime(layer, project.projectTime);
  const previous = resolveLayerTime(layer, project.previousProjectTime);
  return Object.freeze({
    contractVersion: TIME_CONTRACT_VERSION,
    layerId: layer.id,
    active: current.active,
    projectTime: project.projectTime,
    localTime: current.elapsed,
    sourceTime: current.sourceTime,
    deltaTime: Math.max(0, current.elapsed - previous.elapsed)
  });
}

export function resolveEffectTimeSample(
  effect: EffectInstance,
  layer: LayerTimeSample,
  project: ProjectTimeSample,
  layerLocalDuration: number
): EffectTimeSample {
  finiteTime(layerLocalDuration, "layerLocalDuration");
  if (layerLocalDuration < 0) throw new RangeError("layerLocalDuration must be non-negative.");
  const start = effect.startTime ?? 0;
  const end = effect.endTime ?? layerLocalDuration;
  finiteTime(start, "effect.startTime");
  finiteTime(end, "effect.endTime");
  if (end < start) throw new RangeError("effect.endTime must not precede effect.startTime.");

  const duration = end - start;
  const effectTime = Math.max(0, layer.localTime - start);
  const previousLayerTime = layer.localTime - layer.deltaTime;
  const previousEffectTime = Math.max(0, previousLayerTime - start);
  const progress = duration === 0 ? (layer.localTime >= start ? 1 : 0) : clamp01(effectTime / duration);
  return Object.freeze({
    contractVersion: TIME_CONTRACT_VERSION,
    effectId: effect.effectId,
    effectInstanceId: effect.id,
    active: effect.enabled && layer.active && layer.localTime >= start && layer.localTime < end,
    projectTime: project.projectTime,
    layerTime: layer.localTime,
    effectTime,
    progress,
    deltaTime: Math.max(0, effectTime - previousEffectTime),
    fps: project.fps,
    frame: project.frame
  });
}

export function migrateEffectTimeSampleV1(
  sample: LegacyEffectTimeSampleV1,
  effect: EffectInstance
): EffectTimeSample {
  if (sample.contractVersion !== LEGACY_TIME_CONTRACT_VERSION) {
    throw new TypeError(`Expected time contract ${LEGACY_TIME_CONTRACT_VERSION}.`);
  }
  if (sample.effectId !== effect.id) {
    throw new TypeError("Legacy time sample instance ID does not match EffectInstance.id.");
  }
  return Object.freeze({
    ...sample,
    contractVersion: TIME_CONTRACT_VERSION,
    effectId: effect.effectId,
    effectInstanceId: effect.id
  });
}

export function evaluationTimeForScope(
  scope: AnimatableTimeScope,
  times: AnimatableEvaluationTimes
): number {
  if (scope === "project") return times.project.projectTime;
  if (scope === "layer") {
    if (times.layer === undefined) throw new RangeError("Layer time is required for layer-scoped Animatable evaluation.");
    return times.layer.localTime;
  }
  if (times.effect === undefined) throw new RangeError("Effect time is required for effect-scoped Animatable evaluation.");
  return times.effect.effectTime;
}

export function evaluateAnimatableAt<T extends JsonValue>(
  animatable: Animatable<T>,
  scope: AnimatableTimeScope,
  times: AnimatableEvaluationTimes,
  resolvers: AnimatableResolvers<T> = {}
): T {
  return evaluateAnimatable(animatable, evaluationTimeForScope(scope, times), resolvers);
}

export function migrateLegacyAbsoluteEffectTiming(
  timing: LegacyAbsoluteEffectTiming,
  layerAbsoluteStart: number
): LocalEffectTiming {
  finiteTime(layerAbsoluteStart, "layerAbsoluteStart");
  const migrate = (value: number | undefined): number | undefined => {
    if (value === undefined) return undefined;
    finiteTime(value, "legacy effect time");
    return value - layerAbsoluteStart;
  };
  const startTime = migrate(timing.startTime);
  const endTime = migrate(timing.endTime);
  return Object.freeze({
    contractVersion: TIME_CONTRACT_VERSION,
    ...(startTime === undefined ? {} : { startTime }),
    ...(endTime === undefined ? {} : { endTime })
  });
}

export function createEffectRandom(
  projectSeed: number,
  effect: EffectTimeSample,
  stream: string,
  samplesPerSecond: number
): SeededRandom {
  if (!Number.isFinite(samplesPerSecond) || samplesPerSecond <= 0) {
    throw new RangeError("samplesPerSecond must be finite and positive.");
  }
  const sample = Math.floor(effect.effectTime * samplesPerSecond);
  const segments = [effect.effectId, effect.effectInstanceId, stream, String(sample)];
  const identity = segments.map((value) => `${value.length}:${value}`).join("");
  return createSeededRandom(projectSeed).fork(identity);
}
