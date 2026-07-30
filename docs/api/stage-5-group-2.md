# Stage 5 Group 2 effect delivery

Status: **G2-S5R-T08-CONSUMER PASS / S5R BLOCKED — Group 2 implementation slice 39/39 PASS**

## S5R remediation result (2026-07-29)

All 39 Group 2 effects pass the G1 temporal/raster contract and the complete
39-by-20 self-check matrix (`packages/effects-2d/test/fixtures/s5r-self-check.json`):
780/780 checks are PASS. The package no longer contains `__cmfxElapsedSeconds`.
Every runtime consumes `EffectTimeSample`; seeded behavior uses
`createEffectRandom`; transition/composite WebGL paths consume
`DualInputTextures`. Missing temporal or real raster provenance rejects explicitly.

Reviewed evidence:

- G2 unit suite: 450/450 tests, including all 156 declared parameter perturbations,
  arbitrary project start/FPS/duration translation invariance, real multilingual
  glyph/SVG/RGBA/A-B inputs, Alpha, masks, three-run determinism, sizes, seeds and
  quality grades;
- CPU Golden: 200/200 aggregate frames (195 G2 plus unchanged five-frame T08);
- Edge 150 WebGL2/ANGLE D3D11: 195/195 G2 `readPixels` Goldens, 156/156 parameter
  perturbations, 39 semantic sequences, 39 Alpha, 39 mask, 39 deterministic and
  117 quality executions;
- colors: 39 sRGB and 39 linear-sRGB GPU checks, 39 Display-P3 CPU checks with the
  G1 renderer's explicit Display-P3 fallback exercised;
- Edge performance: maximum render/readback median 3.2 ms, GPU median 0.037 ms,
  minimum 1% Low 117.65 FPS, maximum two draw calls/two textures/55,296 bytes
  estimated VRAM, 34,622,482-byte peak heap, 48.5 ms first frame and 3.3 ms shader
  compile; five resource kinds balanced with no duplicate delete;
- CPU benchmark: 40/40 aggregate effects within declared budgets; V02 path geometry
  is precomputed and deterministically resampled by quality tier;
- Edge previews: 40/40 non-empty and pairwise-distinct; 156 effect/preset SVG cover
  paths are independently addressable without hash anchors.

The full repository gate remains blocked: `npm test` passes 645/646 tests. The
remaining G5 exporter consumer still sends T08 a generic surface and legacy
`progress` at `packages/exporter/src/project.ts:633`, then calls `renderPixels` at
line 635 instead of supplying the required `TextExtrude3DRasterInput`. G2 is not
authorized to modify the Group 5 exporter,
so the Stage 5R aggregate is not reported PASS.

### Time contract 1.1 identity closure

Every G2 `EffectTimeSample` construction now explicitly receives the real Effect
Definition ID and a unique caller-owned `EffectInstance.id`; no helper infers an
instance identity and no common fixed instance ID is shared between effects. CPU,
Canvas2D and WebGL consumers reject a missing, empty, wrong-version or wrong-type
identity.

The additional tests render all 39 effects directly from the official
`resolveEffectTimeSample` output. M08, T06, T07, D02, D04 and L01 additionally use
two instances of the same effect type: A and B produce distinct random streams, while
each instance reproduces the same result across three runs. The real Edge gate repeats
all six instance-isolation checks, with three-run determinism and distinct streams.

### T08 aggregate consumer closure

The G2 aggregate no longer re-exports or calls the removed
`makeTextExtrudePreviewInput` compatibility path. Catalog tests, CPU Golden capture,
benchmark and Edge preview now explicitly pass `fx.text.textExtrude3D`, a
caller-owned `effectInstanceId`, effect-local seconds, duration, FPS and project
start into the official `resolveProjectTimeSample` / `resolveLayerTimeSample` /
`resolveEffectTimeSample` chain. The resulting time drives G3's reviewed
`makeTextExtrudeRasterFixture`, which supplies real font identity, glyph metrics and
non-empty coverage rather than a generic pixel surface.

The aggregate suite passes 451/451 tests, including direct T08 CPU rendering and
all 40 registered WebGL paths with balanced release. The T08 five-frame CPU Golden
was recaptured only after semantic validation. The G2 39-effect / 195-frame subset
retained SHA-256
`5d422022de5f2c4a7e6b322d74ce12ff77d9738663a317ff4ffc859f34379577`
before and after capture. Edge 150 renders 40/40 non-empty and pairwise-distinct
aggregate previews.

## Scope

`@codemotion/effects-2d` implements all 39 P0 IDs assigned to Group 2 by
`docs/P0_EFFECT_CATALOG.md`. Its aggregate registry consumes Group 3's unchanged T08
`fx.text.textExtrude3D` at frozen slot 16, producing exactly 40 unique P0 effects.

The package consumes the frozen Stage 3 Effect Definition and Renderer Adapter
contracts without changing public Core, Schema, compositor or renderer APIs.

Each Group 2 effect provides:

