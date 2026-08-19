import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import {
  CPU_BACKEND,
  JSON_SCHEMA,
  clamp,
  round,
  singleBinding,
  smoothstep
} from "./common.js";

export interface NumberCounterParams extends JsonObject {
  format: "integer" | "decimal_1" | "decimal_2" | "percent";
  duration: number;
  easing: "linear" | "ease_out" | "smooth";
  fromValue: number;
  toValue: number;
  numberColor: string;
  progressColor: string;
  trackColor: string;
  positionX: number;
  positionY: number;
  size: number;
  barWidth: number;
}

export interface NumberCounterOutput {
  readonly progress: number;
  readonly value: number;
  readonly formatted: string;
  readonly numberColor: string;
  readonly progressColor: string;
  readonly trackColor: string;
  readonly positionX: number;
  readonly positionY: number;
  readonly size: number;
  readonly barWidth: number;
}

function ease(progress: number, mode: NumberCounterParams["easing"]): number {
  if (mode === "ease_out") return 1 - (1 - progress) ** 3;
  if (mode === "smooth") return smoothstep(progress);
  return progress;
}

function formatNumber(value: number, format: NumberCounterParams["format"]): string {
  if (format === "integer") return String(Math.round(value));
  if (format === "decimal_1") return value.toFixed(1);
  if (format === "decimal_2") return value.toFixed(2);
  if (!Number.isFinite(value)) {
    throw new RangeError("Rendered percentage must be finite.");
  }
  return `${value.toFixed(0)}%`;
}

const defaults: NumberCounterParams = Object.freeze({
  format: "integer",
  duration: 1.2,
  easing: "ease_out",
  fromValue: 0,
  toValue: 100,
  numberColor: "#68EEFF",
  progressColor: "#FF58AE",
  trackColor: "#364658",
  positionX: 0.5,
  positionY: 0.5,
  size: 0.18,
  barWidth: 0.58
});

export const NUMBER_COUNTER_DEFINITION: EffectToolDefinition<NumberCounterParams, AuthorizedEffectInputs, NumberCounterOutput> = {
  effectId: "fx.data.numberCounter",
  toolName: "number_counter",
  displayName: "数值滚动",
  version: "2.0.0",
  category: "data",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: [
      "format", "duration", "easing", "fromValue", "toValue", "numberColor", "progressColor",
      "trackColor", "positionX", "positionY", "size", "barWidth"
    ],
    properties: {
      format: { type: "string", enum: ["integer", "decimal_1", "decimal_2", "percent"], default: "integer" },
      duration: { type: "number", minimum: 0.1, maximum: 30, default: 1.2 },
      easing: { type: "string", enum: ["linear", "ease_out", "smooth"], default: "ease_out" },
      fromValue: { type: "number", minimum: -1000000000, maximum: 1000000000, default: 0 },
      toValue: { type: "number", minimum: -1000000000, maximum: 1000000000, default: 100 },
      numberColor: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", default: "#68EEFF" },
      progressColor: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", default: "#FF58AE" },
      trackColor: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", default: "#364658" },
      positionX: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      positionY: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      size: { type: "number", minimum: 0.05, maximum: 0.8, default: 0.18 },
      barWidth: { type: "number", minimum: 0.05, maximum: 0.95, default: 0.58 }
    }
  },
  defaults,
  presets: [
    { presetId: "number-counter.fast", displayName: "快速计数", params: { ...defaults, duration: 0.6 } },
    { presetId: "number-counter.precise", displayName: "精确小数", params: { ...defaults, format: "decimal_2", duration: 1.5, easing: "smooth" } },
    { presetId: "number-counter.percent", displayName: "百分比", params: { ...defaults, format: "percent", duration: 1 } }
  ],
  inputSlots: [{ name: "source_image", kind: "image", required: true, cardinality: "one", description: "Owner-authorized background image used for visual placement." }],
  primaryBackend: CPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "The counter requires the deterministic server compositor." },
  performanceGrade: "light",
  normalizeParams: (params) => ({
    ...params,
    duration: round(params.duration),
    fromValue: round(params.fromValue),
    toValue: round(params.toValue),
    numberColor: params.numberColor.toLowerCase(),
    progressColor: params.progressColor.toLowerCase(),
    trackColor: params.trackColor.toLowerCase(),
    positionX: round(params.positionX),
    positionY: round(params.positionY),
    size: round(params.size),
    barWidth: round(params.barWidth)
  }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    singleBinding(context, "source_image");
    const progress = clamp(context.time / params.duration);
    const eased = ease(progress, params.easing);
    const value = params.fromValue * (1 - eased) + params.toValue * eased;
    return {
      kind: "metadata",
      backendId: CPU_BACKEND.backendId,
      output: Object.freeze({
        progress: round(progress),
        value: round(value),
        formatted: formatNumber(value, params.format),
        numberColor: params.numberColor,
        progressColor: params.progressColor,
        trackColor: params.trackColor,
        positionX: params.positionX,
        positionY: params.positionY,
        size: params.size,
        barWidth: params.barWidth
      }),
      degraded: false,
      warnings: []
    };
  }
};
