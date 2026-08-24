import { runBeatPulseSelfCheck } from "./beat-pulse-self-check.js";
import { runKineticTypographySelfCheck } from "./kinetic-typography-self-check.js";
import { runNumberCounterSelfCheck } from "./number-counter-self-check.js";
import { runOnsetTriggerSelfCheck } from "./onset-trigger-self-check.js";
import { runPathTrimSelfCheck } from "./path-trim-self-check.js";
import { runSpectrumBarsSelfCheck } from "./spectrum-bars-self-check.js";
import { runTextMorphSelfCheck } from "./text-morph-self-check.js";
import { runTypewriterSelfCheck } from "./typewriter-self-check.js";
import { runVocalReactiveTextSelfCheck } from "./vocal-reactive-text-self-check.js";
import { runWaveformSelfCheck } from "./waveform-self-check.js";
import {
  OBSERVED_SELF_CHECK_TOOL_NAMES,
  queuedObservedSelfCheck,
  type ObservedEffectSelfCheckView,
  type ObservedSelfCheckArtifacts,
  type ObservedSelfCheckToolName,
  type ObservedVideoSelfCheckRequest
} from "./observed-video-self-check.js";

export function isListedSelfCheckTool(value: string): value is ObservedSelfCheckToolName {
  return (OBSERVED_SELF_CHECK_TOOL_NAMES as readonly string[]).includes(value);
}

export function queuedListedToolSelfCheck(toolName: ObservedSelfCheckToolName): ObservedEffectSelfCheckView {
  return queuedObservedSelfCheck(toolName);
}

export async function runListedToolSelfCheck(
  toolName: ObservedSelfCheckToolName,
  request: ObservedVideoSelfCheckRequest
): Promise<ObservedSelfCheckArtifacts> {
  switch (toolName) {
    case "beat_pulse": return runBeatPulseSelfCheck(request);
    case "onset_trigger": return runOnsetTriggerSelfCheck(request);
    case "spectrum_bars": return runSpectrumBarsSelfCheck(request);
    case "vocal_reactive_text": return runVocalReactiveTextSelfCheck(request);
    case "waveform": return runWaveformSelfCheck(request);
    case "number_counter": return runNumberCounterSelfCheck(request);
    case "typewriter": return runTypewriterSelfCheck(request);
    case "text_morph": return runTextMorphSelfCheck(request);
    case "kinetic_typography": return runKineticTypographySelfCheck(request);
    case "path_trim": return runPathTrimSelfCheck(request);
  }
}
