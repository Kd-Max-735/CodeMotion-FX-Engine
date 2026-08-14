import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, clamp, effectResult,
  enumField, integerField, numberField, parameterSchema, readPath, round,
  signedDistanceToPolygon, smoothstep
} from "./common.js";

export interface ShapeBooleanAnimateParams extends JsonObject {
  operation: string;
  progress: number;
  feather: number;
  resolution: number;
  easing: string;
}

const defaults: ShapeBooleanAnimateParams = {
  operation: "union", progress: 1, feather: 0, resolution: 48, easing: "smooth"
};

function combineDistance(operation: string, a: number, b: number): number {
  if (operation === "intersect") return Math.max(a, b);
  if (operation === "subtract") return Math.max(a, -b);
  if (operation === "xor") return Math.max(Math.min(a, b), -Math.max(a, b));
  return Math.min(a, b);
}

function alphaAt(distance: number, feather: number): number {
  return feather <= 0 ? (distance <= 0 ? 1 : 0) : 1 - smoothstep(-feather, feather, distance);
}

export const SHAPE_BOOLEAN_ANIMATE_DEFINITION: EffectToolDefinition<ShapeBooleanAnimateParams> = {
  effectId: "fx.vector.shapeBooleanAnimate",
  toolName: "shape_boolean_animate",
  displayName: "布尔图形动态组合",
  version: "1.0.0",
  category: "vector",
  parameterSchema: parameterSchema({
    operation: enumField("union", ["union", "intersect", "subtract", "xor"]),
    progress: numberField(1, 0, 1),
    feather: numberField(0, 0, 100),
    resolution: integerField(48, 16, 128),
    easing: enumField("smooth", ["linear", "smooth"])
  }),
  defaults,
  presets: [
    { presetId: "shape_boolean_animate.merge", displayName: "平滑合并", params: { ...defaults, operation: "union", feather: 2 } },
    { presetId: "shape_boolean_animate.cut", displayName: "图形切除", params: { ...defaults, operation: "subtract", feather: 1 } },
    { presetId: "shape_boolean_animate.overlap", displayName: "交集显现", params: { ...defaults, operation: "intersect", progress: 0.7, feather: 4 } }
  ],
  inputSlots: [
    { name: "shape_a", kind: "data", required: true, cardinality: "one", description: "Server-bound first closed shape." },
    { name: "shape_b", kind: "data", required: true, cardinality: "one", description: "Server-bound second closed shape." }
  ],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, progress: round(params.progress), resolution: Math.round(params.resolution) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const shapeA = readPath(context, "shape_a", 3);
    const shapeB = readPath(context, "shape_b", 3);
    const gridWidth = params.resolution;
    const gridHeight = clamp(Math.round(params.resolution * context.height / context.width), 16, 128);
    const eased = params.easing === "smooth"
      ? params.progress * params.progress * (3 - 2 * params.progress)
      : params.progress;
    const alpha: number[] = [];
    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        const point = { x: (x + 0.5) / gridWidth * context.width, y: (y + 0.5) / gridHeight * context.height };
        const distanceA = signedDistanceToPolygon(point, shapeA.points);
        const distanceB = signedDistanceToPolygon(point, shapeB.points);
        const base = alphaAt(distanceA, params.feather);
        const target = alphaAt(combineDistance(params.operation, distanceA, distanceB), params.feather);
        alpha.push(round(base + (target - base) * eased));
      }
    }
    return effectResult("frame", {
      algorithm: "signed_distance_boolean_raster",
      width: gridWidth,
      height: gridHeight,
      alpha,
      operation: params.operation,
      progress: round(eased)
    });
  }
};
