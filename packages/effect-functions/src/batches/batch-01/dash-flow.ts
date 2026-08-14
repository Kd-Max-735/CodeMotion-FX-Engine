import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, effectResult, enumField,
  numberField, parameterSchema, pathLength, readPath, round, slicePath
} from "./common.js";

export interface DashFlowParams extends JsonObject {
  dashLength: number;
  gapLength: number;
  speed: number;
  direction: string;
  offset: number;
  lineCap: string;
}

const defaults: DashFlowParams = {
  dashLength: 32, gapLength: 18, speed: 80, direction: "forward", offset: 0, lineCap: "round"
};

export const DASH_FLOW_DEFINITION: EffectToolDefinition<DashFlowParams> = {
  effectId: "fx.vector.dashFlow",
  toolName: "dash_flow",
  displayName: "虚线沿路径流动",
  version: "1.0.0",
  category: "vector",
  parameterSchema: parameterSchema({
    dashLength: numberField(32, 1, 500),
    gapLength: numberField(18, 1, 500),
    speed: numberField(80, 0, 2000),
    direction: enumField("forward", ["forward", "reverse"]),
    offset: numberField(0, -2000, 2000),
    lineCap: enumField("round", ["butt", "round", "square"])
  }),
  defaults,
  presets: [
    { presetId: "dash_flow.signal", displayName: "信号流", params: { ...defaults } },
    { presetId: "dash_flow.march", displayName: "行进蚁线", params: { ...defaults, dashLength: 10, gapLength: 8, speed: 45, lineCap: "butt" } },
    { presetId: "dash_flow.comet", displayName: "长梭流", params: { ...defaults, dashLength: 90, gapLength: 28, speed: 180 } }
  ],
  inputSlots: [{ name: "source_path", kind: "data", required: true, cardinality: "one", description: "Server-bound path used for dash placement." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "light",
  normalizeParams: (params) => ({ ...params, speed: round(params.speed, 3), offset: round(params.offset, 3) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const path = readPath(context, "source_path");
    const total = pathLength(path.points, path.closed);
    const cycle = params.dashLength + params.gapLength;
    const direction = params.direction === "forward" ? 1 : -1;
    const movingOffset = ((params.offset + context.time * params.speed * direction) % cycle + cycle) % cycle;
    const segments: { start: number; end: number; points: ReturnType<typeof slicePath> }[] = [];
    for (let distance = -movingOffset; distance < total; distance += cycle) {
      const start = Math.max(0, distance);
      const end = Math.min(total, distance + params.dashLength);
      if (end > start) segments.push({ start: round(start), end: round(end), points: slicePath(path, start / total, end / total, 6) });
    }
    return effectResult("metadata", {
      algorithm: "arc_length_dash_segmentation",
      segments,
      lineCap: params.lineCap,
      cycleOffset: round(movingOffset)
    });
  }
};
