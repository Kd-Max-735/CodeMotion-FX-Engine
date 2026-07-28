# Stage 5 Group 2 effect delivery

Status: **G2-S5 PASS**

## Scope

`@codemotion/effects-2d` implements all 39 P0 IDs assigned to Group 2 by
`docs/P0_EFFECT_CATALOG.md`. Its aggregate registry consumes Group 3's unchanged T08
`fx.text.textExtrude3D` at frozen slot 16, producing exactly 40 unique P0 effects.

The package consumes the frozen Stage 3 Effect Definition and Renderer Adapter
contracts without changing public Core, Schema, compositor or renderer APIs.

Each Group 2 effect provides:

- unique source/effect ID and version `1.0.0`;
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
