export const TIME_CONTRACT_VERSION = "1.1.0" as const;
export const LEGACY_TIME_CONTRACT_VERSION = "1.0.0" as const;

export type AnimatableTimeScope = "project" | "layer" | "effect";

export interface ProjectTimeSample {
  readonly contractVersion: typeof TIME_CONTRACT_VERSION;
  readonly projectTime: number;
  readonly previousProjectTime: number;
  readonly deltaTime: number;
  readonly frame: number;
  readonly fps: number;
}

export interface LayerTimeSample {
  readonly contractVersion: typeof TIME_CONTRACT_VERSION;
  readonly layerId: string;
  readonly active: boolean;
  readonly projectTime: number;
  readonly localTime: number;
  readonly sourceTime: number;
  readonly deltaTime: number;
}

export interface EffectTimeSample {
  readonly contractVersion: typeof TIME_CONTRACT_VERSION;
  /** Effect type/definition ID. Directly consumable as EffectInstance.effectId. */
  readonly effectId: string;
  /** Effect instance ID. Equal to EffectInstance.id. */
  readonly effectInstanceId: string;
  readonly active: boolean;
  readonly projectTime: number;
  readonly layerTime: number;
  readonly effectTime: number;
  readonly progress: number;
  readonly deltaTime: number;
  readonly fps: number;
  readonly frame: number;
}

/**
 * Time contract 1.0.0 used effectId for the instance ID and omitted the type ID.
 * Migration therefore requires the original EffectInstance and cannot infer it.
 */
export interface LegacyEffectTimeSampleV1 {
  readonly contractVersion: typeof LEGACY_TIME_CONTRACT_VERSION;
  readonly effectId: string;
  readonly active: boolean;
  readonly projectTime: number;
  readonly layerTime: number;
  readonly effectTime: number;
  readonly progress: number;
  readonly deltaTime: number;
  readonly fps: number;
  readonly frame: number;
}

export interface AnimatableEvaluationTimes {
  readonly project: ProjectTimeSample;
  readonly layer?: LayerTimeSample;
  readonly effect?: EffectTimeSample;
}
