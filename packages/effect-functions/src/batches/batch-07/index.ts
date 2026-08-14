import type { EffectToolDefinition } from "../../types.js";
import { fractalDefinition } from "./fractal.js";
import { lSystemDefinition } from "./l-system.js";
import { metaballsDefinition } from "./metaballs.js";
import { noiseFieldDefinition } from "./noise-field.js";
import { sacredGeometryDefinition } from "./sacred-geometry.js";
import { spectrumBarsDefinition } from "./spectrum-bars.js";
import { spiralTunnelDefinition } from "./spiral-tunnel.js";
import { voronoiDefinition } from "./voronoi.js";
import { waveSurfaceDefinition } from "./wave-surface.js";
import { waveformDefinition } from "./waveform.js";

export {
  fractalDefinition,
  lSystemDefinition,
  metaballsDefinition,
  noiseFieldDefinition,
  sacredGeometryDefinition,
  spectrumBarsDefinition,
  spiralTunnelDefinition,
  voronoiDefinition,
  waveSurfaceDefinition,
  waveformDefinition
};

export const BATCH_07_DEFINITIONS = Object.freeze([
  noiseFieldDefinition,
  fractalDefinition,
  lSystemDefinition,
  voronoiDefinition,
  metaballsDefinition,
  spiralTunnelDefinition,
  waveSurfaceDefinition,
  sacredGeometryDefinition,
  spectrumBarsDefinition,
  waveformDefinition
]) as readonly EffectToolDefinition<any, any, any>[];
