import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  BATCH_03_BACKEND,
  BATCH_03_REJECT_FALLBACK,
  CLOSED_SCHEMA,
  VALID_PARAMS,
  frameResult,
  rgbaInput,
  sampleBilinear,
  writePixel
} from "./shared.js";

export interface KaleidoscopeParams extends JsonObject {
  segments: number;
  rotation: number;
  centerX: number;
  centerY: number;
  zoom: number;
  mirror: boolean;
  rotationSpeed: number;
}

const defaults: KaleidoscopeParams = { segments: 8, rotation: 0, centerX: 0.5, centerY: 0.5, zoom: 1, mirror: true, rotationSpeed: 15 };

export const KALEIDOSCOPE_DEFINITION: EffectToolDefinition<KaleidoscopeParams> = {
  effectId: "fx.distort.kaleidoscope",
  toolName: "kaleidoscope",
  displayName: "万花筒",
  version: "1.0.0",
  category: "distort",
  parameterSchema: {
    ...CLOSED_SCHEMA,
    properties: {
      segments: { type: "integer", minimum: 2, maximum: 32, default: 8 },
      rotation: { type: "number", minimum: -360, maximum: 360, default: 0 },
      centerX: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      centerY: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      zoom: { type: "number", minimum: 0.25, maximum: 4, default: 1 },
      mirror: { type: "boolean", default: true },
      rotationSpeed: { type: "number", minimum: -360, maximum: 360, default: 15 }
    }
  },
  defaults,
  presets: [
    { presetId: "kaleido.quad", displayName: "四向镜像", params: { ...defaults, segments: 4, zoom: 1.2 } },
    { presetId: "kaleido.classic", displayName: "经典八瓣", params: { ...defaults } },
    { presetId: "kaleido.crystal", displayName: "水晶繁花", params: { ...defaults, segments: 16, rotation: 22.5, zoom: 1.65, rotationSpeed: 28 } }
  ],
  inputSlots: [{ name: "primary_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的万花筒源图像。" }],
  primaryBackend: BATCH_03_BACKEND,
  fallbackStrategy: BATCH_03_REJECT_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, segments: Math.round(params.segments) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const source = rgbaInput(context, "primary_image", true)!;
    const output = new Uint8ClampedArray(context.width * context.height * 4);
    const centerX = params.centerX * (context.width - 1);
    const centerY = params.centerY * (context.height - 1);
    const sectorAngle = Math.PI * 2 / params.segments;
    const rotation = (params.rotation + context.time * params.rotationSpeed) * Math.PI / 180;
    for (let y = 0; y < context.height; y += 1) {
      for (let x = 0; x < context.width; x += 1) {
        const relativeX = x - centerX;
        const relativeY = y - centerY;
        const radius = Math.hypot(relativeX, relativeY) / params.zoom;
        let angle = Math.atan2(relativeY, relativeX) - rotation;
        angle = ((angle % sectorAngle) + sectorAngle) % sectorAngle;
        if (params.mirror && angle > sectorAngle / 2) angle = sectorAngle - angle;
        const sourceX = centerX + Math.cos(angle + rotation) * radius;
        const sourceY = centerY + Math.sin(angle + rotation) * radius;
        writePixel(output, (y * context.width + x) * 4,
          sampleBilinear(source, sourceX, sourceY, "mirror"));
      }
    }
    return frameResult(context, output);
  }
};
