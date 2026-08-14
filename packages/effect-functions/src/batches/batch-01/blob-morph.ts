import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, centroid, effectResult,
  integerField, numberField, parameterSchema, randomAt, readPath, roundPoint, samplePath
} from "./common.js";

export interface BlobMorphParams extends JsonObject {
  vertexCount: number;
  noiseAmount: number;
  noiseScale: number;
  tension: number;
  speed: number;
  rotation: number;
}

const defaults: BlobMorphParams = {
  vertexCount: 24, noiseAmount: 0.18, noiseScale: 3, tension: 0.65, speed: 0.5, rotation: 0
};

export const BLOB_MORPH_DEFINITION: EffectToolDefinition<BlobMorphParams> = {
  effectId: "fx.vector.blobMorph",
  toolName: "blob_morph",
  displayName: "有机液态形状变形",
  version: "1.0.0",
  category: "vector",
  parameterSchema: parameterSchema({
    vertexCount: integerField(24, 8, 128),
    noiseAmount: numberField(0.18, 0, 0.8),
    noiseScale: numberField(3, 1, 12),
    tension: numberField(0.65, 0, 1),
    speed: numberField(0.5, 0, 5),
    rotation: numberField(0, -360, 360)
  }),
  defaults,
  presets: [
    { presetId: "blob_morph.soft", displayName: "柔软呼吸", params: { ...defaults, noiseAmount: 0.1, tension: 0.82, speed: 0.25 } },
    { presetId: "blob_morph.liquid", displayName: "液态摆动", params: { ...defaults } },
    { presetId: "blob_morph.wild", displayName: "强烈有机", params: { ...defaults, vertexCount: 40, noiseAmount: 0.38, noiseScale: 6, tension: 0.35, speed: 1.2 } }
  ],
  inputSlots: [{ name: "source_shape", kind: "data", required: true, cardinality: "one", description: "Server-bound closed source contour." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, vertexCount: Math.round(params.vertexCount), noiseScale: Math.round(params.noiseScale) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const shape = readPath(context, "source_shape", 3);
    const center = centroid(shape.points);
    const angleOffset = params.rotation * Math.PI / 180;
    const raw = Array.from({ length: params.vertexCount }, (_, index) => {
      const progress = index / params.vertexCount;
      const source = samplePath(shape.points, true, progress);
      const dx = source.x - center.x;
      const dy = source.y - center.y;
      const radius = Math.hypot(dx, dy);
      const angle = Math.atan2(dy, dx) + angleOffset;
      let noise = 0;
      for (let harmonic = 1; harmonic <= params.noiseScale; harmonic += 1) {
        const phase = randomAt(context.seed, harmonic) * Math.PI * 2;
        noise += Math.sin(angle * harmonic + phase + context.time * params.speed * (harmonic % 2 === 0 ? -1 : 1)) / harmonic;
      }
      const scale = 1 + noise * params.noiseAmount;
      return { x: center.x + Math.cos(angle) * radius * scale, y: center.y + Math.sin(angle) * radius * scale };
    });
    const points = raw.map((point, index) => {
      const previous = raw[(index - 1 + raw.length) % raw.length]!;
      const next = raw[(index + 1) % raw.length]!;
      const smooth = { x: (previous.x + point.x * 2 + next.x) / 4, y: (previous.y + point.y * 2 + next.y) / 4 };
      return roundPoint({
        x: point.x * (1 - params.tension) + smooth.x * params.tension,
        y: point.y * (1 - params.tension) + smooth.y * params.tension
      });
    });
    return effectResult("metadata", { algorithm: "harmonic_radial_blob", points, closed: true, center: roundPoint(center) });
  }
};
