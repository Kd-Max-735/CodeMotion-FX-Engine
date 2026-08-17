import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_04_BACKEND,
  REJECT_FALLBACK,
  bounded,
  boundedInt,
  fixedSteps,
  requireImageInput,
  rounded,
  simulationResult,
  validParams,
  type SimulationPoint
} from "./runtime.js";

export interface SpringParams extends JsonObject {
  nodeCount: number;
  stiffness: number;
  damping: number;
  gravity: number;
  restLength: number;
  impulseStrength: number;
  substeps: number;
  anchorMode: "first" | "both" | "none";
}

export const SPRING_DEFAULTS: SpringParams = {
  nodeCount: 12,
  stiffness: 38,
  damping: 2.4,
  gravity: 4,
  restLength: 0.12,
  impulseStrength: 1.5,
  substeps: 2,
  anchorMode: "first"
};

function normalize(params: Readonly<SpringParams>): SpringParams {
  return {
    nodeCount: boundedInt(params.nodeCount, 3, 32, SPRING_DEFAULTS.nodeCount),
    stiffness: rounded(bounded(params.stiffness, 5, 120, SPRING_DEFAULTS.stiffness), 1),
    damping: rounded(bounded(params.damping, 0.1, 10, SPRING_DEFAULTS.damping), 2),
    gravity: rounded(bounded(params.gravity, 0, 20, SPRING_DEFAULTS.gravity), 2),
    restLength: rounded(bounded(params.restLength, 0.03, 0.3, SPRING_DEFAULTS.restLength), 3),
    impulseStrength: rounded(bounded(params.impulseStrength, 0, 12, SPRING_DEFAULTS.impulseStrength), 2),
    substeps: boundedInt(params.substeps, 1, 4, SPRING_DEFAULTS.substeps),
    anchorMode: params.anchorMode === "both" || params.anchorMode === "none" ? params.anchorMode : "first"
  };
}

export const SPRING_DEFINITION: EffectToolDefinition<SpringParams> = {
  effectId: "fx.sim.spring",
  toolName: "sim_spring",
  displayName: "弹簧动力学",
  version: "1.0.0",
  category: "simulation",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      nodeCount: { type: "integer", minimum: 3, maximum: 32, default: 12 },
      stiffness: { type: "number", minimum: 5, maximum: 120, multipleOf: 0.1, default: 38 },
      damping: { type: "number", minimum: 0.1, maximum: 10, multipleOf: 0.01, default: 2.4 },
      gravity: { type: "number", minimum: 0, maximum: 20, multipleOf: 0.01, default: 4 },
      restLength: { type: "number", minimum: 0.03, maximum: 0.3, multipleOf: 0.001, default: 0.12 },
      impulseStrength: { type: "number", minimum: 0, maximum: 12, multipleOf: 0.01, default: 1.5 },
      substeps: { type: "integer", minimum: 1, maximum: 4, default: 2 },
      anchorMode: { type: "string", enum: ["first", "both", "none"], default: "first" }
    }
  },
  defaults: SPRING_DEFAULTS,
  presets: [
    { presetId: "spring.soft", displayName: "柔软摆动", params: { ...SPRING_DEFAULTS, stiffness: 14, damping: 1.1, gravity: 2.5, impulseStrength: 1 } },
    { presetId: "spring.tight", displayName: "紧致回弹", params: { ...SPRING_DEFAULTS, stiffness: 82, damping: 4.2, substeps: 4, impulseStrength: 3 } },
    { presetId: "spring.bridge", displayName: "双端悬挂", params: { ...SPRING_DEFAULTS, nodeCount: 20, anchorMode: "both", gravity: 8, restLength: 0.08 } }
  ],
  inputSlots: [{ name: "source_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的弹簧动力学背景和负载图像。" }],
  primaryBackend: BATCH_04_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: normalize,
  validateParams: validParams,
  render: (context, rawParams) => {
    requireImageInput(context, "source_image");
    const params = normalize(rawParams);
    const steps = fixedSteps(context, 60, 360);
    const nodes: SimulationPoint[] = Array.from({ length: params.nodeCount }, (_, index) => ({
      x: -0.7 + index * params.restLength,
      y: -0.35,
      vx: 0,
      vy: index === Math.floor(params.nodeCount / 2) ? -params.impulseStrength : 0
    }));
    const fixed = (index: number): boolean => params.anchorMode === "both"
      ? index === 0 || index === nodes.length - 1
      : params.anchorMode === "first" && index === 0;
    const dt = steps.dt / params.substeps;
    for (let step = 0; step < steps.count; step += 1) {
      for (let substep = 0; substep < params.substeps; substep += 1) {
        const forces = nodes.map(() => ({ x: 0, y: params.gravity }));
        for (let index = 0; index < nodes.length - 1; index += 1) {
          const left = nodes[index]!;
          const right = nodes[index + 1]!;
          const dx = right.x - left.x;
          const dy = right.y - left.y;
          const distance = Math.max(1e-6, Math.hypot(dx, dy));
          const extension = distance - params.restLength;
          const relativeVelocity = ((right.vx - left.vx) * dx + (right.vy - left.vy) * dy) / distance;
          const force = params.stiffness * extension + params.damping * relativeVelocity;
          const fx = force * dx / distance;
          const fy = force * dy / distance;
          forces[index]!.x += fx;
          forces[index]!.y += fy;
          forces[index + 1]!.x -= fx;
          forces[index + 1]!.y -= fy;
        }
        for (let index = 0; index < nodes.length; index += 1) {
          if (fixed(index)) continue;
          const node = nodes[index]!;
          const force = forces[index]!;
          node.vx += force.x * dt;
          node.vy += force.y * dt;
          node.vx *= Math.max(0, 1 - params.damping * 0.04 * dt);
          node.vy *= Math.max(0, 1 - params.damping * 0.04 * dt);
          node.x += node.vx * dt;
          node.y += node.vy * dt;
          if (node.y > 0.95) {
            node.y = 0.95;
            node.vy *= -0.25;
          }
        }
      }
    }
    const strain = nodes.slice(1).reduce((sum, node, index) => {
      const previous = nodes[index]!;
      return sum + Math.abs(Math.hypot(node.x - previous.x, node.y - previous.y) - params.restLength);
    }, 0) / (nodes.length - 1);
    return simulationResult("fx.sim.spring", steps.count, steps.dt,
      { nodes: nodes.map((node) => ({ x: rounded(node.x), y: rounded(node.y), vx: rounded(node.vx), vy: rounded(node.vy) })) },
      { nodeCount: nodes.length, meanAbsoluteStrain: rounded(strain), substeps: params.substeps },
      steps.capped);
  }
};
