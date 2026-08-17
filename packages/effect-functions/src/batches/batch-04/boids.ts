import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_04_BACKEND,
  REJECT_FALLBACK,
  bounded,
  boundedInt,
  createRng,
  fixedSteps,
  requireImageInput,
  rounded,
  simulationResult,
  validParams,
  type SimulationPoint
} from "./runtime.js";

export interface BoidsParams extends JsonObject {
  boidCount: number;
  maxSpeed: number;
  perceptionRadius: number;
  separation: number;
  alignment: number;
  cohesion: number;
  boundaryForce: number;
}

export const BOIDS_DEFAULTS: BoidsParams = {
  boidCount: 36,
  maxSpeed: 1.1,
  perceptionRadius: 0.28,
  separation: 1.8,
  alignment: 1.1,
  cohesion: 0.85,
  boundaryForce: 2.2
};

function normalize(params: Readonly<BoidsParams>): BoidsParams {
  return {
    boidCount: boundedInt(params.boidCount, 8, 96, BOIDS_DEFAULTS.boidCount),
    maxSpeed: rounded(bounded(params.maxSpeed, 0.1, 3, BOIDS_DEFAULTS.maxSpeed), 2),
    perceptionRadius: rounded(bounded(params.perceptionRadius, 0.05, 0.6, BOIDS_DEFAULTS.perceptionRadius), 2),
    separation: rounded(bounded(params.separation, 0, 5, BOIDS_DEFAULTS.separation), 2),
    alignment: rounded(bounded(params.alignment, 0, 5, BOIDS_DEFAULTS.alignment), 2),
    cohesion: rounded(bounded(params.cohesion, 0, 5, BOIDS_DEFAULTS.cohesion), 2),
    boundaryForce: rounded(bounded(params.boundaryForce, 0, 5, BOIDS_DEFAULTS.boundaryForce), 2)
  };
}

export const BOIDS_DEFINITION: EffectToolDefinition<BoidsParams> = {
  effectId: "fx.sim.boids",
  toolName: "sim_boids",
  displayName: "群集模拟",
  version: "1.0.0",
  category: "simulation",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      boidCount: { type: "integer", minimum: 8, maximum: 96, default: 36 },
      maxSpeed: { type: "number", minimum: 0.1, maximum: 3, multipleOf: 0.01, default: 1.1 },
      perceptionRadius: { type: "number", minimum: 0.05, maximum: 0.6, multipleOf: 0.01, default: 0.28 },
      separation: { type: "number", minimum: 0, maximum: 5, multipleOf: 0.01, default: 1.8 },
      alignment: { type: "number", minimum: 0, maximum: 5, multipleOf: 0.01, default: 1.1 },
      cohesion: { type: "number", minimum: 0, maximum: 5, multipleOf: 0.01, default: 0.85 },
      boundaryForce: { type: "number", minimum: 0, maximum: 5, multipleOf: 0.01, default: 2.2 }
    }
  },
  defaults: BOIDS_DEFAULTS,
  presets: [
    { presetId: "boids.school", displayName: "紧密鱼群", params: { ...BOIDS_DEFAULTS, boidCount: 64, perceptionRadius: 0.38, alignment: 2.4, cohesion: 2, separation: 1.2 } },
    { presetId: "boids.swarm", displayName: "躁动蜂群", params: { ...BOIDS_DEFAULTS, boidCount: 80, maxSpeed: 2.4, perceptionRadius: 0.16, separation: 3.8, alignment: 0.45 } },
    { presetId: "boids.drift", displayName: "舒缓迁徙", params: { ...BOIDS_DEFAULTS, boidCount: 24, maxSpeed: 0.55, alignment: 1.8, cohesion: 1.4, boundaryForce: 1 } }
  ],
  inputSlots: [{ name: "background_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的群集背景图；素材身份不进入模型参数。" }],
  primaryBackend: BATCH_04_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: normalize,
  validateParams: validParams,
  render: (context, rawParams) => {
    requireImageInput(context, "background_image");
    const params = normalize(rawParams);
    const steps = fixedSteps(context, 60, 300);
    const rng = createRng(context.seed ^ 0x424f4944);
    const boids: SimulationPoint[] = Array.from({ length: params.boidCount }, () => {
      const angle = rng() * Math.PI * 2;
      const speed = params.maxSpeed * (0.35 + rng() * 0.45);
      return {
        x: (rng() - 0.5) * 1.3,
        y: (rng() - 0.5) * 1.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed
      };
    });
    let totalNeighborSamples = 0;
    for (let step = 0; step < steps.count; step += 1) {
      const accelerations = boids.map((boid, index) => {
        let neighbors = 0;
        let meanX = 0;
        let meanY = 0;
        let meanVx = 0;
        let meanVy = 0;
        let separationX = 0;
        let separationY = 0;
        for (let otherIndex = 0; otherIndex < boids.length; otherIndex += 1) {
          if (otherIndex === index) continue;
          const other = boids[otherIndex]!;
          const dx = other.x - boid.x;
          const dy = other.y - boid.y;
          const distance = Math.hypot(dx, dy);
          if (distance <= 1e-6 || distance > params.perceptionRadius) continue;
          neighbors += 1;
          meanX += other.x;
          meanY += other.y;
          meanVx += other.vx;
          meanVy += other.vy;
          separationX -= dx / (distance ** 2);
          separationY -= dy / (distance ** 2);
        }
        totalNeighborSamples += neighbors;
        let ax = 0;
        let ay = 0;
        if (neighbors > 0) {
          ax += separationX / neighbors * params.separation;
          ay += separationY / neighbors * params.separation;
          ax += (meanVx / neighbors - boid.vx) * params.alignment;
          ay += (meanVy / neighbors - boid.vy) * params.alignment;
          ax += (meanX / neighbors - boid.x) * params.cohesion;
          ay += (meanY / neighbors - boid.y) * params.cohesion;
        }
        const margin = 0.72;
        if (boid.x < -margin) ax += params.boundaryForce;
        if (boid.x > margin) ax -= params.boundaryForce;
        if (boid.y < -margin) ay += params.boundaryForce;
        if (boid.y > margin) ay -= params.boundaryForce;
        return { x: ax, y: ay };
      });
      for (let index = 0; index < boids.length; index += 1) {
        const boid = boids[index]!;
        const acceleration = accelerations[index]!;
        boid.vx += acceleration.x * steps.dt;
        boid.vy += acceleration.y * steps.dt;
        const speed = Math.hypot(boid.vx, boid.vy);
        if (speed > params.maxSpeed) {
          boid.vx = boid.vx / speed * params.maxSpeed;
          boid.vy = boid.vy / speed * params.maxSpeed;
        }
        boid.x += boid.vx * steps.dt;
        boid.y += boid.vy * steps.dt;
      }
    }
    const meanSpeed = boids.reduce((sum, boid) => sum + Math.hypot(boid.vx, boid.vy), 0) / boids.length;
    const meanNeighbors = steps.count === 0 ? 0 : totalNeighborSamples / (steps.count * boids.length);
    return simulationResult("fx.sim.boids", steps.count, steps.dt,
      { boids: boids.map((boid, index) => ({ id: index, x: rounded(boid.x), y: rounded(boid.y), vx: rounded(boid.vx), vy: rounded(boid.vy) })) },
      { boidCount: boids.length, meanSpeed: rounded(meanSpeed), meanNeighbors: rounded(meanNeighbors) },
      steps.capped);
  }
};
