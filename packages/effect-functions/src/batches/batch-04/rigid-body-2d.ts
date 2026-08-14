import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_04_BACKEND,
  REJECT_FALLBACK,
  bounded,
  boundedInt,
  createRng,
  fixedSteps,
  rounded,
  simulationResult,
  validParams,
  type SimulationPoint
} from "./runtime.js";

export interface RigidBody2DParams extends JsonObject {
  bodyCount: number;
  gravity: number;
  restitution: number;
  friction: number;
  initialSpeed: number;
  bodyRadius: number;
  solverIterations: number;
}

export const RIGID_BODY_2D_DEFAULTS: RigidBody2DParams = {
  bodyCount: 12,
  gravity: 7.5,
  restitution: 0.55,
  friction: 0.25,
  initialSpeed: 1.2,
  bodyRadius: 0.065,
  solverIterations: 3
};

function normalize(params: Readonly<RigidBody2DParams>): RigidBody2DParams {
  return {
    bodyCount: boundedInt(params.bodyCount, 2, 48, RIGID_BODY_2D_DEFAULTS.bodyCount),
    gravity: rounded(bounded(params.gravity, 0, 20, RIGID_BODY_2D_DEFAULTS.gravity), 2),
    restitution: rounded(bounded(params.restitution, 0, 1, RIGID_BODY_2D_DEFAULTS.restitution), 2),
    friction: rounded(bounded(params.friction, 0, 1, RIGID_BODY_2D_DEFAULTS.friction), 2),
    initialSpeed: rounded(bounded(params.initialSpeed, 0, 5, RIGID_BODY_2D_DEFAULTS.initialSpeed), 2),
    bodyRadius: rounded(bounded(params.bodyRadius, 0.02, 0.15, RIGID_BODY_2D_DEFAULTS.bodyRadius), 3),
    solverIterations: boundedInt(params.solverIterations, 1, 8, RIGID_BODY_2D_DEFAULTS.solverIterations)
  };
}

