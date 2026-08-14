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

export interface ChartRevealParams extends JsonObject {
  chartType: "line" | "bar" | "area" | "pie";
  duration: number;
  stagger: number;
  easing: "linear" | "smooth";
  direction: "forward" | "reverse";
}

export interface ChartRevealItem {
  readonly label: string;
  readonly value: number;
  readonly reveal: number;
}

export interface ChartRevealOutput {
  readonly chartType: ChartRevealParams["chartType"];
  readonly progress: number;
  readonly items: readonly ChartRevealItem[];
}

function parseChart(value: unknown): readonly { label: string; value: number }[] {
  if (!isRecord(value)) throw new TypeError("validated chart data must be an object.");
  assertExactKeys(value, ["version", "series"], "validated chart data");
  if (value.version !== "validated-chart-v1" || !Array.isArray(value.series)
    || value.series.length === 0 || value.series.length > 500) {
    throw new TypeError("validated chart data is invalid.");
  }
  return Object.freeze(value.series.map((item, index) => {
    if (!isRecord(item)) throw new TypeError(`chart item ${index} must be an object.`);
    assertExactKeys(item, ["label", "value"], `chart item ${index}`);
    if (typeof item.label !== "string" || item.label.length === 0 || item.label.length > 128) {
      throw new TypeError(`chart item ${index} label is invalid.`);
    }
    return Object.freeze({ label: item.label, value: finiteNumber(item.value, `chart item ${index} value`) });
  }));
}

const defaults: ChartRevealParams = Object.freeze({
  chartType: "bar",
  duration: 1.5,
  stagger: 0.08,
  easing: "smooth",
  direction: "forward"
});

export const CHART_REVEAL_DEFINITION: EffectToolDefinition<ChartRevealParams, AuthorizedEffectInputs, ChartRevealOutput> = {
  effectId: "fx.data.chartReveal",
  toolName: "chart_reveal",
  displayName: "图表揭示",
  version: "1.0.0",
  category: "data",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["chartType", "duration"],
    properties: {
      chartType: { type: "string", enum: ["line", "bar", "area", "pie"], default: "bar" },
      duration: { type: "number", minimum: 0.2, maximum: 30, default: 1.5 },
      stagger: { type: "number", minimum: 0, maximum: 2, default: 0.08 },
      easing: { type: "string", enum: ["linear", "smooth"], default: "smooth" },
      direction: { type: "string", enum: ["forward", "reverse"], default: "forward" }
    }
  },
  defaults,
  presets: [
    { presetId: "chart-reveal.clean", displayName: "清晰柱图", params: { chartType: "bar", duration: 1.2, stagger: 0.06, easing: "smooth", direction: "forward" } },
    { presetId: "chart-reveal.draw", displayName: "折线绘制", params: { chartType: "line", duration: 2, stagger: 0.04, easing: "linear", direction: "forward" } },
    { presetId: "chart-reveal.reverse", displayName: "反向面积", params: { chartType: "area", duration: 1.6, stagger: 0.1, easing: "smooth", direction: "reverse" } }
  ],
  inputSlots: [{ name: "chart_data", kind: "data", required: true, cardinality: "one", description: "Server-validated chart labels and finite numeric values." }],
  primaryBackend: CPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Chart rendering requires validated server data." },
  performanceGrade: "medium",
  normalizeParams: (params) => ({ chartType: params.chartType, duration: round(params.duration), stagger: round(params.stagger), easing: params.easing, direction: params.direction }),
  validateParams: () => ({ valid: true }),
  render: (context, params) => {
    const series = parseChart(singleBinding(context, "chart_data"));
    const elapsed = clamp(context.time, 0, params.duration + params.stagger * (series.length - 1));
    const ordered = params.direction === "reverse" ? [...series].reverse() : [...series];
    const items = ordered.map((item, index) => {
      const local = clamp((elapsed - index * params.stagger) / params.duration);
      return Object.freeze({ ...item, reveal: round(params.easing === "smooth" ? smoothstep(local) : local) });
    });
    const total = params.duration + params.stagger * Math.max(0, series.length - 1);
    return {
      kind: "metadata",
      backendId: CPU_BACKEND.backendId,
      output: Object.freeze({ chartType: params.chartType, progress: round(clamp(elapsed / total)), items: Object.freeze(items) }),
      degraded: false,
      warnings: []
    };
  }
};
