import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  REJECT_FALLBACK,
  SERVER_THREE_BACKEND,
  ease,
  readRgba8Frame,
  rgbaPixels,
  valid,
  type Easing
} from "./common.js";

export interface ObjectExplodeParams extends JsonObject {
  startTime: number;
  duration: number;
  fragmentCount: number;
  explosionRadius: number;
  spinTurns: number;
  gravity: number;
  originX: number;
  originY: number;
  originZ: number;
  easing: Easing;
}

const defaults: ObjectExplodeParams = {
  startTime: 0,
  duration: 1.5,
  fragmentCount: 48,
  explosionRadius: 3,
  spinTurns: 1.5,
  gravity: 2.5,
  originX: 0,
  originY: 0,
  originZ: 0,
  easing: "ease_out"
};

export const OBJECT_EXPLODE_DEFINITION: EffectToolDefinition<ObjectExplodeParams> = {
  effectId: "fx.3d.objectExplode",
  toolName: "object_explode",
  displayName: "三维物体爆裂",
  version: "1.0.0",
  category: "3d",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      startTime: { type: "number", minimum: 0, maximum: 3600, default: 0 },
      duration: { type: "number", exclusiveMinimum: 0, maximum: 30, default: 1.5 },
      fragmentCount: { type: "integer", minimum: 4, maximum: 256, default: 48 },
      explosionRadius: { type: "number", minimum: 0.1, maximum: 20, default: 3 },
      spinTurns: { type: "number", minimum: 0, maximum: 10, default: 1.5 },
      gravity: { type: "number", minimum: -20, maximum: 20, default: 2.5 },
      originX: { type: "number", minimum: -10, maximum: 10, default: 0 },
      originY: { type: "number", minimum: -10, maximum: 10, default: 0 },
      originZ: { type: "number", minimum: -10, maximum: 10, default: 0 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_out" }
    }
  },
  defaults,
  presets: [
    { presetId: "object_explode.subtle", displayName: "轻微散开", params: { ...defaults, fragmentCount: 24, explosionRadius: 1.2, spinTurns: 0.4 } },
    { presetId: "object_explode.cinematic", displayName: "电影爆裂", params: { ...defaults } },
    { presetId: "object_explode.zero_gravity", displayName: "失重碎裂", params: { ...defaults, duration: 2.5, fragmentCount: 96, explosionRadius: 5, gravity: 0, spinTurns: 3 } }
  ],
  inputSlots: [{
    name: "source_image",
    kind: "image",
    required: true,
    cardinality: "one",
    description: "Owner-authorized source image partitioned into textured 3D fragments.",
    acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/avif"]
  }],
  primaryBackend: SERVER_THREE_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const source = readRgba8Frame(context, "source_image");
    const output = new Uint8ClampedArray(context.width * context.height * 4);
    for (let offset = 0; offset < output.length; offset += 4) {
      output[offset] = 8; output[offset + 1] = 10; output[offset + 2] = 16; output[offset + 3] = 255;
    }
    const progress = Math.max(0, Math.min(1, (context.time - params.startTime) / params.duration));
    const eased = ease(progress, params.easing);
    const columns = Math.max(4, Math.ceil(Math.sqrt(params.fragmentCount)));
    const rows = columns;
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const left = Math.floor(column / columns * source.width);
      const top = Math.floor(row / rows * source.height);
      const right = Math.max(left + 1, Math.floor((column + 1) / columns * source.width));
      const bottom = Math.max(top + 1, Math.floor((row + 1) / rows * source.height));
      const nx = (column + 0.5) / columns - 0.5 - params.originX * 0.05;
      const ny = (row + 0.5) / rows - 0.5 - params.originY * 0.05;
      const dx = nx * params.explosionRadius * eased * context.width * 0.32;
      const dy = ny * params.explosionRadius * eased * context.height * 0.32
        + params.gravity * eased * eased * context.height * 0.04;
      const angle = params.spinTurns * Math.PI * 2 * eased * (nx - ny);
      const cosine = Math.cos(angle); const sine = Math.sin(angle);
      for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) {
        const localX = x - (left + right) / 2; const localY = y - (top + bottom) / 2;
        const tx = Math.round((left + right) / 2 + localX * cosine - localY * sine + dx);
        const ty = Math.round((top + bottom) / 2 + localX * sine + localY * cosine + dy);
        if (tx < 0 || ty < 0 || tx >= context.width || ty >= context.height) continue;
        const si = (y * source.width + x) * 4; const oi = (ty * context.width + tx) * 4;
        const shade = Math.max(0.45, Math.min(1.25, 1 + params.originZ * 0.025 + Math.sin(angle) * 0.18));
        output[oi] = Math.round(source.data[si]! * shade); output[oi + 1] = Math.round(source.data[si + 1]! * shade);
        output[oi + 2] = Math.round(source.data[si + 2]! * shade); output[oi + 3] = 255;
      }
    }
    return rgbaPixels(SERVER_THREE_BACKEND.backendId, context.width, context.height, output,
      "source_image", context.time);
  }
};
