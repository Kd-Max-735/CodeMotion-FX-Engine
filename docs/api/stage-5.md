# Stage 5 P0 effect registry freeze

Status: **FROZEN** on 2026-07-28 after Group 8 re-verification.

## Registry

`@codemotion/effects-2d` `1.0.0` exports the ordered aggregate `P0_EFFECTS` and
`P0_EFFECTS_BY_ID`. The registry contains exactly 40 unique entries in the
`docs/P0_EFFECT_CATALOG.md` order: 39 Group 2 effects plus Group 3 T08
`fx.text.textExtrude3D` at slot 16. `@codemotion/effects-3d` is frozen at `1.0.0`.

The canonical registry projection is the compact JSON serialization of each ordered
entry as:

```text
{slot,sourceId,effectId,version,owner}
```

Its SHA-256 is
`f827b6cf684fa6963e00ce33d4dd90efbd6b03ba6505c3d0149058bd53d73a3c`.
The aggregate unit test enforces this digest so a slot, ID, version, owner, addition,
or removal cannot change silently.

The Stage 1-4 public Core, Project Schema, Effect Definition Schema, Renderer Adapter,
compositor, and editor versions remain unchanged.

## Acceptance assets

Every registry entry was checked against the frozen catalog and has:

- a complete Effect Definition with bounded parameter Schema, UI Schema, defaults,
  three valid presets, version and migration handler;
- deterministic CPU/Canvas2D and WebGL execution, declared fallback, quality and
  performance grades, Alpha/mask behavior and disposal;
- README and CHANGELOG coverage plus a resolvable live preview asset;
- fixed Golden Frames at 0%, 25%, 50%, 75% and 100%.

The 39 Group 2 WebGL implementations additionally have independent real-Edge
pixel-readback fixtures. T08 has its own five-frame fixture and WebGL resource,
mask, fallback and deterministic coverage in the Group 3 suite. No registry entry is
a name-only row, placeholder, stub or deferred implementation.

## Group 8 re-verification

Run from the repository root:

```text
npm run typecheck
npm test
npm run benchmark -w @codemotion/effects-2d
npm run benchmark -w @codemotion/effects-3d
npm run qa:webgl -w @codemotion/effects-2d
npm run qa:preview -w @codemotion/effects-2d
npm run build -w @codemotion/editor
npm run qa:visual -w @codemotion/editor
```

Observed on 2026-07-28:

- 15 test files and 359 tests passed with the registry digest gate;
- 40/40 CPU preview benchmarks and the dedicated T08 benchmark passed;
- real Edge WebGL2 executed 39/39 Group 2 effects, 195 Golden Frames, all 156
  parameters, 39 Alpha checks, 39 mask checks, 39 deterministic checks and 117
  quality executions, with all five GPU resource kinds balanced;
- Edge rendered 40/40 non-empty, pairwise-distinct effect previews;
- the editor production build passed; desktop/mobile browser recovery and visual
  regression reported a non-blank 1,296-sample canvas, no console errors, 22.6 ms
  parameter latency and 48.2 ms timeline latency.

The detailed Group 2 and T08 implementation records remain
`docs/api/stage-5-group-2.md` and `docs/api/stage-5-group-3-t08.md`.
