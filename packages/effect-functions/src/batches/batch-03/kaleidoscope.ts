import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import { BATCH_03_CPU_FALLBACK, BATCH_03_GPU_BACKEND, CLOSED_SCHEMA, VALID_PARAMS, metadataResult, round } from "./shared.js";

export interface KaleidoscopeParams extends JsonObject {
  segments: number;
  rotation: number;
  centerX: number;
  centerY: number;
  zoom: number;
  mirror: boolean;
}

const defaults: KaleidoscopeParams = { segments: 8, rotation: 0, centerX: 0.5, centerY: 0.5, zoom: 1, mirror: true };

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
      mirror: { type: "boolean", default: true }
    }
  },
  defaults,
  presets: [
    { presetId: "kaleido.quad", displayName: "四向镜像", params: { ...defaults, segments: 4, zoom: 1.2 } },
    { presetId: "kaleido.classic", displayName: "经典八瓣", params: { ...defaults } },
    { presetId: "kaleido.crystal", displayName: "水晶繁花", params: { ...defaults, segments: 16, rotation: 22.5, zoom: 1.65 } }
  ],
  inputSlots: [{ name: "primary_image", kind: "image", required: true, cardinality: "one", description: "服务端授权并锁定的万花筒源图像。" }],
  primaryBackend: BATCH_03_GPU_BACKEND,
  fallbackStrategy: { kind: "server-backend", backend: BATCH_03_CPU_FALLBACK, fidelity: "equivalent", requiresFinalApproval: false },
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, segments: Math.round(params.segments) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const sectorAngle = 360 / params.segments;
    return metadataResult(context, {
      algorithm: "polar_sector_mirror_fold",
      center: [params.centerX, params.centerY],
      sectorAngleDegrees: round(sectorAngle),
      rotationDegrees: params.rotation,
      radialScale: round(1 / params.zoom),
      foldRule: params.mirror ? "alternate_reflection" : "repeat"
    });
  }
};
