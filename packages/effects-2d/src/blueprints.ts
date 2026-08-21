import type {
  BooleanParameterSpec,
  EffectBlueprint,
  EnumParameterSpec,
  NumberParameterSpec,
  TextParameterSpec,
  VectorParameterSpec
} from "./types.js";

const shared = {
  keyframeable: true,
  expression: true,
  randomizable: true,
  performanceImpact: "low" as const,
  conflicts: Object.freeze([]) as readonly string[],
  nullBehavior: "use-default" as const
};

const number = (
  name: string,
  value: number,
  min: number,
  max: number,
  step: number,
  unit = "ratio",
  impact: NumberParameterSpec["performanceImpact"] = "low"
): NumberParameterSpec => ({
  ...shared,
  kind: "number",
  name,
  label: name,
  default: value,
  min,
  max,
  step,
  unit,
  performanceImpact: impact
});

const choice = (
  name: string,
  value: string,
  options: readonly string[]
): EnumParameterSpec => ({
  ...shared,
  kind: "enum",
  name,
  label: name,
  default: value,
  options,
  unit: "enum",
  randomizable: false,
  performanceImpact: "none"
});

const text = (
  name: string,
  value: string,
  maxLength = 4096
): TextParameterSpec => ({
  ...shared,
  kind: "text",
  name,
  label: name,
  default: value,
  minLength: 0,
  maxLength,
  unit: "text",
  randomizable: false,
  performanceImpact: "medium"
});

const boolean = (name: string, value: boolean): BooleanParameterSpec => ({
  ...shared,
  kind: "boolean",
  name,
  label: name,
  default: value,
  unit: "boolean",
  randomizable: false,
  performanceImpact: "none"
});

const vector = (
  name: string,
  value: readonly [number, number],
  min = 0,
  max = 1,
  step = 0.01
): VectorParameterSpec => ({
  ...shared,
  kind: "vector2",
  name,
  label: name,
  default: value,
  min,
  max,
  step,
  unit: "normalized",
  performanceImpact: "none"
});

const b = (
  sourceId: EffectBlueprint["sourceId"],
  effectId: string,
  displayName: string,
  category: EffectBlueprint["category"],
  description: string,
  parameters: EffectBlueprint["parameters"],
  performanceClass: EffectBlueprint["performanceClass"],
  benchmarkBudgetMs: number
): EffectBlueprint => ({
  sourceId,
  effectId,
  displayName,
  category,
  description,
  parameters,
  performanceClass,
  benchmarkBudgetMs
});

