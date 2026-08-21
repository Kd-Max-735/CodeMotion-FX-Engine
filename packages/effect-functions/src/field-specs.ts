import { readFile } from "node:fs/promises";

export interface EffectFieldSpecDescriptor {
  readonly toolName: string;
  readonly relativePath: string;
}

const entries: EffectFieldSpecDescriptor[] = [];

function add(toolNames: readonly string[]): void {
  for (const toolName of toolNames) {
    entries.push(Object.freeze({
      toolName,
      relativePath: `tools/${toolName}.md`
    }));
  }
}

add([
  "wave_path", "dash_flow", "blob_morph", "shape_boolean_animate", "marker_stroke",
  "neon_trace", "lightning_trace", "paint_on", "volumetric_ray", "electric_arc"
]);

add([
  "gradient_flow", "aura_field", "depth_of_field", "chromatic_aberration", "film_grain",
  "color_grade", "glitch_slice", "rgb_split", "pixel_sort", "datamosh"
]);

add([
  "wave_warp", "turbulent_displace", "liquid_displace", "kaleidoscope", "particle_emitter",
  "particle_logo_assemble", "particle_dissolve", "particle_trail", "particle_spark",
  "particle_snow_rain"
]);

add([
  "particle_orbit_field", "particle_flow_field", "sim_spring", "sim_rigid_body_2d",
  "sim_soft_body", "sim_cloth", "sim_rope", "sim_fluid_lite", "sim_boids",
  "sim_collision_shatter"
]);

add([
  "page_turn", "portal", "zoom_tunnel", "object_match_cut", "pan_tilt", "dolly",
  "dolly_zoom", "orbit", "handheld", "parallax_layers"
]);

add([
  "object_explode", "text_logo_reveal", "ken_burns", "smart_crop_animate",
  "image_depth_parallax", "photo_stack", "video_freeze_frame", "speed_ramp", "echo_trail",
  "background_remove_compose"
]);

add([
  "noise_field", "fractal", "l_system", "voronoi", "metaballs", "spiral_tunnel",
  "wave_surface", "sacred_geometry", "spectrum_bars", "waveform"
]);

add([
  "beat_pulse", "onset_trigger", "vocal_reactive_text", "number_counter", "chart_reveal",
  "live_binding", "texture_overlay", "glass", "metal", "hologram"
]);

add([
  "fade", "slide", "scale_pop", "rotate_in", "bounce", "elastic", "float", "shake",
  "typewriter", "character_cascade", "kinetic_typography", "text_path_reveal", "text_morph",
  "scramble_decode", "word_explode", "text_extrude_3d", "path_trim", "path_morph",
  "shape_repeater", "radial_burst"
]);

add([
  "handwriting", "brush_reveal", "ink_spread", "chalk_stroke", "neon_glow", "scan_beam",
  "lens_flare", "energy_pulse", "gaussian_blur", "directional_blur", "radial_blur",
  "motion_blur", "wipe", "radial_wipe", "liquid_wipe", "pixel_dissolve", "mask_reveal",
  "track_matte", "blend", "displacement_map"
]);

const byToolName = new Map(entries.map((entry) => [entry.toolName, entry]));
if (entries.length !== 120 || byToolName.size !== entries.length) {
  throw new TypeError("Effect field-spec mapping must contain exactly 120 unique tool names.");
}

export const EFFECT_FIELD_SPECS: readonly EffectFieldSpecDescriptor[] = Object.freeze([...entries]);

export function getEffectFieldSpec(toolName: string): EffectFieldSpecDescriptor | undefined {
  return byToolName.get(toolName);
}

export async function loadEffectFieldSpec(toolName: string): Promise<string> {
  const descriptor = getEffectFieldSpec(toolName);
  if (descriptor === undefined) throw new RangeError("Unknown effect tool name.");
  return readFile(new URL(`../field-specs/${descriptor.relativePath}`, import.meta.url), "utf8");
}
