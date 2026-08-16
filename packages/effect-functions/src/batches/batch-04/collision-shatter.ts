import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_04_BACKEND,
  REJECT_FALLBACK,
  bounded,
  boundedInt,
  createRng,
  fixedSteps,
  pointList,
  rounded,
  simulationResult,
  validParams
} from "./runtime.js";

export interface CollisionShatterParams extends JsonObject {
  fragmentCount: number;
  impactStrength: number;
  spreadAngle: number;
  gravity: number;
  drag: number;
  spin: number;
  restitution: number;
  randomness: number;
}

export const COLLISION_SHATTER_DEFAULTS: CollisionShatterParams = {
  fragmentCount: 24,
  impactStrength: 4.5,
  spreadAngle: 220,
  gravity: 8,
  drag: 0.5,
  spin: 4,
  restitution: 0.35,
  randomness: 0.45
};

function normalize(params: Readonly<CollisionShatterParams>): CollisionShatterParams {
  return {
    fragmentCount: boundedInt(params.fragmentCount, 4, 64, COLLISION_SHATTER_DEFAULTS.fragmentCount),
    impactStrength: rounded(bounded(params.impactStrength, 0.1, 12, COLLISION_SHATTER_DEFAULTS.impactStrength), 2),
    spreadAngle: rounded(bounded(params.spreadAngle, 10, 360, COLLISION_SHATTER_DEFAULTS.spreadAngle), 1),
    gravity: rounded(bounded(params.gravity, 0, 20, COLLISION_SHATTER_DEFAULTS.gravity), 2),
    drag: rounded(bounded(params.drag, 0, 5, COLLISION_SHATTER_DEFAULTS.drag), 2),
    spin: rounded(bounded(params.spin, 0, 12, COLLISION_SHATTER_DEFAULTS.spin), 2),
    restitution: rounded(bounded(params.restitution, 0, 1, COLLISION_SHATTER_DEFAULTS.restitution), 2),
    randomness: rounded(bounded(params.randomness, 0, 1, COLLISION_SHATTER_DEFAULTS.randomness), 2)
  };
}

export const COLLISION_SHATTER_DEFINITION: EffectToolDefinition<CollisionShatterParams> = {
  effectId: "fx.sim.collisionShatter",
  toolName: "sim_collision_shatter",
  displayName: "碰撞碎裂",
  version: "1.0.0",
  category: "simulation",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      fragmentCount: { type: "integer", minimum: 4, maximum: 64, default: 24 },
      impactStrength: { type: "number", minimum: 0.1, maximum: 12, multipleOf: 0.01, default: 4.5 },
      spreadAngle: { type: "number", minimum: 10, maximum: 360, multipleOf: 0.1, default: 220 },
      gravity: { type: "number", minimum: 0, maximum: 20, multipleOf: 0.01, default: 8 },
      drag: { type: "number", minimum: 0, maximum: 5, multipleOf: 0.01, default: 0.5 },
      spin: { type: "number", minimum: 0, maximum: 12, multipleOf: 0.01, default: 4 },
      restitution: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.35 },
      randomness: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.45 }
    }
  },
  defaults: COLLISION_SHATTER_DEFAULTS,
  presets: [
    { presetId: "collision_shatter.crack", displayName: "轻微崩裂", params: { ...COLLISION_SHATTER_DEFAULTS, fragmentCount: 12, impactStrength: 1.5, spreadAngle: 80, spin: 1.2 } },
    { presetId: "collision_shatter.burst", displayName: "爆裂飞散", params: { ...COLLISION_SHATTER_DEFAULTS, fragmentCount: 48, impactStrength: 10, spreadAngle: 360, spin: 9, randomness: 0.8 } },
    { presetId: "collision_shatter.heavy", displayName: "重力坍落", params: { ...COLLISION_SHATTER_DEFAULTS, fragmentCount: 32, gravity: 16, drag: 1.4, restitution: 0.12 } }
  ],
  inputSlots: [
    { name: "mesh", kind: "model", required: false, cardinality: "one", description: "Optional owner-locked server source mesh." },
    { name: "fracture_map", kind: "data", required: false, cardinality: "one", description: "Optional owner-locked server fracture centroids and topology." }
  ],
  primaryBackend: BATCH_04_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: normalize,
  validateParams: validParams,
  render: (context, rawParams) => {
    const params = normalize(rawParams);
    const steps = fixedSteps(context, 60, 300);
    const rng = createRng(context.seed ^ 0x53484154);
    const fractureCentroids = pointList(context.inputs, "fracture_map", "centroids", params.fragmentCount);
    const meshVertices = pointList(context.inputs, "mesh", "vertices", params.fragmentCount);
    const spreadRadians = params.spreadAngle * Math.PI / 180;
    const fragments = Array.from({ length: params.fragmentCount }, (_, index) => {
      const source = fractureCentroids[index] ?? meshVertices[index];
      const baseAngle = -Math.PI / 2 - spreadRadians / 2 + spreadRadians * ((index + 0.5) / params.fragmentCount);
      const angle = baseAngle + (rng() - 0.5) * spreadRadians / params.fragmentCount * params.randomness * 3;
      const speed = params.impactStrength * (0.45 + rng() * 0.55 * params.randomness + (1 - params.randomness) * 0.25);
      const radius = 0.08 + 0.32 * Math.sqrt((index + 0.5) / params.fragmentCount);
      return {
        x: source?.x ?? Math.cos(index * 2.399963) * radius,
        y: source?.y ?? Math.sin(index * 2.399963) * radius - 0.15,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rotation: 0,
        angularVelocity: (rng() * 2 - 1) * params.spin,
        size: rounded(0.025 + rng() * 0.045, 4)
      };
    });
    let floorImpacts = 0;
    for (let step = 0; step < steps.count; step += 1) {
      const damping = Math.exp(-params.drag * steps.dt);
      for (const fragment of fragments) {
        fragment.vy += params.gravity * steps.dt;
        fragment.vx *= damping;
        fragment.vy *= damping;
        fragment.angularVelocity *= damping;
        fragment.x += fragment.vx * steps.dt;
        fragment.y += fragment.vy * steps.dt;
        fragment.rotation += fragment.angularVelocity * steps.dt;
        if (fragment.y > 1 - fragment.size) {
          fragment.y = 1 - fragment.size;
          if (fragment.vy > 0.05) floorImpacts += 1;
          fragment.vy *= -params.restitution;
          fragment.vx *= 0.82;
          fragment.angularVelocity *= 0.75;
        }
      }
    }
    const meanDistance = fragments.reduce((sum, fragment) => sum + Math.hypot(fragment.x, fragment.y + 0.15), 0)
      / fragments.length;
    return simulationResult("fx.sim.collisionShatter", steps.count, steps.dt,
      { fragments: fragments.map((fragment, index) => ({ id: index, x: rounded(fragment.x), y: rounded(fragment.y), vx: rounded(fragment.vx), vy: rounded(fragment.vy), rotation: rounded(fragment.rotation), size: fragment.size })) },
      { fragmentCount: fragments.length, floorImpacts, meanDistance: rounded(meanDistance), boundFractureMap: fractureCentroids.length > 0 },
      steps.capped);
  }
};
