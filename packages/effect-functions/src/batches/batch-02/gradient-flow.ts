import type { JsonObject } from "@codemotion/core";
import {
  CPU_BACKEND, REJECT_FALLBACK, SOURCE_FRAME_SLOT, VALID_PARAMS, byte, frameInput,
  frameResult, hsvToRgb, pixelAt, round, type Batch02Definition
} from "./common.js";

export interface GradientFlowParams extends JsonObject {
  intensity: number;
  scale: number;
  speed: number;
  angle: number;
  phase: number;
  palette: "aurora" | "sunset" | "ocean" | "prism";
}

const defaults: GradientFlowParams = {
  intensity: 0.45, scale: 1.5, speed: 0.35, angle: 25, phase: 0, palette: "aurora"
};

const paletteHues = {
  aurora: [145, 205, 285], sunset: [350, 25, 55], ocean: [185, 215, 250], prism: [0, 120, 240]
} as const;

export const GRADIENT_FLOW_DEFINITION: Batch02Definition<GradientFlowParams> = {
  effectId: "fx.light.gradientFlow",
  toolName: "gradient_flow",
  displayName: "流动渐变光",
  version: "1.0.0",
  category: "light",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object", additionalProperties: false, required: ["intensity"],
    properties: {
      intensity: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0.45 },
      scale: { type: "number", minimum: 0.25, maximum: 6, multipleOf: 0.01, default: 1.5 },
      speed: { type: "number", minimum: -3, maximum: 3, multipleOf: 0.01, default: 0.35 },
      angle: { type: "integer", minimum: -180, maximum: 180, default: 25 },
      phase: { type: "number", minimum: 0, maximum: 1, multipleOf: 0.01, default: 0 },
      palette: { type: "string", enum: ["aurora", "sunset", "ocean", "prism"], default: "aurora" }
    }
  },
  defaults,
  presets: [
    { presetId: "gradient-flow.subtle", displayName: "轻柔极光", params: { ...defaults, intensity: 0.25, scale: 2.4, speed: 0.2 } },
    { presetId: "gradient-flow.sunset", displayName: "落日流光", params: { ...defaults, intensity: 0.62, palette: "sunset", angle: -35, speed: 0.55 } },
    { presetId: "gradient-flow.prism", displayName: "棱镜奔流", params: { ...defaults, intensity: 0.8, palette: "prism", scale: 0.7, speed: 1.2 } }
  ],
  inputSlots: [SOURCE_FRAME_SLOT], primaryBackend: CPU_BACKEND, fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, intensity: round(params.intensity), scale: round(params.scale), speed: round(params.speed), angle: Math.round(params.angle), phase: round(params.phase) }),
  validateParams: () => VALID_PARAMS,
  render(context, params) {
    const frame = frameInput(context);
    const output: number[] = [];
    const radians = params.angle * Math.PI / 180;
    const hues = paletteHues[params.palette];
    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        const nx = frame.width === 1 ? 0 : x / (frame.width - 1) - 0.5;
        const ny = frame.height === 1 ? 0 : y / (frame.height - 1) - 0.5;
        const coordinate = (nx * Math.cos(radians) + ny * Math.sin(radians)) / params.scale;
        const travel = coordinate + context.time * params.speed + params.phase;
        const wave = (Math.sin(travel * Math.PI * 2) + 1) * 0.5;
        const hueIndex = Math.min(1.999, wave * 2);
        const first = Math.floor(hueIndex);
        const blend = hueIndex - first;
        const hue = hues[first]! + (hues[first + 1]! - hues[first]!) * blend;
        const glow = 0.72 + 0.28 * Math.sin((travel * 1.7 + ny * 0.8) * Math.PI * 2);
        const color = hsvToRgb(hue, 0.68, glow);
        const base = pixelAt(frame, x, y);
        output.push(byte(base[0]! * (1 - params.intensity) + color[0]! * params.intensity), byte(base[1]! * (1 - params.intensity) + color[1]! * params.intensity), byte(base[2]! * (1 - params.intensity) + color[2]! * params.intensity), base[3]!);
      }
    }
    return frameResult(GRADIENT_FLOW_DEFINITION, frame, output);
  }
};
