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
  startValue: number;
  endValue: number;
  duration: number;
  positionX: number;
  positionY: number;
  size: number;
  color: string;
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
  readonly mapping: LiveBindingParams["mapping"];
  readonly applied: boolean;
  readonly value: number | null;
  readonly startValue: number;
  readonly endValue: number;
  readonly progress: number;
  readonly positionX: number;
  readonly positionY: number;
  readonly size: number;
  readonly color: string;
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
    || value.targetHandle.length > 256
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

const defaults: LiveBindingParams = Object.freeze({
  mapping: "normalized",
  fallback: "hold",
  smoothing: 0.25,
  gain: 1,
  offset: 0,
  threshold: 0.5,
  startValue: 0,
  endValue: 100,
  duration: 5,
  positionX: 0.5,
  positionY: 0.55,
  size: 0.42,
  color: "#48e2ff"
});

export const LIVE_BINDING_DEFINITION: EffectToolDefinition<LiveBindingParams, AuthorizedEffectInputs, LiveBindingOutput> = {
  effectId: "fx.data.liveBinding",
  toolName: "live_binding",
  displayName: "实时数据绑定",
  version: "2.0.0",
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
      threshold: { type: "number", minimum: -10000, maximum: 10000, default: 0.5 },
      startValue: { type: "number", minimum: -1000000, maximum: 1000000, default: 0 },
      endValue: { type: "number", minimum: -1000000, maximum: 1000000, default: 100 },
      duration: { type: "number", minimum: 0.2, maximum: 30, default: 5 },
      positionX: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      positionY: { type: "number", minimum: 0, maximum: 1, default: 0.55 },
      size: { type: "number", minimum: 0.1, maximum: 1, default: 0.42 },
      color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", default: "#48e2ff" }
    }
  },
  defaults,
  presets: [
    { presetId: "live-binding.smooth", displayName: "平滑归一", params: { ...defaults, smoothing: 0.6 } },
    { presetId: "live-binding.direct", displayName: "直接响应", params: { ...defaults, mapping: "direct", smoothing: 0.1 } },
    { presetId: "live-binding.alert", displayName: "阈值告警", params: { ...defaults, mapping: "threshold", fallback: "zero", smoothing: 0, threshold: 0.8, color: "#ff5256" } }
  ],
  inputSlots: [
    { name: "source_image", kind: "image", required: true, cardinality: "one", description: "Owner-authorized image or decoded video frame receiving the gauge overlay." },
    { name: "validated_binding", kind: "data", required: true, cardinality: "one", description: "Server-validated value snapshot and allow-listed render target; no paths or expressions." }
  ],
  primaryBackend: CPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Only server-validated bindings with allow-listed targets may execute." },
  performanceGrade: "light",
  normalizeParams: (params) => ({ ...params, smoothing: round(params.smoothing), gain: round(params.gain), offset: round(params.offset), threshold: round(params.threshold), startValue: round(params.startValue), endValue: round(params.endValue), duration: round(params.duration), positionX: round(params.positionX), positionY: round(params.positionY), size: round(params.size), color: params.color.toLowerCase() }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const snapshot = parseSnapshot(singleBinding(context, "validated_binding"));
    const progress = clamp(context.time / params.duration);
    const animatedValue = params.startValue + (params.endValue - params.startValue)
      * (progress * progress * (3 - 2 * progress));
    let current = snapshot.value;
    if (current === null) {
      if (params.fallback === "skip") {
        return {
          kind: "metadata",
          backendId: CPU_BACKEND.backendId,
          output: Object.freeze({
            targetHandle: snapshot.targetHandle,
            targetProperty: snapshot.targetProperty,
            mapping: params.mapping,
            applied: false,
            value: null,
            startValue: params.startValue,
            endValue: params.endValue,
            progress: round(progress),
            positionX: params.positionX,
            positionY: params.positionY,
            size: params.size,
            color: params.color
          }),
          degraded: false,
          warnings: ["Validated source value is missing; update skipped by policy."]
        };
      }
      current = params.fallback === "hold" && snapshot.previousValue !== null ? snapshot.previousValue : 0;
    }
    return {
      kind: "metadata",
      backendId: CPU_BACKEND.backendId,
      output: Object.freeze({
        targetHandle: snapshot.targetHandle,
        targetProperty: snapshot.targetProperty,
        mapping: params.mapping,
        applied: true,
        value: round(animatedValue),
        startValue: params.startValue,
        endValue: params.endValue,
        progress: round(progress),
        positionX: params.positionX,
        positionY: params.positionY,
        size: params.size,
        color: params.color
      }),
      degraded: false,
      warnings: []
    };
  }
};
