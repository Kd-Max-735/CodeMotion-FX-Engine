import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, clamp, effectResult,
  integerField, numberField, parameterSchema, readRasterMask, round
} from "./common.js";

export interface VolumetricRayParams extends JsonObject {
  density: number;
  sampleCount: number;
  decay: number;
  exposure: number;
  weight: number;
  lightX: number;
  lightY: number;
}

const defaults: VolumetricRayParams = {
  density: 0.65, sampleCount: 48, decay: 0.96, exposure: 0.8, weight: 0.18, lightX: 0.5, lightY: 0.2
};

function maskSample(values: readonly number[], width: number, height: number, x: number, y: number): number {
  const px = clamp(x * (width - 1), 0, width - 1);
  const py = clamp(y * (height - 1), 0, height - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = px - x0;
  const ty = py - y0;
  const top = values[y0 * width + x0]! * (1 - tx) + values[y0 * width + x1]! * tx;
  const bottom = values[y1 * width + x0]! * (1 - tx) + values[y1 * width + x1]! * tx;
  return top * (1 - ty) + bottom * ty;
}

export const VOLUMETRIC_RAY_DEFINITION: EffectToolDefinition<VolumetricRayParams> = {
  effectId: "fx.light.volumetricRay",
  toolName: "volumetric_ray",
  displayName: "体积光束",
  version: "1.0.0",
  category: "light",
  parameterSchema: parameterSchema({
    density: numberField(0.65, 0, 1.5),
    sampleCount: integerField(48, 8, 128),
    decay: numberField(0.96, 0.8, 1),
    exposure: numberField(0.8, 0, 5),
    weight: numberField(0.18, 0, 1),
    lightX: numberField(0.5, -0.5, 1.5),
    lightY: numberField(0.2, -0.5, 1.5)
  }),
  defaults,
  presets: [
    { presetId: "volumetric_ray.soft", displayName: "柔和窗光", params: { ...defaults, density: 0.42, sampleCount: 32, decay: 0.94, exposure: 0.55, weight: 0.12 } },
    { presetId: "volumetric_ray.stage", displayName: "舞台光柱", params: { ...defaults, density: 0.78, sampleCount: 64, exposure: 1.15, weight: 0.22, lightY: 0.05 } },
    { presetId: "volumetric_ray.divine", displayName: "强烈天光", params: { ...defaults, density: 1.05, sampleCount: 96, decay: 0.98, exposure: 1.8, weight: 0.3, lightY: -0.1 } }
  ],
  inputSlots: [{ name: "occlusion_mask", kind: "mask", required: true, cardinality: "one", description: "Server-authorized linear occlusion mask; one means blocked." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params, sampleCount: Math.round(params.sampleCount), lightX: round(params.lightX), lightY: round(params.lightY) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const mask = readRasterMask(context, "occlusion_mask");
    const radiance: number[] = [];
    for (let y = 0; y < mask.height; y += 1) {
      for (let x = 0; x < mask.width; x += 1) {
        let u = (x + 0.5) / mask.width;
        let v = (y + 0.5) / mask.height;
        const stepX = (u - params.lightX) * params.density / params.sampleCount;
        const stepY = (v - params.lightY) * params.density / params.sampleCount;
        let illumination = 1;
        let accumulated = 0;
        for (let sample = 0; sample < params.sampleCount; sample += 1) {
          u -= stepX;
          v -= stepY;
          const transmission = 1 - maskSample(mask.values, mask.width, mask.height, u, v);
          accumulated += transmission * illumination * params.weight;
          illumination *= params.decay;
        }
        radiance.push(round(accumulated * params.exposure));
      }
    }
    return effectResult("frame", {
      algorithm: "radial_scattering_in_linear_light",
      width: mask.width,
      height: mask.height,
      colorSpace: "linear-srgb",
      hdr: radiance.some((value) => value > 1),
      radiance
    });
  }
};
