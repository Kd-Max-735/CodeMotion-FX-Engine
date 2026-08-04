# Changelog

## 1.2.0 - 2026-08-03

Added the frozen `P0_BROWSER_PROJECT_AUTHORITY_V1` production singleton, constructed
once from the real 40-entry `P0_EFFECTS_BY_ID` catalog through Schema `0.4.0`'s
internal binding point. No registry, builder, rebinding hook, or replacement options
are exported.

Added the formal deterministic 2D raster adapter for built-in text, shape, and safe
inline-SVG layers at requested output dimensions. It enforces the frozen font,
Unicode, color, glyph-coverage, SVG grammar, byte, command, coordinate, pixel, and
abort budgets. XML, external resources, arbitrary URLs/files, OS fonts, DOM/Canvas,
and uploaded media are unsupported. Uploaded image/video/audio/SVG materialization
remains owned by Group 5 and is not routed through this adapter.

The package is now `1.2.0`; Effect Definition and preset versions remain `1.1.0`.

## 1.1.0 - 2026-07-29

Migrated all 39 Group 2 effects to G1's versioned `EffectTimeSample` and
`TemporalEffectRenderContext`. Removed the private elapsed-time field and all
project-duration/absolute-frame inference. Seeded motion, text, draw, light, and
transition paths now obtain deterministic streams through `createEffectRandom`.
Transition/composite WebGL renders validate and consume `DualInputTextures`.

Updated the 40-item aggregate's T08 consumers for G3's strict interface. Catalog
tests, CPU Golden capture, benchmark and Edge preview now resolve official
`EffectTimeSample` 1.1.0 values from explicit effect and instance IDs and render
G3's reviewed glyph-backed `TextRasterSource`. Removed the deprecated generic
`makeTextExtrudePreviewInput` re-export; the 39 G2 effects and their 195 Golden
hashes are unchanged.

Added strict real-input provenance: multilingual glyph coverage, parsed SVG/contour
geometry, brush coverage, decoded RGBA media, independent A/B inputs, matte and
displacement inputs. String hashes no longer stand in for paths, text, brush assets,
matte references, or displacement maps; unresolved or malformed inputs fail.

CPU processing now uses linear-sRGB internally with sRGB, linear-sRGB, and Display-P3
conversion, straight/premultiplied Alpha, feathered/inverted/translated masks, and
real antialiased edges. The real Edge WebGL2 gate adds linear-sRGB execution, GPU
timer queries, FPS and 1% Low, draw/texture/VRAM/heap, first-frame and shader-compile
evidence. Added 156 independently addressable SVG covers and a 1.0.0 to 1.1.0
migration that preserves parameter values while requiring the versioned time and
raster-input channels.

Added a machine-validated 39-by-20 S5R evidence matrix and durable CPU/Edge
performance reports. Vector paths are flattened once per render and deterministically
resampled by quality tier; this removes V02's per-pixel path reconstruction while
preserving real parsed-SVG semantics. Its CPU Golden baseline was updated only after
all parameter, Alpha, mask, color, determinism, and multi-quality semantic checks
passed, with the resampling reason recorded in the fixture.

Completed the G1 time-contract 1.1 audit. All G2 time fixtures now require explicit,
non-empty `effectId` and `effectInstanceId`; CPU, Canvas2D and WebGL entry points
validate both identities. Official `resolveEffectTimeSample` results render directly
for all 39 effects. Six effects with observable random semantics verify distinct
same-type instance streams and three-run determinism on both CPU and real Edge
WebGL2. Random-dependent CPU/WebGL Goldens and performance evidence were regenerated
only after these semantic checks passed.

## 1.0.1 - 2026-07-29

Corrected time-unit semantics without changing Effect Definition, Core, Schema, or
Renderer APIs. The main Canvas2D and WebGL2 paths now carry elapsed timeline seconds
separately from normalized progress. M01 `duration=1` therefore completes at one
second and holds its final Alpha for the remainder of a six-second effect range.

