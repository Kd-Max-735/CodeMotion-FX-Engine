# Stage 5R integration checkpoint

Status: **G8-S5R PASS candidate**

Baseline: `093d4f67f335949e37aca403449c23b98639f316` on the sole `integration`
branch. This checkpoint integrates only the serial S5R remediation work.

## Integrated scope

- 40 P0 effects: 39 Group 2 effects plus Group 3's T08
  `fx.text.textExtrude3D`, including published previews, presets, parameter
  schemas, keyframes, zoom behavior, fixtures, and Golden Frames.
- Group 1 public contracts: time contract `1.1.0`, layer rasterization
  contract `1.0.0`, and color/Alpha/blend/backend conformance `1.0.0`.
- Group 5 shared preview and export consume the same real project raster
  inputs. AI DSL draft previews also consume real text, vector, image, audio,
  video, and dual-input raster sources rather than synthetic solid surfaces.
- Editor catalog and controls expose all 40 effects through the frozen Schema
  parameters, presets, keyframes, and responsive zoom/layout paths.

Project Schema remains `1.2.0`; S5R does not invent a schema migration for the
separately versioned time semantics. Legacy absolute effect windows migrate
through `migrateLegacyAbsoluteEffectTiming`, while time samples from `1.0.0`
migrate through `migrateEffectTimeSampleV1` with the original effect instance
required. Effect packages record their own `1.0.0` to `1.1.0` parameter
migrations where applicable. T08 remains effect version `1.0.0` while consuming
time contract `1.1.0`.

## Verification

Verified on 2026-07-30 from the repository root:

- `npm run typecheck`: PASS.
- `npm test`: 21 files and 652 tests PASS.
- `npm run build -w @codemotion/editor`: PASS.
- CPU benchmarks: 40/40 effects PASS.
- Edge WebGL2: 39 Group 2 effects plus T08, 40 effects by five sampled
  progress points, 200 Golden Frames PASS; Alpha, masks, determinism, color,
  and resource release PASS.
- Edge previews: 40/40 non-empty and pairwise-distinct PASS.
- Export evidence: PNG sequence, GIF, WebM, and MP4 for 40 effects at five
  samples, 800/800 format cells PASS.
- Editor S5R browser gate: all 40 effects and 200 frames, complete Schema
  controls, shared preview/export, autosave recovery, desktop/mobile layout,
  nonblank canvas, and zero console errors PASS.
- Real render-center PNG/GIF/WebM/MP4 paths and desktop/mobile layouts PASS.

Published previews, Golden Frames, and deterministic fixtures are repository
assets. Browser screenshots, temporary media, live evidence, logs, and API
responses remain ignored under `tmp/` and are not part of this checkpoint.
Security inspection found no API key, Ark `file_id`, complete request ID,
private key, credential, or absolute local machine path in the integration
scope. The removed `doubao_glm_api_package/` remains absent and unreferenced.

## Non-blocking risk

The Vite production build emits one minified JavaScript chunk of `580.24 kB`
(`173.25 kB` gzip), above Vite's 500 kB warning threshold. S5R records this as
a performance/maintainability risk; no unrelated code-splitting refactor is
included in this integration.
