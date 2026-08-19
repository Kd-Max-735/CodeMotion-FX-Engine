import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, effectResult, enumField,
  numberField, parameterSchema, pathLength, round, slicePath, visualAnchors,
  type VisualAnchorName
} from "./common.js";

export interface DashFlowParams extends JsonObject {
  dashLength: number;
  gapLength: number;
  speed: number;
  direction: string;
  offset: number;
  lineCap: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  curve: number;
  color: string;
  thickness: number;
  startAnchor: VisualAnchorName;
  endAnchor: VisualAnchorName;
}

const defaults: DashFlowParams = {
  dashLength: 32, gapLength: 18, speed: 80, direction: "forward", offset: 0, lineCap: "round",
  startX: 0.15, startY: 0.5, endX: 0.85, endY: 0.5, curve: 0, color: "#20dcff", thickness: 3,
  startAnchor: "coordinates", endAnchor: "coordinates"
};

export const DASH_FLOW_DEFINITION: EffectToolDefinition<DashFlowParams> = {
  effectId: "fx.vector.dashFlow",
  toolName: "dash_flow",
  displayName: "虚线沿路径流动",
  version: "1.2.0",
  category: "vector",
  parameterSchema: parameterSchema({
    dashLength: numberField(32, 1, 500),
    gapLength: numberField(18, 1, 500),
    speed: numberField(80, 0, 2000),
    direction: enumField("forward", ["forward", "reverse"]),
    offset: numberField(0, -2000, 2000),
    lineCap: enumField("round", ["butt", "round", "square"]),
    startX: numberField(0.15, 0, 1),
    startY: numberField(0.5, 0, 1),
    endX: numberField(0.85, 0, 1),
    endY: numberField(0.5, 0, 1),
    curve: numberField(0, -1, 1),
    color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$", default: "#20dcff" },
    thickness: numberField(3, 0.5, 30),
    startAnchor: enumField("coordinates", ["coordinates", "subject_left", "subject_right", "subject_top", "subject_bottom", "subject_center", "brightest"]),
    endAnchor: enumField("coordinates", ["coordinates", "subject_left", "subject_right", "subject_top", "subject_bottom", "subject_center", "brightest"])
  }),
  defaults,
  presets: [
    { presetId: "dash_flow.signal", displayName: "信号流", params: { ...defaults } },
    { presetId: "dash_flow.march", displayName: "行进蚁线", params: { ...defaults, dashLength: 10, gapLength: 8, speed: 45, lineCap: "butt" } },
    { presetId: "dash_flow.comet", displayName: "长梭流", params: { ...defaults, dashLength: 90, gapLength: 28, speed: 180 } }
  ],
  inputSlots: [{ name: "source_image", kind: "image", required: true, cardinality: "one", description: "Owner-authorized image under the generated dash path." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "light",
  normalizeParams: (params) => ({
    ...params,
    speed: round(params.speed, 3),
    offset: round(params.offset, 3),
    startX: round(params.startX),
    startY: round(params.startY),
    endX: round(params.endX),
    endY: round(params.endY),
    curve: round(params.curve),
    color: params.color.toLowerCase(),
    thickness: round(params.thickness, 2),
    startAnchor: params.startAnchor,
    endAnchor: params.endAnchor
  }),
  validateParams: (params) => {
    const invalidCoordinates = params.startAnchor === "coordinates" && params.endAnchor === "coordinates"
      && Math.hypot(params.endX - params.startX, params.endY - params.startY) < 0.02;
    const identicalDerivedAnchor = params.startAnchor !== "coordinates" && params.startAnchor === params.endAnchor;
    return invalidCoordinates || identicalDerivedAnchor
      ? { valid: false, issues: [{ path: "$.data", message: "Dash path endpoints must be distinct." }] }
      : VALID_PARAMS;
  },
  render: (context, params) => {
    const anchors = params.startAnchor === "coordinates" && params.endAnchor === "coordinates"
      ? undefined : visualAnchors(context, "source_image");
    const normalizedStart = params.startAnchor === "coordinates"
      ? { x: params.startX, y: params.startY } : anchors![params.startAnchor];
    const normalizedEnd = params.endAnchor === "coordinates"
      ? { x: params.endX, y: params.endY } : anchors![params.endAnchor];
    const start = { x: normalizedStart.x * (context.width - 1), y: normalizedStart.y * (context.height - 1) };
    const end = { x: normalizedEnd.x * (context.width - 1), y: normalizedEnd.y * (context.height - 1) };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) throw new RangeError("Resolved dash path has zero length.");
    const bend = params.curve * Math.min(context.width, context.height) * 0.45;
    const control = {
      x: (start.x + end.x) / 2 - dy / length * bend,
      y: (start.y + end.y) / 2 + dx / length * bend
    };
    const points = Array.from({ length: 49 }, (_, index) => {
      const t = index / 48;
      const inverse = 1 - t;
      return {
        x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
        y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
      };
    });
    const path = { points, closed: false };
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
      color: params.color,
      thickness: params.thickness,
      cycleOffset: round(movingOffset)
    });
  }
};
