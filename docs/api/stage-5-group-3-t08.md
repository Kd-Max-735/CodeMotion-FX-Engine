# Stage 5 Group 3 T08 delivery

Status: **GROUP 3 T08 IMPLEMENTATION PASS**

`@codemotion/effects-3d` implements only T08 `fx.text.textExtrude3D` at version
`1.0.0`. It consumes the frozen Effect Definition `1.0.0` and Renderer Adapter
`1.1.0`/package `0.2.0` contracts without changing public Core, Schema,
compositor or renderer APIs.

The minimum P0 path includes raster-text extrusion geometry, bevel, three
materials, three directional-light rigs, bounded perspective/rotation, WebGL2,
an explicit deterministic Canvas2D/CPU fallback, draft/preview/final quality,
heavy performance classification, three presets, preview, migration, disposal,
Alpha/mask behavior and fixed 0/25/50/75/100% Golden Frames.

General 3D scene/camera/model/PBR/shadow/physics infrastructure remains Stage 9
and is intentionally absent.

Verification:

```text
npm run typecheck
npm test
npm run benchmark -w @codemotion/effects-3d
```

Verified on 2026-07-28:

- strict build and test typecheck passed;
- all 15 test files and 280 tests passed, including 10 T08 tests and all
  Stage 1-5 regressions;
- T08 satisfies Effect Definition Schema `1.0.0` and the frozen Group 2 seam;
- five distinct Golden Frame hashes matched at 0/25/50/75/100%;
- WebGL2 compiled/executed, mask composition ran, and every test GPU texture
  and framebuffer was released exactly once;
- transparent, premultiplied Alpha, zero-mask, extreme parameters, fallback,
  disposal and three-run deterministic checks passed;
- 64x36 preview benchmark median was 1.214 ms against a 35 ms budget;
- Edge headless rendered the live preview canvas with fingerprint `981f46fa`.
