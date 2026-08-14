import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { COLOR_SCHEMA, REJECT_FALLBACK, SERVER_CPU_BACKEND, hashSeed, metadataResult,
  normalizeColor, round, schema, seededRandom, valid } from "./shared.js";

export interface VoronoiParams extends JsonObject {
  seed: number;
  pointCount: number;
  gridSize: number;
  jitter: number;
  speed: number;
  edgeWidth: number;
  cellColor: string;
  edgeColor: string;
}

const defaults: VoronoiParams = {
  seed: 23, pointCount: 24, gridSize: 32, jitter: 0.8, speed: 0.2,
  edgeWidth: 0.08, cellColor: "#90E0EF", edgeColor: "#023E8A"
};
export const voronoiDefinition: EffectToolDefinition<VoronoiParams> = {
  effectId: "fx.gen.voronoi",
  toolName: "voronoi",
  displayName: "沃罗诺伊图",
  version: "1.0.0",
  category: "generative",
  parameterSchema: schema({
    seed: { type: "integer", minimum: 0, maximum: 2147483647, default: defaults.seed },
    pointCount: { type: "integer", minimum: 4, maximum: 128, default: defaults.pointCount },
    gridSize: { type: "integer", minimum: 8, maximum: 64, default: defaults.gridSize },
    jitter: { type: "number", minimum: 0, maximum: 1, default: defaults.jitter },
    speed: { type: "number", minimum: -2, maximum: 2, default: defaults.speed },
    edgeWidth: { type: "number", minimum: 0.005, maximum: 0.3, default: defaults.edgeWidth },
    cellColor: { ...COLOR_SCHEMA, default: defaults.cellColor },
    edgeColor: { ...COLOR_SCHEMA, default: defaults.edgeColor }
  }),
  defaults,
  presets: [
    { presetId: "batch07.voronoi.glass", displayName: "玻璃胞", params: { ...defaults } },
    { presetId: "batch07.voronoi.mosaic", displayName: "细密马赛克", params: { ...defaults, seed: 52, pointCount: 72, gridSize: 48, jitter: 1, edgeWidth: 0.035 } },
    { presetId: "batch07.voronoi.stone", displayName: "缓动石纹", params: { ...defaults, pointCount: 14, jitter: 0.45, speed: 0.65, cellColor: "#ADB5BD", edgeColor: "#212529" } }
  ],
  inputSlots: [],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, jitter: round(params.jitter), speed: round(params.speed),
    edgeWidth: round(params.edgeWidth, 4), cellColor: normalizeColor(params.cellColor),
    edgeColor: normalizeColor(params.edgeColor) }),
  validateParams: () => valid(),
  render: (context, params) => {
    const seed = hashSeed(context.seed, params.seed);
    const random = seededRandom(seed);
    const columns = Math.ceil(Math.sqrt(params.pointCount));
    const rows = Math.ceil(params.pointCount / columns);
    const sites = Array.from({ length: params.pointCount }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const baseX = (column + 0.5) / columns;
      const baseY = (row + 0.5) / rows;
      const phase = context.time * params.speed + index * 2.399;
      const dx = ((random() - 0.5) * params.jitter + Math.sin(phase) * 0.08 * params.jitter) / columns;
      const dy = ((random() - 0.5) * params.jitter + Math.cos(phase) * 0.08 * params.jitter) / rows;
      return { x: round((baseX + dx + 1) % 1, 5), y: round((baseY + dy + 1) % 1, 5) };
    });
    const cells: number[] = [];
    const edges: number[] = [];
    for (let y = 0; y < params.gridSize; y += 1) {
      for (let x = 0; x < params.gridSize; x += 1) {
        const px = x / (params.gridSize - 1);
        const py = y / (params.gridSize - 1);
        let nearest = -1;
        let first = Infinity;
        let second = Infinity;
        sites.forEach((site, index) => {
          const distance = (site.x - px) ** 2 + (site.y - py) ** 2;
          if (distance < first) { second = first; first = distance; nearest = index; }
          else if (distance < second) second = distance;
        });
        cells.push(nearest);
        edges.push(second - first <= params.edgeWidth ** 2 ? 1 : 0);
      }
    }
    return metadataResult({ algorithm: "nearest_site_voronoi", width: params.gridSize,
      height: params.gridSize, sites, cells, edges, colors: [params.cellColor, params.edgeColor], seed });
  }
};
