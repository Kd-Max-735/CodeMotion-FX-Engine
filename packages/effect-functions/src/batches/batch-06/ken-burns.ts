import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  REJECT_FALLBACK,
  RGBA8_FRAME_VERSION,
  SERVER_CPU_BACKEND,
  readRgba8Frame,
  rgbaFrameResult,
  round,
  timedProgress,
  valid,
  type Easing,
  type Rgba8FrameBinding
} from "./common.js";

export interface KenBurnsParams extends JsonObject {
  startTime: number;
  duration: number;
  startScale: number;
  endScale: number;
  startCenterX: number;
  startCenterY: number;
  endCenterX: number;
  endCenterY: number;
  easing: Easing;
}

const defaults: KenBurnsParams = {
  startTime: 0,
  duration: 5,
  startScale: 1,
  endScale: 1.18,
  startCenterX: 0.5,
  startCenterY: 0.5,
  endCenterX: 0.55,
  endCenterY: 0.45,
  easing: "ease_in_out"
};

function sourcePixel(frame: Rgba8FrameBinding, x: number, y: number): readonly number[] {
  const safeX = Math.max(0, Math.min(frame.width - 1, x));
  const safeY = Math.max(0, Math.min(frame.height - 1, y));
  const x0 = Math.floor(safeX);
  const y0 = Math.floor(safeY);
  const x1 = Math.min(frame.width - 1, x0 + 1);
  const y1 = Math.min(frame.height - 1, y0 + 1);
  const tx = safeX - x0;
  const ty = safeY - y0;
  const offset = (pixelX: number, pixelY: number) => (pixelY * frame.width + pixelX) * 4;
  return Array.from({ length: 4 }, (_, channel) => {
    const topLeft = frame.data[offset(x0, y0) + channel]!;
    const topRight = frame.data[offset(x1, y0) + channel]!;
    const bottomLeft = frame.data[offset(x0, y1) + channel]!;
    const bottomRight = frame.data[offset(x1, y1) + channel]!;
    const top = topLeft + (topRight - topLeft) * tx;
    const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
    return top + (bottom - top) * ty;
  });
}

export const KEN_BURNS_DEFINITION: EffectToolDefinition<KenBurnsParams> = {
  effectId: "fx.media.kenBurns",
  toolName: "ken_burns",
  displayName: "肯·伯恩斯平移缩放",
  version: "1.0.0",
  category: "media",
  parameterSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    properties: {
      startTime: { type: "number", minimum: 0, maximum: 3600, default: 0 },
      duration: { type: "number", exclusiveMinimum: 0, maximum: 120, default: 5 },
      startScale: { type: "number", minimum: 1, maximum: 4, default: 1 },
      endScale: { type: "number", minimum: 1, maximum: 4, default: 1.18 },
      startCenterX: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      startCenterY: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
      endCenterX: { type: "number", minimum: 0, maximum: 1, default: 0.55 },
      endCenterY: { type: "number", minimum: 0, maximum: 1, default: 0.45 },
      easing: { type: "string", enum: ["linear", "ease_in", "ease_out", "ease_in_out"], default: "ease_in_out" }
    }
  },
  defaults,
  presets: [
    { presetId: "ken_burns.gentle_in", displayName: "轻柔推近", params: { ...defaults } },
    { presetId: "ken_burns.pull_out", displayName: "缓慢拉远", params: { ...defaults, startScale: 1.3, endScale: 1, startCenterX: 0.45, endCenterX: 0.5 } },
    { presetId: "ken_burns.pan", displayName: "横向巡览", params: { ...defaults, duration: 7, startScale: 1.25, endScale: 1.25, startCenterX: 0.3, endCenterX: 0.7 } }
  ],
  inputSlots: [{ name: "source_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized still image." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: REJECT_FALLBACK,
  performanceGrade: "heavy",
  normalizeParams: (params) => ({ ...params }),
  validateParams: () => valid(),
  render: (context, params) => {
    const source = readRgba8Frame(context, "source_image");
    const progress = timedProgress(context.time, params.startTime, params.duration, params.easing);
    const mix = (start: number, end: number) => round(start + (end - start) * progress);
    const scale = mix(params.startScale, params.endScale);
    const centerX = mix(params.startCenterX, params.endCenterX);
    const centerY = mix(params.startCenterY, params.endCenterY);
    const coverScale = Math.max(context.width / source.width, context.height / source.height);
    const pixels = new Uint8ClampedArray(context.width * context.height * 4);
    for (let y = 0; y < context.height; y += 1) {
      for (let x = 0; x < context.width; x += 1) {
        const sourceX = centerX * (source.width - 1)
          + (x + 0.5 - context.width / 2) / (coverScale * scale);
        const sourceY = centerY * (source.height - 1)
          + (y + 0.5 - context.height / 2) / (coverScale * scale);
        const sample = sourcePixel(source, sourceX, sourceY);
        const targetOffset = (y * context.width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          pixels[targetOffset + channel] = Math.round(sample[channel]!);
        }
      }
    }
    return rgbaFrameResult(SERVER_CPU_BACKEND.backendId, {
      version: RGBA8_FRAME_VERSION,
      width: context.width,
      height: context.height,
      data: pixels,
      sourceSlot: "source_image",
      sampleTime: round(Math.max(0, context.time))
    });
  }
};
