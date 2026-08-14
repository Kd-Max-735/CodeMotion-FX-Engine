import type { EffectToolDefinition } from "../../types.js";
import { BLOB_MORPH_DEFINITION } from "./blob-morph.js";
import { DASH_FLOW_DEFINITION } from "./dash-flow.js";
import { ELECTRIC_ARC_DEFINITION } from "./electric-arc.js";
import { LIGHTNING_TRACE_DEFINITION } from "./lightning-trace.js";
import { MARKER_STROKE_DEFINITION } from "./marker-stroke.js";
import { NEON_TRACE_DEFINITION } from "./neon-trace.js";
import { PAINT_ON_DEFINITION } from "./paint-on.js";
import { SHAPE_BOOLEAN_ANIMATE_DEFINITION } from "./shape-boolean-animate.js";
import { VOLUMETRIC_RAY_DEFINITION } from "./volumetric-ray.js";
import { WAVE_PATH_DEFINITION } from "./wave-path.js";

export { BLOB_MORPH_DEFINITION } from "./blob-morph.js";
export { DASH_FLOW_DEFINITION } from "./dash-flow.js";
export { ELECTRIC_ARC_DEFINITION } from "./electric-arc.js";
export { LIGHTNING_TRACE_DEFINITION } from "./lightning-trace.js";
export { MARKER_STROKE_DEFINITION } from "./marker-stroke.js";
export { NEON_TRACE_DEFINITION } from "./neon-trace.js";
export { PAINT_ON_DEFINITION } from "./paint-on.js";
export { SHAPE_BOOLEAN_ANIMATE_DEFINITION } from "./shape-boolean-animate.js";
export { VOLUMETRIC_RAY_DEFINITION } from "./volumetric-ray.js";
export { WAVE_PATH_DEFINITION } from "./wave-path.js";

export const BATCH_01_DEFINITIONS: readonly EffectToolDefinition[] = Object.freeze([
  WAVE_PATH_DEFINITION,
  DASH_FLOW_DEFINITION,
  BLOB_MORPH_DEFINITION,
  SHAPE_BOOLEAN_ANIMATE_DEFINITION,
  MARKER_STROKE_DEFINITION,
  NEON_TRACE_DEFINITION,
  LIGHTNING_TRACE_DEFINITION,
  PAINT_ON_DEFINITION,
  VOLUMETRIC_RAY_DEFINITION,
  ELECTRIC_ARC_DEFINITION
]);
