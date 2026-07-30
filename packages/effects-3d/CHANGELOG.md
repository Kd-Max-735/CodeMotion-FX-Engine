# Changelog

## Stage 5R — 2026-07-29

- T08 now implements `RegisteredTemporalEffectDefinition` and consumes the
  required G1 `EffectTimeSample 1.1.0` without private/fixed progress.
- Separated `effectId` from `effectInstanceId`; official resolver output renders
  directly across arbitrary duration, FPS and translated project clocks.
- Replaced generic pixel-only text input with validated Unicode
  `TextRasterSource` glyph coverage and matching raster provenance.
- Added indexed front/back/side glyph geometry, 20-dimension S5R evidence,
  Unicode/time/parameter/quality Goldens and explicit missing-input failures.

## 1.0.0 — 2026-07-28

### T08

- Added `fx.text.textExtrude3D` versioned definition, parameter/UI schemas,
  defaults, three presets, WebGL2 and explicit CPU fallback paths.
- Added quality levels, heavy performance grade, preview, disposal, migration,
  Golden Frames, Alpha/mask/extreme checks, benchmark and deterministic tests.
