# Stage 5R Group 3 T08 delivery

Status: **G3-S5R PASS / S5R BLOCKED ON G2 AND G5 CONSUMERS**

`@codemotion/effects-3d` implements only T08 `fx.text.textExtrude3D` at version
`1.0.0`. It consumes G1 time contract `1.1.0`,
`TemporalEffectRenderContext`, `RegisteredTemporalEffectDefinition`,
`TextRasterSource`, real glyph coverage and raster provenance without changing
public Core, Schema, compositor or renderer APIs.

Production rendering has no optional time or progress parameter. It accepts the
official `resolveEffectTimeSample` result directly, validates
`effectId=fx.text.textExtrude3D`, preserves caller-owned `effectInstanceId`, and
rejects missing/inconsistent clocks. Generic pixel-only input, empty glyph
coverage, missing font provenance and unrelated raster pixels fail explicitly.

The P0 path includes indexed Unicode glyph front/back/side geometry, bevel,
three materials, three directional-light rigs, bounded perspective/rotation,
real WebGL2 indexed drawing, explicit deterministic Canvas2D/CPU fallback,
draft/preview/final quality, heavy performance classification, three presets,
preview, migration, disposal, Alpha/mask behavior and independent CPU/WebGL
0/25/50/75/100% Golden Frames.

General 3D scene/camera/model/PBR/shadow/physics infrastructure remains Stage 9
and is intentionally absent.

Verification:

```text
npm run typecheck
npm test
npm run benchmark -w @codemotion/effects-3d
```

Verified on 2026-07-29:

- G3 source build and 19/19 T08 tests passed;
- the 1-by-20 S5R evidence matrix passed 20/20;
- `FX`, `立体` and `AΩ` use distinct reviewed glyph rasters;
- arbitrary 0.8/3.2/7.3/11.75-second durations, 24/48/60/120 FPS and translated
  project clocks preserve equal effect-local samples;
- all seven parameters have observable output, with three-run determinism,
  three quality grades, multiple sizes/seeds and extreme-value coverage;
- five distinct CPU Golden hashes and five distinct Edge WebGL2 Golden hashes
  matched at 0/25/50/75/100%;
- sRGB, linear-sRGB, Display-P3, straight/premultiplied Alpha, zero mask,
  fallback, disposal and balanced GPU texture/framebuffer release passed;
- 64x36 CPU benchmark median was 1.790 ms against 35 ms;
- Edge 150 WebGL2/ANGLE SwiftShader indexed-geometry preview median was
  30.100 ms against 35 ms, resources balanced, 50% fingerprint `438f9c94`.

## Aggregate blockers outside Group 3 authorization

The repository build passes, but Stage 5R remains blocked:

- `npm run typecheck`: G2
  `packages/effects-2d/test/effects-2d.test.ts:815` still supplies removed
  `{ progress }` instead of required `EffectTimeSample 1.1.0`.
- `npm test`: 642/645 passed. Two G2 tests still call the removed generic T08
  preview/time path, and one G5 exporter test passes a generic pixel surface
  instead of `TextRasterSource` plus raster provenance.

Group 3 is not authorized to change those consumers.
