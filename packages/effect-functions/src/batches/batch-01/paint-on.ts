import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, clamp, effectResult, enumField,
  numberField, parameterSchema, pathLength, readImageDimensions, readStrokePlan,
  resamplePath, round
} from "./common.js";

export interface PaintOnParams extends JsonObject {
  duration: number;
  coverage: number;
  strokeOrder: string;
  brushShape: string;
  brushSize: number;
  hardness: number;
  spacing: number;
  feather: number;
}

const defaults: PaintOnParams = {
  duration: 4, coverage: 1, strokeOrder: "forward", brushShape: "round", brushSize: 36,
  hardness: 0.7, spacing: 0.25, feather: 4
};

export const PAINT_ON_DEFINITION: EffectToolDefinition<PaintOnParams> = {
  effectId: "fx.draw.paintOn",
  toolName: "paint_on",
  displayName: "逐笔绘制显现",
  version: "1.1.0",
  category: "draw",
  parameterSchema: parameterSchema({
    duration: numberField(4, 0.5, 30),
    coverage: numberField(1, 0, 1),
    strokeOrder: enumField("forward", ["forward", "reverse", "alternating"]),
    brushShape: enumField("round", ["round", "flat"]),
    brushSize: numberField(36, 1, 400),
    hardness: numberField(0.7, 0, 1),
    spacing: numberField(0.25, 0.05, 1),
    feather: numberField(4, 0, 100)
  }),
  defaults,
  presets: [
    { presetId: "paint_on.logo", displayName: "标志描绘", params: { ...defaults, brushSize: 22, hardness: 0.9, feather: 1 } },
    { presetId: "paint_on.soft", displayName: "柔边绘入", params: { ...defaults, brushSize: 54, hardness: 0.45, feather: 10 } },
    { presetId: "paint_on.dry", displayName: "平头干刷", params: { ...defaults, strokeOrder: "alternating", brushShape: "flat", brushSize: 30, hardness: 0.78, spacing: 0.42 } }
  ],
  inputSlots: [
    { name: "source_image", kind: "image", required: true, cardinality: "one", description: "Server-authorized decoded source image." },
    { name: "stroke_plan", kind: "data", required: true, cardinality: "one", description: "Server-created paint stroke geometry and order." }
  ],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, duration: round(params.duration), coverage: round(params.coverage), brushSize: round(params.brushSize, 2) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const source = readImageDimensions(context, "source_image");
    const plan = readStrokePlan(context, "stroke_plan");
    let strokes = [...plan.strokes];
    if (params.strokeOrder === "reverse") strokes.reverse();
    if (params.strokeOrder === "alternating") {
      strokes = strokes.map((stroke, index) => index % 2 === 0 ? stroke : { ...stroke, points: [...stroke.points].reverse() });
    }
    const lengths = strokes.map((stroke) => pathLength(stroke.points, stroke.closed));
    const revealProgress = clamp(context.time / params.duration, 0, 1);
    const effectiveCoverage = params.coverage * revealProgress;
    const targetLength = lengths.reduce((sum, length) => sum + length, 0) * effectiveCoverage;
    let consumed = 0;
    const dabs: { x: number; y: number; angle: number; width: number; height: number }[] = [];
    for (let strokeIndex = 0; strokeIndex < strokes.length && consumed < targetLength; strokeIndex += 1) {
      const stroke = strokes[strokeIndex]!;
      const strokeLength = lengths[strokeIndex]!;
      const available = Math.min(strokeLength, targetLength - consumed);
      const samples = resamplePath(stroke, Math.max(0.5, params.brushSize * params.spacing));
      const keep = strokeLength <= Number.EPSILON ? 0 : Math.ceil(samples.length * available / strokeLength);
      for (let index = 0; index < keep; index += 1) {
        const point = samples[index]!;
        const next = samples[Math.min(samples.length - 1, index + 1)]!;
        dabs.push({
          x: point.x,
          y: point.y,
          angle: round(Math.atan2(next.y - point.y, next.x - point.x)),
          width: round(params.brushSize),
          height: round(params.brushSize * (params.brushShape === "flat" ? 0.36 : 1))
        });
      }
      consumed += available;
    }
    return effectResult("frame", {
      algorithm: "ordered_brush_reveal_mask",
      sourceWidth: source.width,
      sourceHeight: source.height,
      dabs,
      brushShape: params.brushShape,
      hardness: round(params.hardness),
      feather: round(params.feather),
      coverage: round(effectiveCoverage),
      revealProgress: round(revealProgress)
    });
  }
};
