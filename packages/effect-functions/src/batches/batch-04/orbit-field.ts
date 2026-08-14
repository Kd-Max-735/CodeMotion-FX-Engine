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
  sampleBoundVectorField,
  simulationResult,
  validParams,
  vectorFieldBinding,
  type SimulationPoint
} from "./runtime.js";

export interface OrbitFieldParams extends JsonObject {
  particleCount: number;
  orbitStrength: number;
  tangentialSpeed: number;
  radialDamping: number;
  fieldScale: number;
  spread: number;
  direction: "clockwise" | "counterclockwise";
}

export const ORBIT_FIELD_DEFAULTS: OrbitFieldParams = {
  particleCount: 32,
  orbitStrength: 2.4,
  tangentialSpeed: 1.2,
  radialDamping: 0.8,
  fieldScale: 1,
  spread: 0.65,
  direction: "counterclockwise"
};

function normalize(params: Readonly<OrbitFieldParams>): OrbitFieldParams {
  return {
    particleCount: boundedInt(params.particleCount, 8, 96, ORBIT_FIELD_DEFAULTS.particleCount),
    orbitStrength: rounded(bounded(params.orbitStrength, 0.1, 8, ORBIT_FIELD_DEFAULTS.orbitStrength), 2),
    tangentialSpeed: rounded(bounded(params.tangentialSpeed, 0, 4, ORBIT_FIELD_DEFAULTS.tangentialSpeed), 2),
    radialDamping: rounded(bounded(params.radialDamping, 0, 5, ORBIT_FIELD_DEFAULTS.radialDamping), 2),
    fieldScale: rounded(bounded(params.fieldScale, 0.25, 4, ORBIT_FIELD_DEFAULTS.fieldScale), 2),
    spread: rounded(bounded(params.spread, 0.1, 1, ORBIT_FIELD_DEFAULTS.spread), 2),
    direction: params.direction === "clockwise" ? "clockwise" : "counterclockwise"
  };
}

export const ORBIT_FIELD_DEFINITION: EffectToolDefinition<OrbitFieldParams> = {
  effectId: "fx.particle.orbitField",
  toolName: "particle_orbit_field",
  displayName: "粒子轨道场",
  version: "1.0.0",
  category: "particle",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      particleCount: { type: "integer", minimum: 8, maximum: 96, default: 32 },
      orbitStrength: { type: "number", minimum: 0.1, maximum: 8, default: 2.4 },
      tangentialSpeed: { type: "number", minimum: 0, maximum: 4, default: 1.2 },
      radialDamping: { type: "number", minimum: 0, maximum: 5, default: 0.8 },
      fieldScale: { type: "number", minimum: 0.25, maximum: 4, default: 1 },
      spread: { type: "number", minimum: 0.1, maximum: 1, default: 0.65 },
      direction: { type: "string", enum: ["clockwise", "counterclockwise"], default: "counterclockwise" }
    }
  },
  defaults: ORBIT_FIELD_DEFAULTS,
  presets: [
    { presetId: "orbit_field.gentle", displayName: "柔和环流", params: { ...ORBIT_FIELD_DEFAULTS, particleCount: 24, orbitStrength: 1.2, tangentialSpeed: 0.7, radialDamping: 1.4 } },
    { presetId: "orbit_field.vortex", displayName: "紧凑涡旋", params: { ...ORBIT_FIELD_DEFAULTS, particleCount: 64, orbitStrength: 5.2, tangentialSpeed: 2.2, spread: 0.4 } },
    { presetId: "orbit_field.reverse", displayName: "反向宽轨", params: { ...ORBIT_FIELD_DEFAULTS, particleCount: 48, direction: "clockwise", fieldScale: 1.8, spread: 0.9 } }
  ],
  inputSlots: [{
    name: "vector_field",
    kind: "data",
    required: false,
    cardinality: "one",
    description: "Optional owner-locked server vector field; never exposed to model parameters."
  }],
  primaryBackend: BATCH_04_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: normalize,
  validateParams: validParams,
  render: (context, rawParams) => {
    const params = normalize(rawParams);
    const steps = fixedSteps(context);
    const rng = createRng(context.seed ^ 0x4f524249);
    const direction = params.direction === "clockwise" ? -1 : 1;
    const externalField = vectorFieldBinding(context.inputs);
    const particles: SimulationPoint[] = [];
    for (let index = 0; index < params.particleCount; index += 1) {
      const angle = (index / params.particleCount) * Math.PI * 2 + rng() * 0.15;
      const radius = params.spread * (0.35 + 0.65 * rng());
      particles.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: -Math.sin(angle) * params.tangentialSpeed * direction,
        vy: Math.cos(angle) * params.tangentialSpeed * direction
      });
    }
    for (let step = 0; step < steps.count; step += 1) {
      for (const particle of particles) {
        const radius = Math.max(0.08, Math.hypot(particle.x, particle.y));
        const radialX = particle.x / radius;
        const radialY = particle.y / radius;
        const targetRadius = params.spread * 0.65;
        const radialAcceleration = -params.orbitStrength * (radius - targetRadius);
        const tangentX = -radialY * direction;
        const tangentY = radialX * direction;
        const targetVx = tangentX * params.tangentialSpeed * params.fieldScale;
        const targetVy = tangentY * params.tangentialSpeed * params.fieldScale;
        const bound = externalField === undefined
          ? { x: 0, y: 0 }
          : sampleBoundVectorField(externalField, particle.x, particle.y);
        particle.vx += (radialX * radialAcceleration
          + (targetVx - particle.vx) * params.radialDamping + bound.x) * steps.dt;
        particle.vy += (radialY * radialAcceleration
          + (targetVy - particle.vy) * params.radialDamping + bound.y) * steps.dt;
        particle.x += particle.vx * steps.dt;
        particle.y += particle.vy * steps.dt;
      }
    }
    const state = particles.map((particle) => ({
      x: rounded(particle.x), y: rounded(particle.y),
      vx: rounded(particle.vx), vy: rounded(particle.vy)
    }));
    const meanRadius = particles.reduce((sum, particle) => sum + Math.hypot(particle.x, particle.y), 0)
      / particles.length;
    return simulationResult("fx.particle.orbitField", steps.count, steps.dt,
      { particles: state },
      { particleCount: particles.length, meanRadius: rounded(meanRadius), externalField: externalField !== undefined },
      steps.capped);
  }
};
