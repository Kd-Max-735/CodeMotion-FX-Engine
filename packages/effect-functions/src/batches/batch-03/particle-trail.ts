import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_03_BACKEND,
  BATCH_03_REJECT_FALLBACK,
  CLOSED_SCHEMA,
  VALID_PARAMS,
  createParticleBuffer,
  particleTextureResult,
  rgbaInput,
  seededSigned,
  setParticle
} from "./shared.js";

export interface ParticleTrailParams extends JsonObject {
  emissionRate: number;
  trailLength: number;
  speed: number;
  width: number;
  fade: number;
  waviness: number;
  lifetime: number;
  startX: number;
  startY: number;
  trajectory: "linear" | "wave" | "orbit";
  direction: number;
  hue: number;
  saturation: number;
}

const defaults: ParticleTrailParams = {
  emissionRate: 180, trailLength: 1.2, speed: 220, width: 10, fade: 0.72,
  waviness: 0.18, lifetime: 1.6, startX: 0.5, startY: 0.5,
  trajectory: "orbit", direction: -20, hue: 195, saturation: 0.78
};

function hsvColor(hue: number, saturation: number): readonly number[] {
  const section = (((hue % 360) + 360) % 360) / 60;
  const chroma = Math.max(0, Math.min(1, saturation));
  const x = chroma * (1 - Math.abs(section % 2 - 1));
  const colors = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x],
    [0, x, chroma], [x, 0, chroma], [chroma, 0, x]];
  const rgb = colors[Math.floor(section) % 6]!;
  const offset = 1 - chroma;
  return [(rgb[0]! + offset) * 255, (rgb[1]! + offset) * 255, (rgb[2]! + offset) * 255, 255];
}

export const PARTICLE_TRAIL_DEFINITION: EffectToolDefinition<ParticleTrailParams> = {
  effectId: "fx.particle.trail",
  toolName: "particle_trail",
  displayName: "粒子拖尾",
  version: "1.0.0",
  category: "particle",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      emissionRate: { type: "number", minimum: 1, maximum: 5000, default: 180 },
      trailLength: { type: "number", minimum: 0.05, maximum: 10, default: 1.2 },
      speed: { type: "number", minimum: 0, maximum: 2000, default: 220 },
      width: { type: "number", minimum: 0.5, maximum: 200, default: 10 },
      fade: { type: "number", minimum: 0, maximum: 1, default: 0.72 },
      waviness: { type: "number", minimum: 0, maximum: 1, default: 0.18 },
      lifetime: { type: "number", minimum: 0.05, maximum: 20, default: 1.6 },
      startX: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      startY: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      trajectory: { type: "string", enum: ["linear", "wave", "orbit"], default: "orbit" },
      direction: { type: "number", minimum: -180, maximum: 180, default: -20 },
      hue: { type: "number", minimum: 0, maximum: 360, default: 195 },
      saturation: { type: "number", minimum: 0, maximum: 1, default: 0.78 }
    }
  },
  defaults,
  presets: [
    { presetId: "trail.silk", displayName: "丝带余辉", params: { ...defaults, emissionRate: 300, trailLength: 2.8, speed: 120, width: 18, fade: 0.45, waviness: 0.1, lifetime: 3.2, trajectory: "wave", hue: 285, saturation: 0.55 } },
    { presetId: "trail.comet", displayName: "彗星拖尾", params: { ...defaults } },
    { presetId: "trail.electric", displayName: "电光轨迹", params: { ...defaults, emissionRate: 520, trailLength: 0.55, speed: 620, width: 4, fade: 0.9, waviness: 0.7, lifetime: 0.65, trajectory: "linear", hue: 205, saturation: 1 } }
  ],
  inputSlots: [{ name: "source_image", kind: "image", required: false, cardinality: "one", description: "可选的服务端授权拖尾主体图像。" }],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const source = rgbaInput(context, "source_image", false);
    const historyWindow = Math.min(context.time, params.trailLength, params.lifetime);
    const count = Math.floor(params.emissionRate * historyWindow);
    const buffer = createParticleBuffer(context, count, "disc", source === undefined
      ? { glow: 0.82 }
      : { sourceComposite: { slot: "source_image", opacity: 1 }, glow: 0.82 });
    const originX = params.startX * context.width;
    const originY = params.startY * context.height;
    const direction = params.direction * Math.PI / 180;
    const minimumDimension = Math.min(context.width, context.height);
    const reflect = (value: number, size: number): number => {
      const maximum = Math.max(0, size - 1);
      if (maximum === 0) return 0;
      const period = maximum * 2;
      const wrapped = ((value % period) + period) % period;
      return wrapped <= maximum ? wrapped : period - wrapped;
    };
    const headAt = (time: number): readonly [number, number] => {
      const travel = params.speed * Math.max(0, time);
      if (params.trajectory === "orbit") {
        const radius = minimumDimension * (0.12 + params.waviness * 0.2);
        const angle = direction + travel / Math.max(1, radius);
        const centerX = originX - Math.cos(direction) * radius;
        const centerY = originY - Math.sin(direction) * radius;
        return [centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius];
      }
      const alongX = Math.cos(direction) * travel;
      const alongY = Math.sin(direction) * travel;
      if (params.trajectory === "wave") {
        const wave = Math.sin(travel / Math.max(12, minimumDimension * 0.12))
          * params.waviness * minimumDimension * 0.18;
        return [reflect(originX + alongX - Math.sin(direction) * wave, context.width),
          reflect(originY + alongY + Math.cos(direction) * wave, context.height)];
      }
      return [reflect(originX + alongX, context.width), reflect(originY + alongY, context.height)];
    };
    const color = hsvColor(params.hue, params.saturation);
    for (let index = 0; index < count; index += 1) {
      const age = index / params.emissionRate;
      const sampleTime = Math.max(0, context.time - age);
      const head = headAt(sampleTime);
      const previous = headAt(Math.max(0, sampleTime - 1 / 120));
      const headX = head[0];
      const headY = head[1];
      const tangentX = (headX - previous[0]) * 120;
      const tangentY = (headY - previous[1]) * 120;
      const tangentLength = Math.max(0.000001, Math.hypot(tangentX, tangentY));
      const lateral = seededSigned(context.seed, index) * params.waviness * params.width * 1.4;
      const normalX = -tangentY / tangentLength;
      const normalY = tangentX / tangentLength;
      setParticle(buffer, index, {
        x: headX + normalX * lateral,
        y: headY + normalY * lateral,
        vx: tangentX,
        vy: tangentY,
        size: params.width,
        opacity: Math.exp(-params.fade * age) * (1 - age / params.lifetime),
        color
      });
    }
    return particleTextureResult(context, buffer);
  }
};
