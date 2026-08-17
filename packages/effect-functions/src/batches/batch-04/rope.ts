import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_04_BACKEND,
  REJECT_FALLBACK,
  bounded,
  boundedInt,
  fixedSteps,
  pointList,
  requireImageInput,
  rounded,
  simulationResult,
  validParams
} from "./runtime.js";

export interface RopeParams extends JsonObject {
  segmentCount: number;
  ropeLength: number;
  gravity: number;
  damping: number;
  stiffness: number;
  swingImpulse: number;
  solverIterations: number;
  anchorMode: "start" | "both";
}

export const ROPE_DEFAULTS: RopeParams = {
  segmentCount: 18,
  ropeLength: 1.25,
  gravity: 7,
  damping: 0.025,
  stiffness: 0.92,
  swingImpulse: 1.5,
  solverIterations: 5,
  anchorMode: "start"
};

function normalize(params: Readonly<RopeParams>): RopeParams {
  return {
    segmentCount: boundedInt(params.segmentCount, 6, 40, ROPE_DEFAULTS.segmentCount),
    ropeLength: rounded(bounded(params.ropeLength, 0.4, 1.8, ROPE_DEFAULTS.ropeLength), 2),
    gravity: rounded(bounded(params.gravity, 0, 20, ROPE_DEFAULTS.gravity), 2),
    damping: rounded(bounded(params.damping, 0, 0.2, ROPE_DEFAULTS.damping), 3),
    stiffness: rounded(bounded(params.stiffness, 0.1, 1, ROPE_DEFAULTS.stiffness), 2),
    swingImpulse: rounded(bounded(params.swingImpulse, 0, 8, ROPE_DEFAULTS.swingImpulse), 2),
    solverIterations: boundedInt(params.solverIterations, 1, 10, ROPE_DEFAULTS.solverIterations),
    anchorMode: params.anchorMode === "both" ? "both" : "start"
  };
}

export const ROPE_DEFINITION: EffectToolDefinition<RopeParams> = {
  effectId: "fx.sim.rope",
  toolName: "sim_rope",
  displayName: "绳索模拟",
  version: "1.0.0",
  category: "simulation",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      segmentCount: { type: "integer", minimum: 6, maximum: 40, default: 18 },
      ropeLength: { type: "number", minimum: 0.4, maximum: 1.8, multipleOf: 0.01, default: 1.25 },
      gravity: { type: "number", minimum: 0, maximum: 20, multipleOf: 0.01, default: 7 },
      damping: { type: "number", minimum: 0, maximum: 0.2, multipleOf: 0.001, default: 0.025 },
      stiffness: { type: "number", minimum: 0.1, maximum: 1, multipleOf: 0.01, default: 0.92 },
      swingImpulse: { type: "number", minimum: 0, maximum: 8, multipleOf: 0.01, default: 1.5 },
      solverIterations: { type: "integer", minimum: 1, maximum: 10, default: 5 },
      anchorMode: { type: "string", enum: ["start", "both"], default: "start" }
    }
  },
  defaults: ROPE_DEFAULTS,
  presets: [
    { presetId: "rope.pendulum", displayName: "单端摆绳", params: { ...ROPE_DEFAULTS, swingImpulse: 3.5, gravity: 9, damping: 0.012 } },
    { presetId: "rope.cable", displayName: "拉紧缆绳", params: { ...ROPE_DEFAULTS, anchorMode: "both", stiffness: 1, gravity: 3, solverIterations: 8 } },
    { presetId: "rope.loose", displayName: "松软长绳", params: { ...ROPE_DEFAULTS, segmentCount: 32, ropeLength: 1.7, stiffness: 0.55, damping: 0.06 } }
  ],
  inputSlots: [
    { name: "source_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的绳索模拟背景图像。" },
    { name: "pins", kind: "data", required: false, cardinality: "one", description: "Optional owner-locked server anchor points for the rope ends." }
  ],
  primaryBackend: BATCH_04_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: normalize,
  validateParams: validParams,
  render: (context, rawParams) => {
    requireImageInput(context, "source_image");
    const params = normalize(rawParams);
    const steps = fixedSteps(context, 60, 360);
    const pointCount = params.segmentCount + 1;
    const spacing = params.ropeLength / params.segmentCount;
    const anchors = pointList(context.inputs, "pins", "points", 2);
    const start = anchors[0] ?? { x: -0.55, y: -0.65 };
    const end = anchors[1] ?? { x: start.x + params.ropeLength * 0.7, y: start.y };
    const points = Array.from({ length: pointCount }, (_, index) => {
      const ratio = index / params.segmentCount;
      const x = params.anchorMode === "both" ? start.x + (end.x - start.x) * ratio : start.x;
      const y = params.anchorMode === "both" ? start.y + (end.y - start.y) * ratio : start.y + spacing * index;
      return { x, y, previousX: x - (index === pointCount - 1 ? params.swingImpulse * steps.dt : 0), previousY: y };
    });
    const pinned = (index: number): boolean => index === 0 || (params.anchorMode === "both" && index === pointCount - 1);
    for (let step = 0; step < steps.count; step += 1) {
      for (let index = 0; index < points.length; index += 1) {
        if (pinned(index)) continue;
        const point = points[index]!;
        const velocityX = (point.x - point.previousX) * (1 - params.damping);
        const velocityY = (point.y - point.previousY) * (1 - params.damping);
        point.previousX = point.x;
        point.previousY = point.y;
        point.x += velocityX;
        point.y += velocityY + params.gravity * steps.dt ** 2;
      }
      for (let iteration = 0; iteration < params.solverIterations; iteration += 1) {
        for (let index = 0; index < points.length - 1; index += 1) {
          const left = points[index]!;
          const right = points[index + 1]!;
          const dx = right.x - left.x;
          const dy = right.y - left.y;
          const distance = Math.max(1e-6, Math.hypot(dx, dy));
          const correction = (distance - spacing) / distance * params.stiffness;
          const leftPinned = pinned(index);
          const rightPinned = pinned(index + 1);
          const leftWeight = leftPinned ? 0 : rightPinned ? 1 : 0.5;
          const rightWeight = rightPinned ? 0 : leftPinned ? 1 : 0.5;
          left.x += dx * correction * leftWeight;
          left.y += dy * correction * leftWeight;
          right.x -= dx * correction * rightWeight;
          right.y -= dy * correction * rightWeight;
        }
        points[0]!.x = start.x;
        points[0]!.y = start.y;
        if (params.anchorMode === "both") {
          points[pointCount - 1]!.x = end.x;
          points[pointCount - 1]!.y = end.y;
        }
      }
    }
    const totalLength = points.slice(1).reduce((sum, point, index) => {
      const previous = points[index]!;
      return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
    }, 0);
    return simulationResult("fx.sim.rope", steps.count, steps.dt,
      { points: points.map((point, index) => ({ index, x: rounded(point.x), y: rounded(point.y), pinned: pinned(index) })) },
      { segmentCount: params.segmentCount, totalLength: rounded(totalLength), anchorCount: params.anchorMode === "both" ? 2 : 1 },
      steps.capped);
  }
};
