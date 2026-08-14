import type { EffectToolDefinition } from "../../types.js";
import { DOLLY_DEFINITION } from "./dolly.js";
import { DOLLY_ZOOM_DEFINITION } from "./dolly-zoom.js";
import { HANDHELD_DEFINITION } from "./handheld.js";
import { OBJECT_MATCH_CUT_DEFINITION } from "./object-match-cut.js";
import { ORBIT_DEFINITION } from "./orbit.js";
import { PAGE_TURN_DEFINITION } from "./page-turn.js";
import { PAN_TILT_DEFINITION } from "./pan-tilt.js";
import { PARALLAX_LAYERS_DEFINITION } from "./parallax-layers.js";
import { PORTAL_DEFINITION } from "./portal.js";
import { ZOOM_TUNNEL_DEFINITION } from "./zoom-tunnel.js";

export * from "./dolly.js";
export * from "./dolly-zoom.js";
export * from "./handheld.js";
export * from "./object-match-cut.js";
export * from "./orbit.js";
export * from "./page-turn.js";
export * from "./pan-tilt.js";
export * from "./parallax-layers.js";
export * from "./portal.js";
export * from "./zoom-tunnel.js";

export const BATCH_05_DEFINITIONS: readonly EffectToolDefinition[] = Object.freeze([
  PAGE_TURN_DEFINITION,
  PORTAL_DEFINITION,
  ZOOM_TUNNEL_DEFINITION,
  OBJECT_MATCH_CUT_DEFINITION,
  PAN_TILT_DEFINITION,
  DOLLY_DEFINITION,
  DOLLY_ZOOM_DEFINITION,
  ORBIT_DEFINITION,
  HANDHELD_DEFINITION,
  PARALLAX_LAYERS_DEFINITION
]);