The same audit corrected all other Group 2 parameters declared in seconds or rates:
M05 gravity, M06 period, M07/M08 frequency, T01/T06 glyph speed, T02 stagger, and L02
cycle speed. Golden changes were accepted only after foreground-shape Alpha timing,
all-parameter semantics, real Edge WebGL2, determinism, Alpha, mask, resource, and
performance checks passed.

## 1.0.0 - 2026-07-28

Initial Group 2 P0 release. Every item below adds its Effect Definition, parameter/UI
Schema, defaults, Gentle/Balanced/Bold presets, WebGL and Canvas2D paths, preview,
quality/performance metadata, deterministic dispose-capable runtime, Golden Frames,
Alpha/mask/extreme coverage and benchmark budget.

The release also adds the frozen 40-item `P0_EFFECTS` aggregate registry, registers
Group 3's unchanged T08 `fx.text.textExtrude3D` at catalog slot 16, and expands
aggregate Golden, benchmark, WebGL/resource and browser preview coverage to 40/200.

G7 follow-up replaced the shared category-only WebGL behavior with 39 effect-specific
shader bodies and made all 156 declared parameters observable in both the WebGL2 and
Canvas2D paths. CPU Golden hashes were updated only after the complete parameter
perturbation suite passed; the changed hashes record the repaired parameter, composite
mask, straight/premultiplied Alpha, and edge-mode semantics rather than visual
re-recording. T08's five Group 3 hashes remain unchanged.

The reviewed WebGL fixture is a separate real Microsoft Edge WebGL2 pixel readback on
the default ANGLE D3D11 / Intel UHD Graphics device: 195 frames at
0/25/50/75/100%, plus 156 parameter perturbations, 39 zero-mask checks
(including H01-H04), 39 straight/premultiplied checks, 39 deterministic reruns,
117 quality-tier executions, real readback benchmarks, and balanced GPU resource
creation/deletion.

### M01
Added `fx.motion.fade`.
### M02
Added `fx.motion.slide`.
### M03
Added `fx.motion.scalePop`.
### M04
Added `fx.motion.rotateIn`.
### M05
Added `fx.motion.bounce`.
### M06
Added `fx.motion.elastic`.
### M07
Added `fx.motion.float`.
### M08
Added `fx.motion.shake`.
### T01
Added `fx.text.typewriter`.
### T02
Added `fx.text.characterCascade`.
### T03
Added `fx.text.kineticTypography`.
### T04
Added `fx.text.textPathReveal`.
### T05
Added `fx.text.textMorph`.
### T06
Added `fx.text.scrambleDecode`.
### T07
Added `fx.text.wordExplode`.
### V01
Added `fx.vector.pathTrim`.
### V02
Added `fx.vector.pathMorph`.
### V03
Added `fx.vector.shapeRepeater`.
### V04
Added `fx.vector.radialBurst`.
### D01
Added `fx.draw.handwriting`.
### D02
Added `fx.draw.brushReveal`.
### D03
Added `fx.draw.inkSpread`.
### D04
Added `fx.draw.chalkStroke`.
### L01
Added `fx.light.neonGlow`.
### L02
Added `fx.light.scanBeam`.
### L03
Added `fx.light.lensFlare`.
### L04
Added `fx.light.energyPulse`.
### P01
Added `fx.post.gaussianBlur`.
### P02
Added `fx.post.directionalBlur`.
### P03
Added `fx.post.radialBlur`.
### P04
Added `fx.post.motionBlur`.
### C01
Added `fx.transition.wipe`.
### C02
Added `fx.transition.radialWipe`.
### C03
Added `fx.transition.liquidWipe`.
### C04
Added `fx.transition.pixelDissolve`.
### H01
Added `fx.composite.maskReveal`.
### H02
Added `fx.composite.trackMatte`.
### H03
Added `fx.composite.blend`.
### H04
Added `fx.composite.displacementMap`.

T08 `fx.text.textExtrude3D` is intentionally not implemented here. It is owned by
Group 3 and consumed unchanged by the aggregate registry.