export const RIGID_BODY_2D_DEFINITION: EffectToolDefinition<RigidBody2DParams> = {
  effectId: "fx.sim.rigidBody2D",
  toolName: "sim_rigid_body_2d",
  displayName: "二维刚体模拟",
  version: "1.0.0",
  category: "simulation",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      bodyCount: { type: "integer", minimum: 2, maximum: 48, default: 12 },
      gravity: { type: "number", minimum: 0, maximum: 20, default: 7.5 },
      restitution: { type: "number", minimum: 0, maximum: 1, default: 0.55 },
      friction: { type: "number", minimum: 0, maximum: 1, default: 0.25 },
      initialSpeed: { type: "number", minimum: 0, maximum: 5, default: 1.2 },
      bodyRadius: { type: "number", minimum: 0.02, maximum: 0.15, default: 0.065 },
      solverIterations: { type: "integer", minimum: 1, maximum: 8, default: 3 }
    }
  },
  defaults: RIGID_BODY_2D_DEFAULTS,
  presets: [
    { presetId: "rigid_body_2d.heavy", displayName: "沉重堆落", params: { ...RIGID_BODY_2D_DEFAULTS, bodyCount: 18, gravity: 14, restitution: 0.15, friction: 0.7 } },
    { presetId: "rigid_body_2d.bouncy", displayName: "高弹碰撞", params: { ...RIGID_BODY_2D_DEFAULTS, bodyCount: 20, restitution: 0.9, initialSpeed: 2.5, friction: 0.08 } },
    { presetId: "rigid_body_2d.crowd", displayName: "密集刚体", params: { ...RIGID_BODY_2D_DEFAULTS, bodyCount: 40, bodyRadius: 0.04, solverIterations: 6 } }
  ],
  inputSlots: [],
  primaryBackend: BATCH_04_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: normalize,
  validateParams: validParams,
  render: (context, rawParams) => {
    const params = normalize(rawParams);
    const steps = fixedSteps(context, 60, 300);
    const rng = createRng(context.seed ^ 0x52424732);
    const bodies: SimulationPoint[] = Array.from({ length: params.bodyCount }, (_, index) => ({
      x: -0.75 + (index % 8) * 0.2 + (rng() - 0.5) * 0.02,
      y: -0.8 + Math.floor(index / 8) * 0.16,
      vx: (rng() - 0.5) * params.initialSpeed,
      vy: (rng() - 0.5) * params.initialSpeed
    }));
    let collisionCount = 0;
    for (let step = 0; step < steps.count; step += 1) {
      for (const body of bodies) {
        body.vy += params.gravity * steps.dt;
        body.x += body.vx * steps.dt;
        body.y += body.vy * steps.dt;
      }
      for (let iteration = 0; iteration < params.solverIterations; iteration += 1) {
        for (let leftIndex = 0; leftIndex < bodies.length; leftIndex += 1) {
          const left = bodies[leftIndex]!;
          for (let rightIndex = leftIndex + 1; rightIndex < bodies.length; rightIndex += 1) {
            const right = bodies[rightIndex]!;
            const dx = right.x - left.x;
            const dy = right.y - left.y;
            const distance = Math.hypot(dx, dy);
            const minimumDistance = params.bodyRadius * 2;
            if (distance >= minimumDistance) continue;
            const safeDistance = Math.max(distance, 1e-6);
            const nx = distance < 1e-6 ? 1 : dx / safeDistance;
            const ny = distance < 1e-6 ? 0 : dy / safeDistance;
            const correction = (minimumDistance - safeDistance) * 0.5;
            left.x -= nx * correction;
            left.y -= ny * correction;
            right.x += nx * correction;
            right.y += ny * correction;
            const relativeNormal = (right.vx - left.vx) * nx + (right.vy - left.vy) * ny;
            if (relativeNormal < 0) {
              const impulse = -(1 + params.restitution) * relativeNormal * 0.5;
              left.vx -= impulse * nx;
              left.vy -= impulse * ny;
              right.vx += impulse * nx;
              right.vy += impulse * ny;
              const tangentX = -ny;
              const tangentY = nx;
              const tangentVelocity = (right.vx - left.vx) * tangentX + (right.vy - left.vy) * tangentY;
              const frictionImpulse = bounded(-tangentVelocity * 0.5, -impulse * params.friction, impulse * params.friction, 0);
              left.vx -= frictionImpulse * tangentX;
              left.vy -= frictionImpulse * tangentY;
              right.vx += frictionImpulse * tangentX;
              right.vy += frictionImpulse * tangentY;
              if (iteration === 0) collisionCount += 1;
            }
          }
        }
        for (const body of bodies) {
          if (body.x < -1 + params.bodyRadius || body.x > 1 - params.bodyRadius) {
            body.x = bounded(body.x, -1 + params.bodyRadius, 1 - params.bodyRadius, 0);
            body.vx *= -params.restitution;
            body.vy *= 1 - params.friction * 0.1;
          }
          if (body.y < -1 + params.bodyRadius || body.y > 1 - params.bodyRadius) {
            body.y = bounded(body.y, -1 + params.bodyRadius, 1 - params.bodyRadius, 0);
            body.vy *= -params.restitution;
            body.vx *= 1 - params.friction * 0.1;
          }
        }
      }
    }
    const kineticEnergy = bodies.reduce((sum, body) => sum + 0.5 * (body.vx ** 2 + body.vy ** 2), 0);
    return simulationResult("fx.sim.rigidBody2D", steps.count, steps.dt,
      { bodies: bodies.map((body, index) => ({ id: index, x: rounded(body.x), y: rounded(body.y), vx: rounded(body.vx), vy: rounded(body.vy), radius: params.bodyRadius })) },
      { bodyCount: bodies.length, collisionCount, kineticEnergy: rounded(kineticEnergy), solverIterations: params.solverIterations },
      steps.capped);
  }
};
