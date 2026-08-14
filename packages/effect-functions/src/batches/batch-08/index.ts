import type { EffectToolDefinition } from "../../types.js";
import { BEAT_PULSE_DEFINITION } from "./beat-pulse.js";
import { CHART_REVEAL_DEFINITION } from "./chart-reveal.js";
import { GLASS_DEFINITION } from "./glass.js";
import { HOLOGRAM_DEFINITION } from "./hologram.js";
import { LIVE_BINDING_DEFINITION } from "./live-binding.js";
import { METAL_DEFINITION } from "./metal.js";
import { NUMBER_COUNTER_DEFINITION } from "./number-counter.js";
import { ONSET_TRIGGER_DEFINITION } from "./onset-trigger.js";
import { TEXTURE_OVERLAY_DEFINITION } from "./texture-overlay.js";
import { VOCAL_REACTIVE_TEXT_DEFINITION } from "./vocal-reactive-text.js";

export {
  BEAT_PULSE_DEFINITION,
  CHART_REVEAL_DEFINITION,
  GLASS_DEFINITION,
  HOLOGRAM_DEFINITION,
  LIVE_BINDING_DEFINITION,
  METAL_DEFINITION,
  NUMBER_COUNTER_DEFINITION,
  ONSET_TRIGGER_DEFINITION,
  TEXTURE_OVERLAY_DEFINITION,
  VOCAL_REACTIVE_TEXT_DEFINITION
};

export const BATCH_08_DEFINITIONS: readonly EffectToolDefinition[] = Object.freeze([
  BEAT_PULSE_DEFINITION,
  ONSET_TRIGGER_DEFINITION,
  VOCAL_REACTIVE_TEXT_DEFINITION,
  NUMBER_COUNTER_DEFINITION,
  CHART_REVEAL_DEFINITION,
  LIVE_BINDING_DEFINITION,
  TEXTURE_OVERLAY_DEFINITION,
  GLASS_DEFINITION,
  METAL_DEFINITION,
  HOLOGRAM_DEFINITION
]);
