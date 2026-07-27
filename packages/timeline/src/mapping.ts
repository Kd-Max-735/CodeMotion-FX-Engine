import { EngineError, ERROR_CODES, type CompositionLayer } from "@codemotion/core";
import { evaluateNumber } from "./interpolation.js";
import { mapLoopTime, resolveLayerTime, type LayerTime } from "./time.js";

export interface NestedTime extends LayerTime {
  readonly nestedTime: number;
  readonly nestedActive: boolean;
}

export function resolveNestedTime(
  layer: CompositionLayer,
  parentTime: number,
  nestedDuration: number
): NestedTime {
  if (!Number.isFinite(nestedDuration) || nestedDuration <= 0) {
    throw new EngineError(ERROR_CODES.INVALID_TIME, "nestedDuration must be a finite positive number.", {
      details: { nestedDuration }
    });
  }
  const layerTime = resolveLayerTime(layer, parentTime);
  const localTimelineTime = layerTime.elapsed;
  const remapped = layer.properties.timeRemap === undefined
    ? layerTime.sourceTime
    : evaluateNumber(layer.properties.timeRemap, localTimelineTime);
  const mapped = remapped + (layer.properties.timeOffset ?? 0);
  const mode = layer.properties.timeLoop ?? "none";
  const nestedTime = mode === "none" ? mapped : mapLoopTime(mapped, 0, nestedDuration, mode);
  const nestedActive = layerTime.active && (mode !== "none" || (nestedTime >= 0 && nestedTime < nestedDuration));
  return { ...layerTime, nestedTime, nestedActive };
}