export const GROUP_2_BLUEPRINTS: readonly EffectBlueprint[] = Object.freeze([
  b("M01", "fx.motion.fade", "Fade", "motion", "Deterministic opacity fade.", [
    number("from", 0, 0, 1, 0.01), number("to", 1, 0, 1, 0.01),
    number("duration", 1.2, 0.01, 60, 0.01, "seconds"), choice("easing", "easeOut", ["linear", "easeIn", "easeOut", "easeInOut"])
  ], "light", 4),
  b("M02", "fx.motion.slide", "Slide", "motion", "Directional slide with overshoot.", [
    choice("direction", "left", ["left", "right", "up", "down"]), number("distance", 0.35, 0, 2, 0.01, "canvas"),
    number("overshoot", 0.08, 0, 1, 0.01), vector("vector", [1, 0], -2, 2),
    number("duration", 1.2, 0.05, 60, 0.05, "seconds")
  ], "light", 5),
  b("M03", "fx.motion.scalePop", "Scale Pop", "motion", "Spring-like scale entrance.", [
    number("startScale", 0.2, 0, 4, 0.01), number("endScale", 1, 0, 4, 0.01),
    number("spring", 0.65, 0, 2, 0.01), vector("pivot", [0.5, 0.5]),
    number("duration", 1.2, 0.05, 60, 0.05, "seconds")
  ], "light", 5),
  b("M04", "fx.motion.rotateIn", "Rotate In", "motion", "Pivoted rotational entrance.", [
    number("angle", -90, -720, 720, 1, "degrees"), vector("pivot", [0.5, 0.5]),
    number("blur", 0.08, 0, 1, 0.01, "ratio", "medium"), number("turns", 2, -4, 4, 0.25, "turns"),
    number("duration", 1.2, 0.05, 60, 0.05, "seconds")
  ], "medium", 7),
  b("M05", "fx.motion.bounce", "Bounce", "motion", "Gravity-shaped repeated bounce.", [
    number("height", 0.25, 0, 2, 0.01, "canvas"), number("gravity", 9.8, 0.1, 40, 0.1, "m/s2"),
    number("bounces", 3, 1, 12, 1, "count"), number("damping", 0.55, 0, 1, 0.01),
    number("squash", 0.22, 0, 0.65, 0.01, "ratio")
  ], "light", 5),
  b("M06", "fx.motion.elastic", "Elastic", "motion", "Damped elastic displacement.", [
    number("amplitude", 0.16, 0, 2, 0.01, "canvas"), number("period", 0.28, 0.02, 4, 0.01, "seconds"),
    number("decay", 5, 0, 20, 0.1), choice("axis", "x", ["x", "y", "scale"])
  ], "light", 5),
  b("M07", "fx.motion.float", "Float", "motion", "Looping axial float.", [
    choice("axis", "y", ["x", "y", "both", "diagonal_down", "diagonal_up"]), number("range", 0.04, 0, 1, 0.005, "canvas"),
    number("frequency", 1, 0, 20, 0.1, "hertz"), number("phase", 0, -6.283, 6.283, 0.01, "radians")
  ], "light", 5),
  b("M08", "fx.motion.shake", "Shake", "motion", "Seeded impact shake.", [
    number("intensity", 0.04, 0, 1, 0.005, "canvas"), number("frequency", 12, 0, 60, 0.5, "hertz"),
    number("decay", 2.5, 0, 20, 0.1), number("seedOffset", 0, 0, 100000, 1, "seed")
  ], "light", 5),

  b("T01", "fx.text.typewriter", "Typewriter", "text", "Glyph-cell typewriter reveal.", [
    number("speed", 12, 0.1, 120, 0.1, "glyphs/s"), boolean("cursor", true),
    boolean("wordMode", false), number("cursorWidth", 0.08, 0.01, 1, 0.01, "glyph"),
    text("text", "在此输入文字", 80), choice("fontFamily", "song", ["song", "kai", "sans"]),
    number("fontSize", 72, 12, 240, 1, "pixels"), number("positionX", 0.5, 0, 1, 0.01, "canvas"),
    number("positionY", 0.5, 0, 1, 0.01, "canvas"), text("color", "#ffffff", 16)
  ], "light", 5),
  b("T02", "fx.text.characterCascade", "Character Cascade", "text", "Staggered glyph-cell cascade.", [
    number("stagger", 0.04, 0, 2, 0.01, "seconds"), choice("axis", "y", ["x", "y"]),
    number("offset", 0.25, -2, 2, 0.01, "canvas"), choice("selector", "character", ["character", "word", "line", "paragraph"]),
    text("text", "文字级联", 80), choice("fontFamily", "song", ["song", "kai", "sans"]),
    number("fontSize", 72, 12, 240, 1, "pixels"), number("positionX", 0.5, 0, 1, 0.01, "canvas"),
    number("positionY", 0.5, 0, 1, 0.01, "canvas"), text("color", "#ffffff", 16)
  ], "light", 5),
  b("T03", "fx.text.kineticTypography", "Kinetic Typography", "text", "Beat-driven cell scaling and layout.", [
    choice("layoutMode", "grid", ["grid", "radial", "stack"]), text("beatMap", "0,0.5,1"),
    text("scaleMap", "0.8,1.2,1"), number("strength", 0.35, 0, 2, 0.01),
    number("jumpDuration", 1, 0, 60, 0.1, "seconds"),
    text("text", "动感排版", 80), choice("fontFamily", "sans", ["song", "kai", "sans"]),
    number("fontSize", 88, 12, 240, 1, "pixels"), number("positionX", 0.5, 0, 1, 0.01, "canvas"),
    number("positionY", 0.5, 0, 1, 0.01, "canvas"), text("color", "#ffffff", 16)
  ], "medium", 7),
  b("T04", "fx.text.textPathReveal", "Text Path Reveal", "text", "Text reveal following a normalized path.", [
    text("path", "M0,0.5 C0.3,0.1 0.7,0.9 1,0.5"), number("progress", 0.5, 0, 1, 0.01),
    choice("orientation", "tangent", ["tangent", "upright"]), number("feather", 0.04, 0, 0.5, 0.005),
    number("duration", 2, 0.2, 30, 0.1, "seconds"), text("text", "PATH", 80),
    choice("fontFamily", "sans", ["song", "kai", "sans"]), number("fontSize", 72, 12, 240, 1, "pixels"),
    number("positionX", 0.5, 0, 1, 0.01, "canvas"), number("positionY", 0.5, 0, 1, 0.01, "canvas"),
    text("color", "#ffffff", 16)
  ], "medium", 7),
  b("T05", "fx.text.textMorph", "Text Morph", "text", "Seeded source-to-target glyph morph.", [
    text("sourceText", "CODE"), text("targetText", "MOTION"), choice("matchMode", "glyph", ["glyph", "outline", "position"]),
    number("progress", 1, 0, 1, 0.01), number("duration", 2.5, 0.2, 30, 0.1, "seconds"),
    choice("fontFamily", "sans", ["song", "kai", "sans"]), number("fontSize", 88, 12, 240, 1, "pixels"),
    number("sourcePositionX", 0.5, 0, 1, 0.01, "canvas"), number("sourcePositionY", 0.5, 0, 1, 0.01, "canvas"),
    number("targetPositionX", 0.5, 0, 1, 0.01, "canvas"), number("targetPositionY", 0.5, 0, 1, 0.01, "canvas"),
    text("sourceColor", "#5ac8fa", 16), text("targetColor", "#ff5ea8", 16)
  ], "heavy", 10),
  b("T06", "fx.text.scrambleDecode", "Scramble Decode", "text", "Seeded scramble-to-target decode over an authorized image.", [
    text("charset", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 256), number("speed", 24, 0.1, 240, 0.1, "glyphs/s"),
    choice("lockDirection", "left-to-right", ["left-to-right", "right-to-left", "random"]), number("progress", 0.5, 0, 1, 0.01),
    text("text", "DECODE", 80), choice("fontFamily", "sans", ["song", "kai", "sans"]),
    number("fontSize", 72, 12, 240, 1, "pixels"), number("positionX", 0.5, 0, 1, 0.01, "canvas"),
    number("positionY", 0.5, 0, 1, 0.01, "canvas"), text("color", "#ffffff", 16)
  ], "medium", 7),
  b("T07", "fx.text.wordExplode", "Word Explode", "text", "Cell-based word explosion with depth fade.", [
    number("force", 0.45, 0, 4, 0.01), number("rotation", 35, -720, 720, 1, "degrees"),
    number("depth", 0.3, 0, 2, 0.01, "canvas"), choice("selector", "word", ["character", "word"]),
    text("text", "文字爆散", 80), choice("fontFamily", "song", ["song", "kai", "sans"]),
    number("fontSize", 72, 12, 240, 1, "pixels"), number("positionX", 0.5, 0, 1, 0.01, "canvas"),
    number("positionY", 0.5, 0, 1, 0.01, "canvas"), text("color", "#ffffff", 16)
  ], "medium", 7),

  b("V01", "fx.vector.pathTrim", "Path Trim", "vector", "Arc-length path trim.", [
    number("start", 0, 0, 1, 0.01), number("end", 0.75, 0, 1, 0.01),
    number("offset", 0, -1, 1, 0.01), number("strokeWidth", 0.03, 0.001, 0.5, 0.001, "canvas")
  ], "light", 5),
  b("V02", "fx.vector.pathMorph", "Path Morph", "vector", "Normalized path interpolation.", [
    text("fromPath", "M0.1,0.5 L0.5,0.1 L0.9,0.5 L0.5,0.9 Z"), text("toPath", "M0.5,0.05 C0.9,0.2 0.9,0.8 0.5,0.95 C0.1,0.8 0.1,0.2 0.5,0.05 Z"),
    boolean("normalize", true), number("progress", 0.5, 0, 1, 0.01)
  ], "medium", 7),
  b("V03", "fx.vector.shapeRepeater", "Shape Repeater", "vector", "Repeated transformed vector cells.", [
    number("count", 8, 1, 128, 1, "count", "high"), vector("offset", [0.08, 0.04], -1, 1),
    number("rotation", 12, -360, 360, 1, "degrees"), number("scale", 0.92, 0.01, 2, 0.01)
  ], "medium", 8),
  b("V04", "fx.vector.radialBurst", "Radial Burst", "vector", "Procedural radial line burst.", [
    number("count", 24, 2, 256, 1, "count", "high"), number("radius", 0.42, 0, 2, 0.01, "canvas"),
    number("angle", 0, -360, 360, 1, "degrees"), number("thickness", 0.012, 0.001, 0.2, 0.001, "canvas")
  ], "medium", 8),

  b("D01", "fx.draw.handwriting", "Handwriting", "draw", "Pressure-shaped handwriting stroke.", [
    text("path", "M0.1,0.7 C0.25,0.2 0.75,0.8 0.9,0.3"), text("text", "手写文字", 80),
    choice("fontFamily", "kai", ["song", "kai", "sans"]), number("fontSize", 72, 12, 240, 1, "pixels"),
    number("positionX", 0.5, 0, 1, 0.01, "canvas"), number("positionY", 0.5, 0, 1, 0.01, "canvas"),
    text("color", "#202020", 16), number("pressure", 0.7, 0, 1, 0.01),
    number("speedVariation", 0.25, 0, 1, 0.01), number("progress", 0.5, 0, 1, 0.01)
  ], "medium", 7),
  b("D02", "fx.draw.brushReveal", "Brush Reveal", "draw", "Textured brush-mask transition between two images.", [
    text("brushTexture", "builtin://brush/round"), number("size", 0.12, 0.005, 1, 0.005, "canvas"),
    number("roughness", 0.35, 0, 1, 0.01), number("progress", 1, 0, 1, 0.01)
  ], "medium", 8),
  b("D03", "fx.draw.inkSpread", "Ink Spread", "draw", "Seeded diffusion and absorption.", [
    number("diffusion", 0.55, 0, 1, 0.01), number("edgeNoise", 0.2, 0, 1, 0.01),
    number("absorption", 0.65, 0, 1, 0.01), number("progress", 0.5, 0, 1, 0.01)
  ], "heavy", 11),
  b("D04", "fx.draw.chalkStroke", "Chalk Stroke", "draw", "Granular chalk stroke.", [
    number("grain", 0.55, 0, 1, 0.01), number("scatter", 0.18, 0, 1, 0.01),
    number("opacity", 0.85, 0, 1, 0.01), number("progress", 0.5, 0, 1, 0.01),
    text("color", "#f4f0df", 16), number("strokeWidth", 0.025, 0.002, 0.2, 0.001, "canvas")
  ], "medium", 8),

  b("L01", "fx.light.neonGlow", "Neon Glow", "light", "Linear-space neon edge glow.", [
    text("color", "#42C8FF", 16), number("radius", 0.08, 0, 0.5, 0.005, "canvas", "high"),
    number("intensity", 1.8, 0, 8, 0.05), number("flicker", 0.12, 0, 1, 0.01)
  ], "heavy", 12),
  b("L02", "fx.light.scanBeam", "Scan Beam", "light", "Animated soft scan light.", [
    number("angle", 18, -360, 360, 1, "degrees"), number("width", 0.12, 0.005, 1, 0.005, "canvas"),
    number("softness", 0.4, 0, 1, 0.01), number("speed", 0.8, -10, 10, 0.1, "cycles/s")
  ], "medium", 8),
  b("L03", "fx.light.lensFlare", "Lens Flare", "light", "Procedural flare ghosts and streak.", [
    vector("source", [0.72, 0.28]), number("ghosts", 2, 0, 8, 1, "count", "high"),
    number("streak", 0.18, 0, 1, 0.01), number("chromatic", 0.03, 0, 0.5, 0.01)
  ], "heavy", 13),
  b("L04", "fx.light.energyPulse", "Energy Pulse", "light", "Radial energy rings.", [
    vector("center", [0.5, 0.5]), number("radius", 0.34, 0, 2, 0.01, "canvas"),
    number("falloff", 0.2, 0.001, 1, 0.005), number("rings", 4, 1, 32, 1, "count", "medium"),
    number("duration", 3, 0.1, 60, 0.1, "seconds"),
    choice("centerMode", "coordinates", ["coordinates", "brightest", "subject_center", "subject_left", "subject_right", "subject_top", "subject_bottom"])
  ], "medium", 9),

  b("P01", "fx.post.gaussianBlur", "Gaussian Blur", "post", "Separable Gaussian approximation.", [
    number("radius", 6, 0, 64, 0.5, "pixels", "high"), number("passes", 2, 1, 8, 1, "count", "high"),
    choice("edgeMode", "clamp", ["clamp", "wrap", "mirror"]), boolean("alphaAware", true)
  ], "heavy", 14),
  b("P02", "fx.post.directionalBlur", "Directional Blur", "post", "Directional multi-sample blur.", [
    number("angle", 0, -360, 360, 1, "degrees"), number("distance", 12, 0, 128, 1, "pixels", "high"),
    number("samples", 8, 1, 32, 1, "count", "high"), choice("edgeMode", "clamp", ["clamp", "wrap", "mirror"])
  ], "heavy", 14),
  b("P03", "fx.post.radialBlur", "Radial Blur", "post", "Radial zoom or spin blur.", [
    vector("center", [0.5, 0.5]), number("strength", 0.16, 0, 2, 0.01),
    choice("mode", "zoom", ["zoom", "spin"]), number("samples", 8, 1, 32, 1, "count", "high")
  ], "heavy", 15),
  b("P04", "fx.post.motionBlur", "Motion Blur", "post", "Velocity-aligned shutter blur.", [
    number("shutterAngle", 180, 0, 720, 1, "degrees"), number("samples", 8, 1, 32, 1, "count", "high"),
    vector("velocity", [0.08, 0], -2, 2), boolean("centered", true)
  ], "heavy", 15),

  b("C01", "fx.transition.wipe", "Wipe", "transition", "A/B linear wipe.", [
    choice("direction", "left", ["left", "right", "up", "down"]), number("softness", 0.04, 0, 0.5, 0.005),
    number("angle", 0, -180, 180, 1, "degrees"), number("progress", 1, 0, 1, 0.01),
    number("duration", 2, 0.2, 30, 0.1, "seconds")
  ], "light", 6),
  b("C02", "fx.transition.radialWipe", "Radial Wipe", "transition", "A/B radial sector wipe.", [
    vector("center", [0.5, 0.5]), number("startAngle", -90, -360, 360, 1, "degrees"),
    boolean("clockwise", true), number("progress", 0.5, 0, 1, 0.01)
  ], "medium", 8),
  b("C03", "fx.transition.liquidWipe", "Liquid Wipe", "transition", "Seeded liquid-edge A/B wipe.", [
    number("noise", 0.16, 0, 1, 0.01), number("viscosity", 0.6, 0, 1, 0.01),
    number("edgeGlow", 0.25, 0, 2, 0.01), number("progress", 1, 0, 1, 0.01)
  ], "heavy", 12),
  b("C04", "fx.transition.pixelDissolve", "Pixel Dissolve", "transition", "Seeded pixel-block A/B dissolve.", [
    number("grid", 20, 2, 128, 1, "cells", "medium"), choice("order", "random", ["random", "linear", "radial"]),
    number("seed", 1, 0, 100000, 1, "seed"), number("progress", 0.5, 0, 1, 0.01)
  ], "medium", 9),

  b("H01", "fx.composite.maskReveal", "Mask Reveal", "composite", "Feathered animated mask reveal.", [
    text("mask", "context://mask"), number("progress", 0.5, 0, 1, 0.01),
    number("feather", 0.04, 0, 0.5, 0.005), boolean("invert", false)
  ], "medium", 8),
  b("H02", "fx.composite.trackMatte", "Track Matte", "composite", "Alpha or luminance track matte.", [
    text("matteLayer", "context://secondary"), choice("mode", "alpha", ["alpha", "luma"]),
    boolean("invert", false), number("opacity", 1, 0, 1, 0.01)
  ], "medium", 8),
  b("H03", "fx.composite.blend", "Blend", "composite", "Premultiplied layer blend.", [
    choice("mode", "normal", ["normal", "multiply", "screen", "add", "difference"]), number("opacity", 1, 0, 1, 0.01),
    boolean("premultiply", true), number("mix", 1, 0, 1, 0.01)
  ], "medium", 8),
  b("H04", "fx.composite.displacementMap", "Displacement Map", "composite", "Channel-driven texture displacement.", [
    text("map", "context://secondary"), number("xAmount", 0.05, -1, 1, 0.005, "canvas"),
    number("yAmount", 0.05, -1, 1, 0.005, "canvas"), choice("channel", "luma", ["red", "green", "blue", "alpha", "luma"])
  ], "medium", 9)
]);

export const GROUP_3_REQUIRED_EFFECT_ID = "fx.text.textExtrude3D" as const;
