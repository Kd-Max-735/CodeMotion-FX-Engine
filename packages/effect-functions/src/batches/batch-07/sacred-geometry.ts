import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { COLOR_SCHEMA, REJECT_FALLBACK, SERVER_CPU_BACKEND, metadataResult,
  normalizeColor, round, schema, valid } from "./shared.js";

type SacredPattern = "flower_of_life" | "metatron" | "sri_yantra";
type Point = { x: number; y: number };

export interface SacredGeometryParams extends JsonObject {
  pattern: SacredPattern;
  rings: number;
  symmetry: number;
  scale: number;
  rotation: number;
  speed: number;
  strokeColor: string;
  backgroundColor: string;
}

const defaults: SacredGeometryParams = {
  pattern: "flower_of_life", rings: 5, symmetry: 6, scale: 0.8,
  rotation: 0, speed: 0.12, strokeColor: "#FFD166", backgroundColor: "#073B4C"
};
function polar(radius: number, angle: number): Point {
  return { x: round(Math.cos(angle) * radius, 5), y: round(Math.sin(angle) * radius, 5) };
}

export const sacredGeometryDefinition: EffectToolDefinition<SacredGeometryParams> = {
  effectId: "fx.gen.sacredGeometry",
  toolName: "sacred_geometry",
  displayName: "神圣几何",
  version: "1.0.0",
  category: "generative",
  parameterSchema: schema({
    pattern: { type: "string", enum: ["flower_of_life", "metatron", "sri_yantra"], default: defaults.pattern },
    rings: { type: "integer", minimum: 1, maximum: 12, default: defaults.rings },
    symmetry: { type: "integer", minimum: 3, maximum: 24, default: defaults.symmetry },
    scale: { type: "number", minimum: 0.1, maximum: 2, default: defaults.scale },
    rotation: { type: "number", minimum: -180, maximum: 180, default: defaults.rotation },
    speed: { type: "number", minimum: -2, maximum: 2, default: defaults.speed },
    strokeColor: { ...COLOR_SCHEMA, default: defaults.strokeColor },
    backgroundColor: { ...COLOR_SCHEMA, default: defaults.backgroundColor }
  }),
  defaults,
  presets: [
    { presetId: "batch07.sacred.flower", displayName: "生命之花", params: { ...defaults } },
    { presetId: "batch07.sacred.metatron", displayName: "梅塔特隆", params: { ...defaults, pattern: "metatron", rings: 3, symmetry: 12, rotation: 15, strokeColor: "#F8F9FA", backgroundColor: "#212529" } },
    { presetId: "batch07.sacred.yantra", displayName: "室利延陀罗", params: { ...defaults, pattern: "sri_yantra", rings: 9, symmetry: 3, scale: 0.9, speed: -0.08, strokeColor: "#FFB703", backgroundColor: "#6A040F" } }
  ],
  inputSlots: [],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, scale: round(params.scale), rotation: round(params.rotation, 3),
    speed: round(params.speed), strokeColor: normalizeColor(params.strokeColor),
    backgroundColor: normalizeColor(params.backgroundColor) }),
  validateParams: () => valid(),
  render: (context, params) => {
    const rotation = (params.rotation + context.time * params.speed * 30) * Math.PI / 180;
    const circles: Array<{ x: number; y: number; radius: number }> = [];
    const lines: Array<{ from: Point; to: Point }> = [];
    if (params.pattern === "flower_of_life") {
      circles.push({ x: 0, y: 0, radius: round(params.scale / params.rings, 5) });
      for (let ring = 1; ring <= params.rings; ring += 1) {
        const radius = params.scale * ring / params.rings;
        for (let index = 0; index < params.symmetry; index += 1) {
          const center = polar(radius, rotation + index * Math.PI * 2 / params.symmetry);
          circles.push({ ...center, radius: round(params.scale / params.rings, 5) });
        }
      }
    } else if (params.pattern === "metatron") {
      const points: Point[] = [{ x: 0, y: 0 }];
      for (let ring = 1; ring <= params.rings; ring += 1) {
        for (let index = 0; index < params.symmetry; index += 1) {
          points.push(polar(params.scale * ring / params.rings,
            rotation + index * Math.PI * 2 / params.symmetry));
        }
      }
      points.forEach((point) => circles.push({ ...point, radius: round(params.scale * 0.035, 5) }));
      for (let index = 1; index < points.length; index += 1) lines.push({ from: points[0]!, to: points[index]! });
      for (let index = 1; index <= params.symmetry; index += 1) {
        lines.push({ from: points[index]!, to: points[index % params.symmetry + 1]! });
      }
    } else {
      for (let ring = 1; ring <= params.rings; ring += 1) {
        const radius = params.scale * ring / params.rings;
        const up = [0, 1, 2].map((index) => polar(radius, rotation - Math.PI / 2 + index * Math.PI * 2 / 3));
        const down = [0, 1, 2].map((index) => polar(radius, rotation + Math.PI / 2 + index * Math.PI * 2 / 3));
        for (let index = 0; index < 3; index += 1) {
          lines.push({ from: up[index]!, to: up[(index + 1) % 3]! });
          lines.push({ from: down[index]!, to: down[(index + 1) % 3]! });
        }
      }
    }
    return metadataResult({ algorithm: "bounded_polar_geometry", pattern: params.pattern,
      circles, lines, colors: [params.strokeColor, params.backgroundColor] });
  }
};
