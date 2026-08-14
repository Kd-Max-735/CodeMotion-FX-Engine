import { readFile } from "node:fs/promises";

export interface EffectFieldSpecDescriptor {
  readonly toolName: string;
  readonly relativePath: string;
}

type FilenameForTool = (toolName: string) => string;

const entries: EffectFieldSpecDescriptor[] = [];

function add(directory: string, toolNames: readonly string[], filenameFor: FilenameForTool): void {
  for (const toolName of toolNames) {
    entries.push(Object.freeze({
      toolName,
      relativePath: `${directory}/${filenameFor(toolName)}`
    }));
  }
}

const markdown = (toolName: string): string => `${toolName}.md`;
const hyphenMarkdown = (toolName: string): string => `${toolName.replaceAll("_", "-")}.md`;

add("batch-01", [
  "wave_path", "dash_flow", "blob_morph", "shape_boolean_animate", "marker_stroke",
  "neon_trace", "lightning_trace", "paint_on", "volumetric_ray", "electric_arc"
], (toolName) => `${toolName.replaceAll("_", "-")}-tool-field-spec.zh-CN.md`);

add("batch-02", [
  "gradient_flow", "aura_field", "depth_of_field", "chromatic_aberration", "film_grain",
  "color_grade", "glitch_slice", "rgb_split", "pixel_sort", "datamosh"
], markdown);

add("batch-03", [
  "wave_warp", "turbulent_displace", "liquid_displace", "kaleidoscope", "particle_emitter",
  "particle_logo_assemble", "particle_dissolve", "particle_trail", "particle_spark",
  "particle_snow_rain"
], markdown);

add("batch-04", [
  "particle_orbit_field", "particle_flow_field", "sim_spring", "sim_rigid_body_2d",
  "sim_soft_body", "sim_cloth", "sim_rope", "sim_fluid_lite", "sim_boids",
  "sim_collision_shatter"
], markdown);

add("batch-05", [
  "page_turn", "portal", "zoom_tunnel", "object_match_cut", "pan_tilt", "dolly",
  "dolly_zoom", "orbit", "handheld", "parallax_layers"
], markdown);

add("batch-06", [
  "object_explode", "text_logo_reveal", "ken_burns", "smart_crop_animate",
  "image_depth_parallax", "photo_stack", "video_freeze_frame", "speed_ramp", "echo_trail",
  "background_remove_compose"
], hyphenMarkdown);

add("batch-07", [
  "noise_field", "fractal", "l_system", "voronoi", "metaballs", "spiral_tunnel",
  "wave_surface", "sacred_geometry", "spectrum_bars", "waveform"
], hyphenMarkdown);

const BATCH_08_FILENAMES: Readonly<Record<string, string>> = Object.freeze({
  beat_pulse: "audio_beat_pulse.md",
  onset_trigger: "audio_onset_trigger.md",
  vocal_reactive_text: "audio_vocal_reactive_text.md",
  number_counter: "data_number_counter.md",
  chart_reveal: "data_chart_reveal.md",
  live_binding: "data_live_binding.md",
  texture_overlay: "composite_texture_overlay.md",
  glass: "material_glass.md",
  metal: "material_metal.md",
  hologram: "material_hologram.md"
});
add("batch-08", Object.keys(BATCH_08_FILENAMES), (toolName) => BATCH_08_FILENAMES[toolName]!);

add("existing-01", [
  "fade", "slide", "scale_pop", "rotate_in", "bounce", "elastic", "float", "shake",
  "typewriter", "character_cascade", "kinetic_typography", "text_path_reveal", "text_morph",
  "scramble_decode", "word_explode", "text_extrude_3d", "path_trim", "path_morph",
  "shape_repeater", "radial_burst"
], markdown);

add("existing-02", [
  "handwriting", "brush_reveal", "ink_spread", "chalk_stroke", "neon_glow", "scan_beam",
  "lens_flare", "energy_pulse", "gaussian_blur", "directional_blur", "radial_blur",
  "motion_blur", "wipe", "radial_wipe", "liquid_wipe", "pixel_dissolve", "mask_reveal",
  "track_matte", "blend", "displacement_map"
], markdown);

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
