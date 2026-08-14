import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { COLOR_SCHEMA, REJECT_FALLBACK, SERVER_CPU_BACKEND, metadataResult,
  normalizeColor, round, schema, valid } from "./shared.js";

export interface SpiralTunnelParams extends JsonObject {
  turns: number;
  pointsPerTurn: number;
  radius: number;
  depth: number;
  twist: number;
  speed: number;
  strokeColor: string;
  backgroundColor: string;
}

const defaults: SpiralTunnelParams = {
  turns: 10, pointsPerTurn: 48, radius: 0.85, depth: 2.2, twist: 20,
  speed: 0.8, strokeColor: "#FEE440", backgroundColor: "#001219"
};
export const spiralTunnelDefinition: EffectToolDefinition<SpiralTunnelParams> = {
  effectId: "fx.gen.spiralTunnel",
  toolName: "spiral_tunnel",
  displayName: "螺旋隧道",
  version: "1.0.0",
  category: "generative",
  parameterSchema: schema({
    turns: { type: "integer", minimum: 2, maximum: 24, default: defaults.turns },
    pointsPerTurn: { type: "integer", minimum: 12, maximum: 96, default: defaults.pointsPerTurn },
    radius: { type: "number", minimum: 0.1, maximum: 2, default: defaults.radius },
    depth: { type: "number", minimum: 0.25, maximum: 4, default: defaults.depth },
    twist: { type: "number", minimum: -180, maximum: 180, default: defaults.twist },
    speed: { type: "number", minimum: -4, maximum: 4, default: defaults.speed },
    strokeColor: { ...COLOR_SCHEMA, default: defaults.strokeColor },
    backgroundColor: { ...COLOR_SCHEMA, default: defaults.backgroundColor }
  }),
  defaults,
  presets: [
    { presetId: "batch07.spiral.classic", displayName: "经典穿梭", params: { ...defaults } },
    { presetId: "batch07.spiral.tight", displayName: "密集光轨", params: { ...defaults, turns: 18, pointsPerTurn: 72, radius: 0.55, depth: 3.2, speed: 1.4 } },
    { presetId: "batch07.spiral.reverse", displayName: "反向宽隧道", params: { ...defaults, turns: 7, radius: 1.3, twist: -75, speed: -0.6, strokeColor: "#00F5D4" } }
  ],
  inputSlots: [],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, radius: round(params.radius), depth: round(params.depth),
    twist: round(params.twist, 3), speed: round(params.speed),
    strokeColor: normalizeColor(params.strokeColor), backgroundColor: normalizeColor(params.backgroundColor) }),
  validateParams: () => valid(),
  render: (context, params) => {
    const count = params.turns * params.pointsPerTurn;
    const phase = context.time * params.speed * Math.PI;
    const twist = params.twist * Math.PI / 180;
    const points = Array.from({ length: count }, (_, index) => {
      const progress = index / Math.max(1, count - 1);
      const angle = progress * params.turns * Math.PI * 2 + phase + progress * twist;
      const perspective = 1 / (1 + progress * params.depth);
      const radius = params.radius * perspective;
      return { x: round(Math.cos(angle) * radius, 5), y: round(Math.sin(angle) * radius, 5),
        z: round(progress, 5), opacity: round(1 - progress * 0.85, 5) };
    });
    return metadataResult({ algorithm: "perspective_archimedean_spiral", points,
      colors: [params.strokeColor, params.backgroundColor] });
  }
};
