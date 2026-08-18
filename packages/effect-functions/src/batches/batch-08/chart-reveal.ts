import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "../../types.js";
import {
  CPU_BACKEND,
  JSON_SCHEMA,
  clamp,
  issuesOrValid,
  round,
  smoothstep
} from "./common.js";

export interface ChartRevealParams extends JsonObject {
  chartType: "line" | "bar" | "area" | "pie";
  duration: number;
  stagger: number;
  easing: "linear" | "smooth";
  direction: "forward" | "reverse";
  labels: string[];
  values: number[];
  colors: string[];
}

export interface ChartRevealItem {
  readonly label: string;
  readonly value: number;
  readonly color: string;
  readonly reveal: number;
}

export interface ChartRevealOutput {
  readonly chartType: ChartRevealParams["chartType"];
  readonly progress: number;
  readonly items: readonly ChartRevealItem[];
}

const defaults: ChartRevealParams = Object.freeze({
  chartType: "bar",
  duration: 1.5,
  stagger: 0.08,
  easing: "smooth",
  direction: "forward",
  labels: ["成分一", "成分二", "成分三"],
  values: [50, 30, 20],
  colors: ["#42dcff", "#ff58b0", "#7ef4aa"]
});

export const CHART_REVEAL_DEFINITION: EffectToolDefinition<ChartRevealParams, AuthorizedEffectInputs, ChartRevealOutput> = {
  effectId: "fx.data.chartReveal",
  toolName: "chart_reveal",
  displayName: "图表揭示",
  version: "1.1.0",
  category: "data",
  parameterSchema: {
    $schema: JSON_SCHEMA,
    type: "object",
    additionalProperties: false,
    required: ["chartType", "duration", "labels", "values", "colors"],
    properties: {
      chartType: { type: "string", enum: ["line", "bar", "area", "pie"], default: "bar" },
      duration: { type: "number", minimum: 0.2, maximum: 30, default: 1.5 },
      stagger: { type: "number", minimum: 0, maximum: 2, default: 0.08 },
      easing: { type: "string", enum: ["linear", "smooth"], default: "smooth" },
      direction: { type: "string", enum: ["forward", "reverse"], default: "forward" },
      labels: {
        type: "array", minItems: 2, maxItems: 12,
        items: { type: "string", minLength: 1, maxLength: 24 },
        default: ["成分一", "成分二", "成分三"]
      },
      values: {
        type: "array", minItems: 2, maxItems: 12,
        items: { type: "number", minimum: 0, maximum: 1000000 },
        default: [50, 30, 20]
      },
      colors: {
        type: "array", minItems: 2, maxItems: 12,
        items: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
        default: ["#42dcff", "#ff58b0", "#7ef4aa"]
      }
    }
  },
  defaults,
  presets: [
    { presetId: "chart-reveal.clean", displayName: "清晰柱图", params: { ...defaults, chartType: "bar", duration: 1.2, stagger: 0.06 } },
    { presetId: "chart-reveal.draw", displayName: "折线绘制", params: { ...defaults, chartType: "line", duration: 2, stagger: 0.04, easing: "linear" } },
    { presetId: "chart-reveal.reverse", displayName: "反向面积", params: { ...defaults, chartType: "area", duration: 1.6, stagger: 0.1, direction: "reverse" } }
  ],
  inputSlots: [],
  primaryBackend: CPU_BACKEND,
  fallbackStrategy: { kind: "reject", reason: "Chart rendering requires the deterministic CPU backend." },
  performanceGrade: "medium",
  normalizeParams: (params) => ({
    chartType: params.chartType,
    duration: round(params.duration),
    stagger: round(params.stagger),
    easing: params.easing,
    direction: params.direction,
    labels: [...params.labels],
    values: params.values.map((value) => round(value)),
    colors: params.colors.map((color) => color.toLowerCase())
  }),
  validateParams: (params) => issuesOrValid([
    ...(params.labels.length === params.values.length && params.values.length === params.colors.length
      ? [] : [{ path: "$.data", message: "labels, values and colors must have the same length." }]),
    ...(params.values.some((value) => value > 0)
      ? [] : [{ path: "$.data.values", message: "At least one chart value must be greater than zero." }])
  ]),
  render: (context, params) => {
    const series = params.labels.map((label, index) => Object.freeze({
      label,
      value: params.values[index]!,
      color: params.colors[index]!
    }));
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
