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
  validParams,
  type SimulationPoint
} from "./runtime.js";

export interface SoftBodyParams extends JsonObject {
  nodeCount: number;
  shapeRadius: number;
  stiffness: number;
  pressure: number;
  damping: number;
  gravity: number;
  solverIterations: number;
}

export const SOFT_BODY_DEFAULTS: SoftBodyParams = {
  nodeCount: 20,
  shapeRadius: 0.42,
  stiffness: 42,
  pressure: 3.5,
  damping: 2.2,
  gravity: 3,
  solverIterations: 3
};

function normalize(params: Readonly<SoftBodyParams>): SoftBodyParams {
  return {
    nodeCount: boundedInt(params.nodeCount, 8, 48, SOFT_BODY_DEFAULTS.nodeCount),
    shapeRadius: rounded(bounded(params.shapeRadius, 0.15, 0.75, SOFT_BODY_DEFAULTS.shapeRadius), 2),
    stiffness: rounded(bounded(params.stiffness, 5, 100, SOFT_BODY_DEFAULTS.stiffness), 1),
    pressure: rounded(bounded(params.pressure, 0, 10, SOFT_BODY_DEFAULTS.pressure), 2),
    damping: rounded(bounded(params.damping, 0.1, 8, SOFT_BODY_DEFAULTS.damping), 2),
    gravity: rounded(bounded(params.gravity, 0, 20, SOFT_BODY_DEFAULTS.gravity), 2),
    solverIterations: boundedInt(params.solverIterations, 1, 6, SOFT_BODY_DEFAULTS.solverIterations)
  };
}

export const SOFT_BODY_DEFINITION: EffectToolDefinition<SoftBodyParams> = {
  effectId: "fx.sim.softBody",
  toolName: "sim_soft_body",
  displayName: "软体模拟",
  version: "1.0.0",
  category: "simulation",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      nodeCount: { type: "integer", minimum: 8, maximum: 48, default: 20 },
      shapeRadius: { type: "number", minimum: 0.15, maximum: 0.75, multipleOf: 0.01, default: 0.42 },
      stiffness: { type: "number", minimum: 5, maximum: 100, multipleOf: 0.1, default: 42 },
      pressure: { type: "number", minimum: 0, maximum: 10, multipleOf: 0.01, default: 3.5 },
      damping: { type: "number", minimum: 0.1, maximum: 8, multipleOf: 0.01, default: 2.2 },
      gravity: { type: "number", minimum: 0, maximum: 20, multipleOf: 0.01, default: 3 },
      solverIterations: { type: "integer", minimum: 1, maximum: 6, default: 3 }
    }
  },
  defaults: SOFT_BODY_DEFAULTS,
  presets: [
    { presetId: "soft_body.jelly", displayName: "果冻弹性", params: { ...SOFT_BODY_DEFAULTS, stiffness: 18, pressure: 5.5, damping: 1.2 } },
    { presetId: "soft_body.rubber", displayName: "紧实橡胶", params: { ...SOFT_BODY_DEFAULTS, stiffness: 78, pressure: 2.5, damping: 4, solverIterations: 5 } },
    { presetId: "soft_body.heavy", displayName: "沉重软体", params: { ...SOFT_BODY_DEFAULTS, nodeCount: 32, gravity: 12, pressure: 1.2, shapeRadius: 0.55 } }
  ],
  inputSlots: [
    { name: "source_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定、映射到软体表面的单张图像。" },
    { name: "mesh", kind: "model", required: false, cardinality: "one", description: "Optional owner-locked server mesh vertices used as the soft-body boundary." }
  ],
  primaryBackend: BATCH_04_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: normalize,
  validateParams: validParams,
  render: (context, rawParams) => {
    requireImageInput(context, "source_image");
    const params = normalize(rawParams);
    const steps = fixedSteps(context, 60, 300);
    const boundVertices = pointList(context.inputs, "mesh", "vertices", params.nodeCount);
    const nodes: SimulationPoint[] = Array.from({ length: params.nodeCount }, (_, index) => {
      const bound = boundVertices[index];
      const angle = index / params.nodeCount * Math.PI * 2;
      return {
        x: bound?.x ?? Math.cos(angle) * params.shapeRadius,
        y: bound?.y ?? Math.sin(angle) * params.shapeRadius - 0.25,
        vx: 0,
        vy: index === Math.floor(params.nodeCount * 0.25) ? -0.8 : 0
      };
    });
    const restLengths = nodes.map((node, index) => {
      const next = nodes[(index + 1) % nodes.length]!;
      return Math.hypot(next.x - node.x, next.y - node.y);
    });
    for (let step = 0; step < steps.count; step += 1) {
      const previous = nodes.map((node) => ({ x: node.x, y: node.y }));
      for (const node of nodes) {
        node.vy += params.gravity * steps.dt;
        node.x += node.vx * steps.dt;
        node.y += node.vy * steps.dt;
      }
      for (let iteration = 0; iteration < params.solverIterations; iteration += 1) {
        const centerX = nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
        const centerY = nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
        for (let index = 0; index < nodes.length; index += 1) {
          const node = nodes[index]!;
          const next = nodes[(index + 1) % nodes.length]!;
          const dx = next.x - node.x;
          const dy = next.y - node.y;
          const distance = Math.max(1e-6, Math.hypot(dx, dy));
          const error = (distance - restLengths[index]!) / distance;
          const correction = error * Math.min(0.5, params.stiffness * steps.dt ** 2) * 0.5;
          node.x += dx * correction;
          node.y += dy * correction;
          next.x -= dx * correction;
          next.y -= dy * correction;
          const radialX = node.x - centerX;
          const radialY = node.y - centerY;
          const radius = Math.max(1e-6, Math.hypot(radialX, radialY));
          const pressureCorrection = (params.shapeRadius - radius) * params.pressure * steps.dt ** 2;
          node.x += radialX / radius * pressureCorrection;
          node.y += radialY / radius * pressureCorrection;
        }
      }
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!;
        const old = previous[index]!;
        const velocityDamping = Math.exp(-params.damping * steps.dt);
        node.vx = (node.x - old.x) / steps.dt * velocityDamping;
        node.vy = (node.y - old.y) / steps.dt * velocityDamping;
        if (node.y > 0.95) {
          node.y = 0.95;
          node.vy *= -0.2;
          node.vx *= 0.8;
        }
      }
    }
    const centerX = nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
    const centerY = nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
    const meanRadius = nodes.reduce((sum, node) => sum + Math.hypot(node.x - centerX, node.y - centerY), 0) / nodes.length;
    return simulationResult("fx.sim.softBody", steps.count, steps.dt,
      { nodes: nodes.map((node) => ({ x: rounded(node.x), y: rounded(node.y), vx: rounded(node.vx), vy: rounded(node.vy) })) },
      { nodeCount: nodes.length, meanRadius: rounded(meanRadius), boundMesh: boundVertices.length >= params.nodeCount },
      steps.capped);
  }
};
