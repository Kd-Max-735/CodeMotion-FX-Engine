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
  singleBinding,
  smoothstep
} from "./common.js";

export interface NumberCounterParams extends JsonObject {
  format: "integer" | "decimal_1" | "decimal_2" | "percent";
  duration: number;
  easing: "linear" | "ease_out" | "smooth";
}

export interface NumberCounterOutput {
  readonly progress: number;
  readonly value: number;
  readonly formatted: string;
}

function parseRange(value: unknown): { from: number; to: number } {
  if (!isRecord(value)) throw new TypeError("validated number range must be an object.");
  assertExactKeys(value, ["version", "from", "to"], "validated number range");
  if (value.version !== "validated-number-v1") throw new TypeError("validated number version is unsupported.");
  return {
    from: finiteNumber(value.from, "validated number from"),
    to: finiteNumber(value.to, "validated number to")
  };
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
  return `${(value * 100).toFixed(0)}%`;
}

const defaults: NumberCounterParams = Object.freeze({
  format: "integer",
  duration: 1.2,
  easing: "ease_out"
});

export const NUMBER_COUNTER_DEFINITION: EffectToolDefinition<NumberCounterParams, AuthorizedEffectInputs, NumberCounterOutput> = {
  effectId: "fx.data.numberCounter",
  toolName: "number_counter",
  displayName: "数值滚动",
  version: "1.0.0",
  category: "data",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["format", "duration"],
    properties: {
      format: { type: "string", enum: ["integer", "decimal_1", "decimal_2", "percent"], default: "integer" },
      duration: { type: "number", minimum: 0.1, maximum: 30, default: 1.2 },
      easing: { type: "string", enum: ["linear", "ease_out", "smooth"], default: "ease_out" }
    }
  },
  defaults,
  presets: [
    { presetId: "number-counter.fast", displayName: "快速计数", params: { format: "integer", duration: 0.6, easing: "ease_out" } },
    { presetId: "number-counter.precise", displayName: "精确小数", params: { format: "decimal_2", duration: 1.5, easing: "smooth" } },
    { presetId: "number-counter.percent", displayName: "百分比", params: { format: "percent", duration: 1, easing: "ease_out" } }
  ],
  inputSlots: [{ name: "number_range", kind: "data", required: true, cardinality: "one", description: "Server-validated numeric start and end values." }],
  primaryBackend: CPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "The counter requires a server-validated numeric range." },
  performanceGrade: "light",
  normalizeParams: (params) => ({ format: params.format, duration: round(params.duration), easing: params.easing }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const range = parseRange(singleBinding(context, "number_range"));
    const progress = clamp(context.time / params.duration);
    const value = range.from + (range.to - range.from) * ease(progress, params.easing);
    return {
      kind: "metadata",
      backendId: CPU_BACKEND.backendId,
      output: Object.freeze({ progress: round(progress), value: round(value), formatted: formatNumber(value, params.format) }),
      degraded: false,
      warnings: []
    };
  }
};
