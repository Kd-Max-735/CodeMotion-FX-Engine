import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import {
  CPU_BACKEND,
  JSON_SCHEMA,
  assertExactKeys,
  clamp,
  finiteNumber,
  isRecord,
  round,
  singleBinding
} from "./common.js";

export interface LiveBindingParams extends JsonObject {
  mapping: "direct" | "normalized" | "threshold" | "pulse";
  fallback: "zero" | "hold" | "skip";
  smoothing: number;
  gain: number;
  offset: number;
  threshold: number;
}

type SafeTargetProperty = "opacity" | "scale" | "position_x" | "position_y" | "rotation" | "number";

interface LiveBindingSnapshot {
  readonly value: number | null;
  readonly previousValue: number | null;
  readonly minimum: number;
  readonly maximum: number;
  readonly targetHandle: string;
  readonly targetProperty: SafeTargetProperty;
}

export interface LiveBindingOutput {
  readonly targetHandle: string;
  readonly targetProperty: SafeTargetProperty;
  readonly applied: boolean;
  readonly value: number | null;
}

const SAFE_PROPERTIES = new Set<SafeTargetProperty>([
  "opacity", "scale", "position_x", "position_y", "rotation", "number"
]);

function optionalNumber(value: unknown, label: string): number | null {
  return value === null ? null : finiteNumber(value, label);
}

function parseSnapshot(value: unknown): LiveBindingSnapshot {
  if (!isRecord(value)) throw new TypeError("validated live binding must be an object.");
  assertExactKeys(value, [
    "version", "value", "previousValue", "minimum", "maximum", "targetHandle", "targetProperty"
  ], "validated live binding");
  if (value.version !== "validated-live-binding-v1") {
    throw new TypeError("validated live binding version is unsupported.");
  }
  const minimum = finiteNumber(value.minimum, "live binding minimum");
  const maximum = finiteNumber(value.maximum, "live binding maximum");
  if (maximum <= minimum) throw new RangeError("live binding maximum must exceed minimum.");
  if (typeof value.targetHandle !== "string" || value.targetHandle.length === 0
    || typeof value.targetProperty !== "string"
    || !SAFE_PROPERTIES.has(value.targetProperty as SafeTargetProperty)) {
    throw new TypeError("live binding target must use an approved property.");
  }
  return {
    value: optionalNumber(value.value, "live binding value"),
    previousValue: optionalNumber(value.previousValue, "live binding previousValue"),
    minimum,
    maximum,
    targetHandle: value.targetHandle,
    targetProperty: value.targetProperty as SafeTargetProperty
  };
}

function mapValue(value: number, previous: number, snapshot: LiveBindingSnapshot, params: LiveBindingParams): number {
  if (params.mapping === "normalized") return clamp((value - snapshot.minimum) / (snapshot.maximum - snapshot.minimum));
  if (params.mapping === "threshold") return value >= params.threshold ? 1 : 0;
  if (params.mapping === "pulse") return Math.abs(value - previous);
  return value;
}

const defaults: LiveBindingParams = Object.freeze({
  mapping: "normalized",
  fallback: "hold",
  smoothing: 0.25,
  gain: 1,
  offset: 0,
  threshold: 0.5
});

export const LIVE_BINDING_DEFINITION: EffectToolDefinition<LiveBindingParams, AuthorizedEffectInputs, LiveBindingOutput> = {
  effectId: "fx.data.liveBinding",
  toolName: "live_binding",
  displayName: "实时数据绑定",
  version: "1.0.0",
  category: "data",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["mapping", "fallback"],
    properties: {
      mapping: { type: "string", enum: ["direct", "normalized", "threshold", "pulse"], default: "normalized" },
      fallback: { type: "string", enum: ["zero", "hold", "skip"], default: "hold" },
      smoothing: { type: "number", minimum: 0, maximum: 1, default: 0.25 },
      gain: { type: "number", minimum: -10, maximum: 10, default: 1 },
      offset: { type: "number", minimum: -10000, maximum: 10000, default: 0 },
      threshold: { type: "number", minimum: -10000, maximum: 10000, default: 0.5 }
    }
  },
  defaults,
  presets: [
    { presetId: "live-binding.smooth", displayName: "平滑归一", params: { mapping: "normalized", fallback: "hold", smoothing: 0.6, gain: 1, offset: 0, threshold: 0.5 } },
    { presetId: "live-binding.direct", displayName: "直接响应", params: { mapping: "direct", fallback: "hold", smoothing: 0.1, gain: 1, offset: 0, threshold: 0.5 } },
    { presetId: "live-binding.alert", displayName: "阈值告警", params: { mapping: "threshold", fallback: "zero", smoothing: 0, gain: 1, offset: 0, threshold: 0.8 } }
  ],
  inputSlots: [{ name: "validated_binding", kind: "data", required: true, cardinality: "one", description: "Server-validated value snapshot and allow-listed render target; no paths or expressions." }],
  primaryBackend: CPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Only server-validated bindings with allow-listed targets may execute." },
  performanceGrade: "light",
  normalizeParams: (params) => ({ mapping: params.mapping, fallback: params.fallback, smoothing: round(params.smoothing), gain: round(params.gain), offset: round(params.offset), threshold: round(params.threshold) }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const snapshot = parseSnapshot(singleBinding(context, "validated_binding"));
    let current = snapshot.value;
    if (current === null) {
      if (params.fallback === "skip") {
        return {
          kind: "metadata",
          backendId: CPU_BACKEND.backendId,
          output: Object.freeze({ targetHandle: snapshot.targetHandle, targetProperty: snapshot.targetProperty, applied: false, value: null }),
          degraded: false,
          warnings: ["Validated source value is missing; update skipped by policy."]
        };
      }
      current = params.fallback === "hold" && snapshot.previousValue !== null ? snapshot.previousValue : 0;
    }
    const previous = snapshot.previousValue ?? current;
    const mapped = mapValue(current, previous, snapshot, params);
    const previousMapped = mapValue(previous, previous, snapshot, params);
    const smoothed = previousMapped * params.smoothing + mapped * (1 - params.smoothing);
    return {
      kind: "metadata",
      backendId: CPU_BACKEND.backendId,
      output: Object.freeze({
        targetHandle: snapshot.targetHandle,
        targetProperty: snapshot.targetProperty,
        applied: true,
        value: round(smoothed * params.gain + params.offset)
      }),
      degraded: false,
      warnings: []
    };
  }
};
