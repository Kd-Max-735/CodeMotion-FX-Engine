# P0 40-effect execution catalog

Status: **FROZEN** at `8-S4` on 2026-07-28. These are product effect IDs from the authoritative requirement, not fabricated `P01-P40` placeholders. The Stage 3/4 validation effects do not count toward this catalog.

Selection rule: Chapter 26.1 requires five directions with eight effects each. A direction matching one source category takes all eight source entries. A direction combining two source categories takes the first four entries from each category in source order. This gives a deterministic 40-item scope without inventing IDs.

| P0 slot | Source ID | Effect ID | Primary implementation owner |
| ---: | --- | --- | --- |
| 01 | M01 | `fx.motion.fade` | Group 2 |
| 02 | M02 | `fx.motion.slide` | Group 2 |
| 03 | M03 | `fx.motion.scalePop` | Group 2 |
| 04 | M04 | `fx.motion.rotateIn` | Group 2 |
| 05 | M05 | `fx.motion.bounce` | Group 2 |
| 06 | M06 | `fx.motion.elastic` | Group 2 |
| 07 | M07 | `fx.motion.float` | Group 2 |
| 08 | M08 | `fx.motion.shake` | Group 2 |
| 09 | T01 | `fx.text.typewriter` | Group 2 |
| 10 | T02 | `fx.text.characterCascade` | Group 2 |
| 11 | T03 | `fx.text.kineticTypography` | Group 2 |
| 12 | T04 | `fx.text.textPathReveal` | Group 2 |
| 13 | T05 | `fx.text.textMorph` | Group 2 |
| 14 | T06 | `fx.text.scrambleDecode` | Group 2 |
| 15 | T07 | `fx.text.wordExplode` | Group 2 |
| 16 | T08 | `fx.text.textExtrude3D` | Group 3 |
| 17 | V01 | `fx.vector.pathTrim` | Group 2 |
| 18 | V02 | `fx.vector.pathMorph` | Group 2 |
| 19 | V03 | `fx.vector.shapeRepeater` | Group 2 |
| 20 | V04 | `fx.vector.radialBurst` | Group 2 |
| 21 | D01 | `fx.draw.handwriting` | Group 2 |
| 22 | D02 | `fx.draw.brushReveal` | Group 2 |
| 23 | D03 | `fx.draw.inkSpread` | Group 2 |
| 24 | D04 | `fx.draw.chalkStroke` | Group 2 |
| 25 | L01 | `fx.light.neonGlow` | Group 2 |
| 26 | L02 | `fx.light.scanBeam` | Group 2 |
| 27 | L03 | `fx.light.lensFlare` | Group 2 |
| 28 | L04 | `fx.light.energyPulse` | Group 2 |
| 29 | P01 | `fx.post.gaussianBlur` | Group 2 |
| 30 | P02 | `fx.post.directionalBlur` | Group 2 |
| 31 | P03 | `fx.post.radialBlur` | Group 2 |
| 32 | P04 | `fx.post.motionBlur` | Group 2 |
| 33 | C01 | `fx.transition.wipe` | Group 2 |
| 34 | C02 | `fx.transition.radialWipe` | Group 2 |
| 35 | C03 | `fx.transition.liquidWipe` | Group 2 |
| 36 | C04 | `fx.transition.pixelDissolve` | Group 2 |
| 37 | H01 | `fx.composite.maskReveal` | Group 2 |
| 38 | H02 | `fx.composite.trackMatte` | Group 2 |
| 39 | H03 | `fx.composite.blend` | Group 2 |
| 40 | H04 | `fx.composite.displacementMap` | Group 2 |

## Execution gate

Each item must ship with its Effect Definition, parameter and UI Schema, defaults, at least one preset, deterministic implementation, WebGL path, declared fallback, Alpha/mask/color-space behavior, unit tests, Golden Frame, performance grade, preview asset, and migration/version evidence. A name or registry row alone is not completion.

Group 1 owns all public Schema/API and compositor contracts. Group 2 implements and integrates the 39 2D catalog effects. T08 is a Group 3 implementation delivered serially before Group 2 closes the Stage 5 catalog; its P0 scope includes only the minimum text geometry/material/light path required by the source definition, while the general 3D platform remains Stage 9. Group 7 verifies every item and the aggregate 40-count; Group 8 re-verifies and commits. No two groups write concurrently.

P05 `fx.post.depthOfField` is not one of the selected P0 40 entries. When scheduled later, Group 3 owns focus/depth/camera behavior and Group 2 owns catalog presentation and 2D fallback; Group 1 owns compositor and depth-texture contracts.

## Shared boundaries

- Compositor: Group 1 owns DAG scheduling, RenderTexture lifetime, Alpha/color-space semantics, masks, blending, and public contracts. Group 2 owns effect-specific passes and visual acceptance assets.
- Resources: Group 1 owns runtime descriptors, loading leases, cancellation, and release contracts. Group 5 owns decoding services, persistence, object storage, and operational delivery.
- Cache: Group 1 owns deterministic keys and runtime invalidation contracts. Group 5 owns persistent/distributed storage, quotas, eviction, and operations.
- Public Schema/API: Group 1 approval is required before any cross-package contract change starts; Group 7 verification and version/migration evidence are required before integration.