- unique source/effect ID and version `1.1.0`;
- bounded parameter JSON Schema, UI Schema, defaults and three valid presets;
- deterministic CPU/Canvas2D implementation and WebGL2 shader execution;
- preferred/fallback backend, performance class and three quality levels;
- live preview, README and CHANGELOG entry;
- Alpha, mask, extreme/null-like parameter, deterministic seed and disposal behavior;
- unit coverage and fixed Golden Frames at 0%, 25%, 50%, 75% and 100%;
- an executable per-effect benchmark with declared budget.

T08 remains implemented and owned by Group 3. The G2 aggregate recognizes its
version, frozen parameters, Schema/UI, presets, backends, quality/performance,
preview, disposal, Golden Frames, Alpha/mask and deterministic contracts.

## Verification

Run from the repository root:

```text
npm run typecheck
npm test
npm run benchmark -w @codemotion/effects-2d
npm run qa:webgl -w @codemotion/effects-2d
npm run qa:preview -w @codemotion/effects-2d
npm run evidence:s5r -w @codemotion/effects-2d
```

Verified on 2026-07-28:

- strict build and test typecheck passed;
- 15 test files and 359 tests passed, including all Stage 1-4 and unchanged T08
  regressions;
- all 40 Effect Definitions satisfy frozen Schema `1.0.0`;
- all 200 CPU Golden Frame hashes matched; T08's five Group 3 hashes were not changed;
- all 156 Group 2 parameters passed targeted observable-pixel perturbation through
  both `renderPixels` and the actually selected Canvas2D fallback `render` path;
- real Microsoft Edge 150/WebGL2 on ANGLE D3D11 / Intel UHD Graphics compiled and
  executed all 39 Group 2 effect-specific shaders and matched 195 reviewed
  pixel-readback Golden Frames;
- the same real WebGL2 run passed 156/156 parameter perturbations using candidates
  that also changed the CPU/fallback result for the same normalized params, seed,
  progress and quality; it also passed 39/39
  straight/premultiplied Alpha checks, 39/39 external zero-mask checks including
  H01-H04, 39/39 deterministic reruns, and 117/117 quality-tier executions;
- all 40 registered WebGL paths also executed through the Stage 3 adapter test, while
  every GPU texture/framebuffer allocation was released exactly once; the Edge run
  additionally balanced all five tracked WebGL resource kinds with zero duplicate
  deletion;
- all 39 Group 2 CPU/Canvas2D paths passed transparent Alpha, straight/premultiplied
  equivalence, zero/external mask, extreme parameter and deterministic seed checks;
- all four transitions returned exact A/B endpoints at 0%/100%;
- all 40 measured CPU 64x36 preview benchmarks passed their declared budgets;
- all 39 real Edge WebGL2 render/readback benchmarks passed their declared budgets,
  with a maximum observed median of 2.4 ms;
- Edge headless rendered 40 preview cards and 40 non-zero, pairwise-distinct canvas
  fingerprints with no console/page errors.

## G7 parameter/WebGL closure

The G7-blocked category-only shader implementation was replaced by 39 individually
identified shader bodies. Shared GLSL sampling and Alpha helpers remain common, but
each effect consumes every slot encoded from its own frozen parameter order and has
distinct rendering logic. The 33-effect/62-parameter reported gap is closed by the
broader exhaustive 39-effect/156-parameter perturbation gate; no parameter was removed
and no assertion was weakened.

CPU Golden changes were recorded only after both the exhaustive CPU/fallback
perturbation gate and the real Edge WebGL2 gate passed. The reason is the repaired
parameter, edge-mode, composite-mask and Alpha semantics; the independent WebGL
fixture was captured from real `readPixels`, not from FakeGL draw-call counting.

## S7R time-unit regression closure

On 2026-07-29, G2 separated elapsed timeline seconds from normalized effect progress
inside both Canvas2D and WebGL2 paths. For M01 on a six-second range, `duration=1`
with linear easing now produces foreground-shape Alpha at 0, 0.25, 1, 3, and 5.9
seconds of 0%, 25%, 100%, 100%, and 100% respectively.

The first 40 effects contain nine G2 parameters with seconds or rate units and no
frame/fps/millisecond parameter. The audit covers M01 duration, M05 gravity, M06
period, M07/M08 frequency, T01/T06 glyph speed, T02 stagger, and L02 cycle speed.
Their declarations and UI units remain unchanged; their CPU/fallback and WebGL
implementations now consume elapsed seconds. No AI, editor, exporter, T08, Core,
Schema, or Renderer API file changed.

Final S7R verification passed the repository typecheck, 18 files / 413 tests,
40/40 CPU benchmarks, 200 CPU Golden Frames, and the real Edge WebGL2 suite:
195 pixel-readback Golden Frames, 156 parameter perturbations, 39 Alpha checks,
39 zero-mask checks, 39 deterministic reruns, 117 quality-tier executions,
balanced resource disposal, and 39/39 GPU benchmark budgets.

## T08 seam closure

`verifyGroup3TextExtrudeInterface` verifies only T08's frozen seam: ID/version, a
WebGL/Three backend and required `depth`, `bevel`, `material`, `light` parameters.
The delivered Group 3 definition reports:

```json
{
  "effectId": "fx.text.textExtrude3D",
  "available": true,
  "compatible": true,
  "missing": []
}
```

The aggregate imports that definition directly and does not add, substitute or modify
any T08 implementation.
