import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  REJECT_FALLBACK,
  SERVER_THREE_BACKEND,
  frameResult,
  round,
  seededUnit,
  timedProgress,
  valid,
  type Easing
} from "./common.js";

export interface ObjectExplodeParams extends JsonObject {
  startTime: number;
  duration: number;
  fragmentCount: number;
  explosionRadius: number;
  spinTurns: number;
  gravity: number;
  originX: number;
  originY: number;
  originZ: number;
  easing: Easing;
}

const defaults: ObjectExplodeParams = {
  startTime: 0,
  duration: 1.5,
  fragmentCount: 48,
  explosionRadius: 3,
  spinTurns: 1.5,
  gravity: 2.5,
  originX: 0,
  originY: 0,
  originZ: 0,
  easing: "ease_out"
};

export const OBJECT_EXPLODE_DEFINITION: EffectToolDefinition<ObjectExplodeParams> = {
  effectId: "fx.3d.objectExplode",
  toolName: "object_explode",
  displayName: "三维物体爆裂",
  version: "1.0.0",
  category: "3d",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      startTime: { type: "number", minimum: 0, maximum: 3600, default: 0 },
      duration: { type: "number", exclusiveMinimum: 0, maximum: 30, default: 1.5 },
      fragmentCount: { type: "integer", minimum: 4, maximum: 256, default: 48 },
      explosionRadius: { type: "number", minimum: 0.1, maximum: 20, default: 3 },
      spinTurns: { type: "number", minimum: 0, maximum: 10, default: 1.5 },
      gravity: { type: "number", minimum: -20, maximum: 20, default: 2.5 },
      originX: { type: "number", minimum: -10, maximum: 10, default: 0 },
      originY: { type: "number", minimum: -10, maximum: 10, default: 0 },
      originZ: { type: "number", minimum: -10, maximum: 10, default: 0 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_out" }
    }
  },
  defaults,
  presets: [
    { presetId: "object_explode.subtle", displayName: "轻微散开", params: { ...defaults, fragmentCount: 24, explosionRadius: 1.2, spinTurns: 0.4 } },
    { presetId: "object_explode.cinematic", displayName: "电影爆裂", params: { ...defaults } },
    { presetId: "object_explode.zero_gravity", displayName: "失重碎裂", params: { ...defaults, duration: 2.5, fragmentCount: 96, explosionRadius: 5, gravity: 0, spinTurns: 3 } }
  ],
  inputSlots: [{
    name: "source_model",
    kind: "model",
    required: true,
    cardinality: "one",
    description: "Owner-authorized server model whose geometry is partitioned into fragments."
  }],
  primaryBackend: SERVER_THREE_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const progress = timedProgress(context.time, params.startTime, params.duration, params.easing);
    const elapsed = Math.max(0, Math.min(params.duration, context.time - params.startTime));
    const fragments = Array.from({ length: params.fragmentCount }, (_, index) => {
      const azimuth = seededUnit(context.seed, index, 0) * Math.PI * 2;
      const elevation = (seededUnit(context.seed, index, 1) - 0.35) * Math.PI;
      const speed = params.explosionRadius * (0.55 + seededUnit(context.seed, index, 2) * 0.9);
      const horizontal = Math.cos(elevation) * speed * progress;
      return {
        fragment: index,
        position: [
          round(params.originX + Math.cos(azimuth) * horizontal),
          round(params.originY + Math.sin(elevation) * speed * progress - 0.5 * params.gravity * elapsed * elapsed),
          round(params.originZ + Math.sin(azimuth) * horizontal)
        ],
        rotation: [
          round(seededUnit(context.seed, index, 3) * params.spinTurns * 360 * progress),
          round(seededUnit(context.seed, index, 4) * params.spinTurns * 360 * progress),
          round(seededUnit(context.seed, index, 5) * params.spinTurns * 360 * progress)
        ]
      };
    });
    return frameResult(SERVER_THREE_BACKEND.backendId, {
      operation: "partition_and_transform_geometry",
      sourceSlot: "source_model",
      progress: round(progress),
      fragments
    });
  }
};
