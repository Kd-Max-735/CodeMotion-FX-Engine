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

export interface FlowFieldParams extends JsonObject {
  particleCount: number;
  fieldStrength: number;
  fieldScale: number;
  turbulence: number;
  drag: number;
  advectionSpeed: number;
  spawnRadius: number;
}

export const FLOW_FIELD_DEFAULTS: FlowFieldParams = {
  particleCount: 180,
  fieldStrength: 1.8,
  fieldScale: 1.2,
  turbulence: 0.35,
  drag: 1.1,
  advectionSpeed: 1,
  spawnRadius: 0.8
};

function normalize(params: Readonly<FlowFieldParams>): FlowFieldParams {
  return {
    particleCount: boundedInt(params.particleCount, 32, 512, FLOW_FIELD_DEFAULTS.particleCount),
    fieldStrength: rounded(bounded(params.fieldStrength, 0.1, 6, FLOW_FIELD_DEFAULTS.fieldStrength), 2),
    fieldScale: rounded(bounded(params.fieldScale, 0.25, 4, FLOW_FIELD_DEFAULTS.fieldScale), 2),
    turbulence: rounded(bounded(params.turbulence, 0, 2, FLOW_FIELD_DEFAULTS.turbulence), 2),
    drag: rounded(bounded(params.drag, 0, 5, FLOW_FIELD_DEFAULTS.drag), 2),
    advectionSpeed: rounded(bounded(params.advectionSpeed, 0.1, 3, FLOW_FIELD_DEFAULTS.advectionSpeed), 2),
    spawnRadius: rounded(bounded(params.spawnRadius, 0.1, 1, FLOW_FIELD_DEFAULTS.spawnRadius), 2)
  };
}

export const FLOW_FIELD_DEFINITION: EffectToolDefinition<FlowFieldParams> = {
  effectId: "fx.particle.flowField",
  toolName: "particle_flow_field",
  displayName: "粒子流场",
  version: "1.1.0",
  category: "particle",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      particleCount: { type: "integer", minimum: 32, maximum: 512, default: 180 },
      fieldStrength: { type: "number", minimum: 0.1, maximum: 6, multipleOf: 0.01, default: 1.8 },
      fieldScale: { type: "number", minimum: 0.25, maximum: 4, multipleOf: 0.01, default: 1.2 },
      turbulence: { type: "number", minimum: 0, maximum: 2, multipleOf: 0.01, default: 0.35 },
      drag: { type: "number", minimum: 0, maximum: 5, multipleOf: 0.01, default: 1.1 },
      advectionSpeed: { type: "number", minimum: 0.1, maximum: 3, multipleOf: 0.01, default: 1 },
      spawnRadius: { type: "number", minimum: 0.1, maximum: 1, multipleOf: 0.01, default: 0.8 }
    }
  },
  defaults: FLOW_FIELD_DEFAULTS,
  presets: [
    { presetId: "flow_field.laminar", displayName: "平稳层流", params: { ...FLOW_FIELD_DEFAULTS, particleCount: 120, fieldStrength: 1, turbulence: 0.05, drag: 2 } },
    { presetId: "flow_field.gust", displayName: "快速阵风", params: { ...FLOW_FIELD_DEFAULTS, particleCount: 260, fieldStrength: 3.6, advectionSpeed: 2.2, turbulence: 0.55 } },
    { presetId: "flow_field.chaotic", displayName: "湍动流场", params: { ...FLOW_FIELD_DEFAULTS, particleCount: 360, fieldScale: 2.5, turbulence: 1.5, drag: 0.45 } }
  ],
  inputSlots: [
    { name: "background_image", kind: "image", required: true, cardinality: "one", description: "Owner-authorized image or decoded video frame receiving the flow field." },
    { name: "vector_field", kind: "data", required: false, cardinality: "one", description: "Optional owner-locked server vector grid; never exposed to model parameters." }
  ],
  primaryBackend: BATCH_04_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: normalize,
  validateParams: validParams,
  render: (context, rawParams) => {
    const params = normalize(rawParams);
    const steps = fixedSteps(context);
    const rng = createRng(context.seed ^ 0x464c4f57);
    const boundField = vectorFieldBinding(context.inputs);
    const particles: SimulationPoint[] = [];
    for (let index = 0; index < params.particleCount; index += 1) {
      const angle = rng() * Math.PI * 2;
      const radius = Math.sqrt(rng()) * params.spawnRadius;
      particles.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0 });
    }
    for (let step = 0; step < steps.count; step += 1) {
      const phase = step * steps.dt * params.advectionSpeed;
      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index]!;
        const proceduralAngle = Math.sin((particle.x + phase) * params.fieldScale * 2.1)
          + Math.cos((particle.y - phase * 0.7) * params.fieldScale * 1.7);
        const procedural = {
          x: Math.cos(proceduralAngle * Math.PI),
          y: Math.sin(proceduralAngle * Math.PI)
        };
        const external = boundField === undefined
          ? { x: 0, y: 0 }
          : sampleBoundVectorField(boundField, particle.x, particle.y);
        const jitter = Math.sin((index + 1) * 12.9898 + step * 0.7549) * params.turbulence;
        const accelerationX = (procedural.x + external.x) * params.fieldStrength + jitter;
        const accelerationY = (procedural.y + external.y) * params.fieldStrength - jitter * 0.6;
        particle.vx += (accelerationX - particle.vx * params.drag) * steps.dt;
        particle.vy += (accelerationY - particle.vy * params.drag) * steps.dt;
        particle.x += particle.vx * steps.dt * params.advectionSpeed;
        particle.y += particle.vy * steps.dt * params.advectionSpeed;
        if (particle.x < -1 || particle.x > 1) particle.x = -Math.sign(particle.x) * 0.98;
        if (particle.y < -1 || particle.y > 1) particle.y = -Math.sign(particle.y) * 0.98;
      }
    }
    const state = particles.map((particle) => ({
      x: rounded(particle.x), y: rounded(particle.y),
      vx: rounded(particle.vx), vy: rounded(particle.vy)
    }));
    const meanSpeed = particles.reduce((sum, particle) => sum + Math.hypot(particle.vx, particle.vy), 0)
      / particles.length;
    return simulationResult("fx.particle.flowField", steps.count, steps.dt,
      { particles: state },
      { particleCount: particles.length, meanSpeed: rounded(meanSpeed), externalField: boundField !== undefined },
      steps.capped);
  }
};
