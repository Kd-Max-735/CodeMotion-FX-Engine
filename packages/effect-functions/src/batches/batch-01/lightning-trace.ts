import type { JsonObject } from "@codemotion/core";
import type { EffectToolDefinition } from "../../types.js";
import {
  SERVER_CPU_BACKEND, SERVER_CPU_FALLBACK, VALID_PARAMS, animatedSeed, clamp, effectResult,
  enumField, integerField, numberField, parameterSchema, randomAt, resamplePath,
  round, roundPoint, slicePath, visualAnchors, type Point, type VisualAnchorName
} from "./common.js";

export interface LightningTraceParams extends JsonObject {
  progress: number;
  branchCount: number;
  jitter: number;
  flicker: number;
  branchLength: number;
  segmentLength: number;
  glow: number;
  startMode: VisualAnchorName;
  endMode: VisualAnchorName;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const defaults: LightningTraceParams = {
  progress: 1, branchCount: 3, jitter: 12, flicker: 0.35, branchLength: 0.18, segmentLength: 14, glow: 6,
  startMode: "subject_left", endMode: "subject_right", startX: 0.2, startY: 0.5, endX: 0.8, endY: 0.5
};

const ANCHOR_MODES: readonly VisualAnchorName[] = ["coordinates", "subject_left", "subject_right",
  "subject_top", "subject_bottom", "subject_center", "brightest"];

export const LIGHTNING_TRACE_DEFINITION: EffectToolDefinition<LightningTraceParams> = {
  effectId: "fx.draw.lightningTrace",
  toolName: "lightning_trace",
  displayName: "闪电沿路径传播",
  version: "1.1.0",
  category: "draw",
  parameterSchema: parameterSchema({
    progress: numberField(1, 0, 1),
    branchCount: integerField(3, 0, 32),
    jitter: numberField(12, 0, 200),
    flicker: numberField(0.35, 0, 1),
    branchLength: numberField(0.18, 0.02, 0.8),
    segmentLength: numberField(14, 2, 100),
    glow: numberField(6, 0, 100)
    , startMode: enumField("subject_left", ANCHOR_MODES)
    , endMode: enumField("subject_right", ANCHOR_MODES)
    , startX: numberField(0.2, 0, 1), startY: numberField(0.5, 0, 1)
    , endX: numberField(0.8, 0, 1), endY: numberField(0.5, 0, 1)
  }),
  defaults,
  presets: [
    { presetId: "lightning_trace.thin", displayName: "细电脉冲", params: { ...defaults, branchCount: 2, jitter: 8, flicker: 0.18, glow: 5 } },
    { presetId: "lightning_trace.storm", displayName: "风暴闪电", params: { ...defaults, branchCount: 10, jitter: 32, flicker: 0.65, branchLength: 0.35, glow: 18 } },
    { presetId: "lightning_trace.travel", displayName: "传播电光", params: { ...defaults, progress: 0.58, branchCount: 4, jitter: 14 } }
  ],
  inputSlots: [{ name: "source_image", kind: "image", required: true, cardinality: "one", description: "Owner-authorized image under the generated lightning path." }],
  primaryBackend: SERVER_CPU_BACKEND,
  fallbackStrategy: SERVER_CPU_FALLBACK,
  performanceGrade: "medium",
  normalizeParams: (params) => ({ ...params, progress: round(params.progress), branchCount: Math.round(params.branchCount) }),
  validateParams: () => VALID_PARAMS,
  render: (context, params) => {
    const anchors = visualAnchors(context, "source_image");
    const resolve = (mode: VisualAnchorName, x: number, y: number): Point => {
      const normalized = mode === "coordinates" ? { x, y } : anchors[mode];
      return { x: normalized.x * Math.max(1, context.width - 1), y: normalized.y * Math.max(1, context.height - 1) };
    };
    const start = resolve(params.startMode, params.startX, params.startY);
    const end = resolve(params.endMode, params.endX, params.endY);
    const guide = { points: [start, end], closed: false };
    const revealProgress = clamp(context.time / 1.25, 0, 1);
    const activeProgress = params.progress * revealProgress;
    if (activeProgress <= Number.EPSILON) {
      return effectResult("metadata", {
        algorithm: "seeded_guided_lightning",
        main: [],
        branches: [],
        glowRadius: round(params.glow),
        revealProgress: 0
      });
    }
    const active = { points: slicePath(guide, 0, activeProgress, params.segmentLength), closed: false };
    const samples = resamplePath(active, params.segmentLength);
    const seed = animatedSeed(context, 4 + params.flicker * 20, 71);
    const main = samples.map((point, index) => {
      if (index === 0 || index === samples.length - 1) return point;
      const previous = samples[index - 1]!;
      const next = samples[index + 1]!;
      const dx = next.x - previous.x;
      const dy = next.y - previous.y;
      const length = Math.hypot(dx, dy) || 1;
      const envelope = Math.sin(index / (samples.length - 1) * Math.PI);
      const offset = (randomAt(seed, index) * 2 - 1) * params.jitter * envelope;
      return roundPoint({ x: point.x - dy / length * offset, y: point.y + dx / length * offset });
    });
    const branches = Array.from({ length: params.branchCount }, (_, branchIndex) => {
      const attachIndex = Math.min(main.length - 1, Math.floor(randomAt(seed ^ 0xa51c, branchIndex) * main.length));
      const origin = main[attachIndex]!;
      const baseAngle = randomAt(seed ^ 0x71e2, branchIndex) * Math.PI * 2;
      const length = params.branchLength * Math.hypot(context.width, context.height) * (0.45 + randomAt(seed, branchIndex + 500) * 0.55);
      const steps = Math.max(2, Math.ceil(length / params.segmentLength));
      const points = Array.from({ length: steps }, (_, index) => {
        const t = index / (steps - 1);
        const lateral = (randomAt(seed ^ branchIndex, index + 900) - 0.5) * params.jitter * t;
        return roundPoint({
          x: origin.x + Math.cos(baseAngle) * length * t - Math.sin(baseAngle) * lateral,
          y: origin.y + Math.sin(baseAngle) * length * t + Math.cos(baseAngle) * lateral
        });
      });
      return { points, intensity: round(1 - branchIndex / Math.max(1, params.branchCount) * 0.65) };
    });
    return effectResult("metadata", {
      algorithm: "seeded_guided_lightning",
      main,
      branches,
      glowRadius: round(params.glow),
      revealProgress: round(revealProgress)
    });
  }
};
