import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { COLOR_SCHEMA, REJECT_FALLBACK, SERVER_CPU_BACKEND, clamp, hashSeed, invalid,
  metadataResult, normalizeColor, round, schema, seededRandom, valid } from "./shared.js";

export interface MetaballsParams extends JsonObject {
  seed: number;
  ballCount: number;
  gridSize: number;
  radius: number;
  threshold: number;
  speed: number;
  fillColor: string;
  backgroundColor: string;
}

const defaults: MetaballsParams = {
  seed: 31, ballCount: 8, gridSize: 32, radius: 0.12, threshold: 1.1,
  speed: 0.6, fillColor: "#FF006E", backgroundColor: "#03071E"
};

export const metaballsDefinition: EffectToolDefinition<MetaballsParams> = {
  effectId: "fx.gen.metaballs",
  toolName: "metaballs",
  displayName: "融球场",
  version: "1.0.0",
  category: "generative",
  parameterSchema: schema({
    seed: { type: "integer", minimum: 0, maximum: 2147483647, default: defaults.seed },
    ballCount: { type: "integer", minimum: 2, maximum: 32, default: defaults.ballCount },
    gridSize: { type: "integer", minimum: 8, maximum: 64, default: defaults.gridSize },
    radius: { type: "number", minimum: 0.02, maximum: 0.35, default: defaults.radius },
    threshold: { type: "number", minimum: 0.25, maximum: 4, default: defaults.threshold },
    speed: { type: "number", minimum: 0, maximum: 4, default: defaults.speed },
    fillColor: { ...COLOR_SCHEMA, default: defaults.fillColor },
    backgroundColor: { ...COLOR_SCHEMA, default: defaults.backgroundColor }
  }),
  defaults,
  presets: [
    { presetId: "batch07.metaballs.lava", displayName: "熔岩", params: { ...defaults } },
    { presetId: "batch07.metaballs.mercury", displayName: "水银", params: { ...defaults, seed: 8, ballCount: 14, radius: 0.08, threshold: 1.4, speed: 1.1, fillColor: "#E9ECEF", backgroundColor: "#212529" } },
    { presetId: "batch07.metaballs.amoeba", displayName: "缓慢变形", params: { ...defaults, ballCount: 5, radius: 0.2, threshold: 0.85, speed: 0.2, fillColor: "#80FFDB", backgroundColor: "#10002B" } }
  ],
  inputSlots: [{ name: "background_image", kind: "image", required: false, cardinality: "one",
    description: "Optional server-authorized image refracted by the animated metaballs." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, radius: round(params.radius), threshold: round(params.threshold),
    speed: round(params.speed), fillColor: normalizeColor(params.fillColor),
    backgroundColor: normalizeColor(params.backgroundColor) }),
  validateParams: (params) => params.gridSize ** 2 * params.ballCount <= 131_072
    ? valid()
    : invalid("$", "gridSize squared times ballCount must not exceed 131,072"),
  render: (context, params) => {
    const seed = hashSeed(context.seed, params.seed);
    const random = seededRandom(seed);
    const balls = Array.from({ length: params.ballCount }, (_, index) => {
      const originX = 0.15 + random() * 0.7;
      const originY = 0.15 + random() * 0.7;
      const phase = random() * Math.PI * 2 + context.time * params.speed * (0.35 + random());
      return { x: clamp(originX + Math.cos(phase + index) * 0.14, 0.02, 0.98),
        y: clamp(originY + Math.sin(phase * 0.83 + index) * 0.14, 0.02, 0.98),
        radius: params.radius * (0.7 + random() * 0.6) };
    });
    const field: number[] = [];
    for (let y = 0; y < params.gridSize; y += 1) {
      for (let x = 0; x < params.gridSize; x += 1) {
        const px = x / (params.gridSize - 1);
        const py = y / (params.gridSize - 1);
        const strength = balls.reduce((sum, ball) => {
          const distanceSquared = (px - ball.x) ** 2 + (py - ball.y) ** 2 + 0.0001;
          return sum + ball.radius ** 2 / distanceSquared;
        }, 0);
        field.push(round(clamp(strength / params.threshold, 0, 2), 5));
      }
    }
    return metadataResult({ algorithm: "inverse_square_implicit_field", width: params.gridSize,
      height: params.gridSize, field, threshold: 1, colors: [params.fillColor, params.backgroundColor], seed });
  }
};
