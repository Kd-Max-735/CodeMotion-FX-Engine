# Changelog

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
