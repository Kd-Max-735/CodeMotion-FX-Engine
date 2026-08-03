# Chapter 27 - Serial Integration Governance

## 27.1 Sources and authority

The product source is tracked at `docs/requirements/AI代码动画与AE类特效引擎_任务开发需求说明书(1).md`, SHA-256 `87766d9c7ca059414419aa178e882e82d765dda174668b4d7eb07f09ffd5836e`. It was read in full on 2026-07-27.

Chapter 27 is the execution authority and its numbered milestones remain in order. Chapter 34 is only a concluding summary. The concrete conflict is:

- Chapter 27: Stage 1 engine contracts, Stage 2 timeline, Stage 3 WebGL composition, Stage 4 editor foundation, then Stage 5 first 40 effects.
- Chapter 34 summary: engine skeleton, then 40 high-frequency effects, then editor, export, AI DSL, 80 effects, 3D/simulation, 120 effects.
- Decision: follow Chapter 27. In particular, editor foundation precedes the first 40 effects. Chapter 34 does not reorder or collapse Chapter 27 milestones.

## 27.2 Repository baseline

| Item | Current state |
| --- | --- |
| Project origin | From zero in `D:\CodeMotion FX Engine v1` |
| Allowed initial inputs | The requirement document and new governance/engineering files; the historical untracked `doubao_glm_api_package/` input was never used and was removed by the user before Stage 6 |
| Forbidden baseline | `D:\CodeMotion FX Engine`, its 58 files, and every old commit; no access or import is permitted |
| Git layout | One working directory, no additional worktrees |
| Integration branch | `integration` |
| Remote | `origin` = `https://github.com/Kd-Max-735/CodeMotion-FX-Engine.git`; read-only query found no heads or tags on 2026-07-27 |
| Aggregate package | User-removed before Stage 6; absent with zero tracked files; restoration, reconstruction, or runtime reference is prohibited |
| Historical package manifest SHA-256 | `a613ccbcc2991af39c702b419a54dc48feacaae1d41c6bb1b73764f7a2e43b65`; audit evidence only, never a recovery source |

The successful 2026-07-27 empty-remote query is retained as local evidence. A later connection reset is only network state and does not block `1-S1`. Until another query succeeds, do not pull, merge, push, force-push, or rewrite remote history. If a successful future query shows history or incompatible refs, stop as BLOCKED before any remote integration.

## 27.3 Toolchain integration decision

These are integration decisions for this from-zero project, not mandatory wording from the product requirement:

| Concern | Decision |
| --- | --- |
| Workspace/package management | npm workspaces |
| Language policy | TypeScript strict mode |
| Unit tests | Vitest |
| Later browser and visual tests | Playwright |
| UI framework and bundler | React/Vite decision deferred until before Chapter 27 Stage 4 |

## 27.4 Serial write and handoff protocol

The total execution table is the authorization source. A stage obtains the only write permission when both conditions hold: the required prior PASS has been recorded, and the user sends that current-stage prompt to the corresponding group window. The user's message is the authorization event; Group 8 does not need to edit a row to `OPEN` or run a second gate-opening step. All other stages remain read-only.

Handoff sequence:

1. The assigned development group completes only the current row and reports PASS with evidence.
2. Group 7 independently verifies that row and reports PASS.
3. Group 8 rechecks status and the complete diff, integrates only that row, then checks status and HEAD again.
4. The repository becomes read-only until the user sends the next segment.

| Window | Scope | Sole writer | Verification | Integration | Authorization state |
| --- | --- | --- | --- | --- | --- |
| `8-S0` closeout | Requirement copy and final governance alignment | Group 8 | S0 policy checks, then Group 8 recheck | S0 closeout commit only | Authorized by the current user prompt; closes after verified commit |
| `1-S1` | Data model, Schema, renderer API, core package, example | Group 1 | Group 7-equivalent contract tests, then Group 8 recheck | Group 8 after verification | Verified 2026-07-27; closes with the Stage 1 integration commit |
| `1-S2` | Timeline, layer/transform evaluation, keyframes, command history | Group 1 | Stage 1 regression plus fixed-time/command tests, then Group 8 recheck | Group 8 after verification | Verified 2026-07-27; closes with the Stage 2 integration commit |
| `1-S3` | Effect Graph, resources/cache, WebGL composition, masks, Alpha, effect stack | Group 1 | Contract regressions, Golden Frame, GPU/resource release, and vertical-preview smoke, then Group 8 recheck | Group 8 after verification | Verified 2026-07-27; closes with the Stage 3 integration commit |
| `1-S4` | React/Vite editor foundation, real core preview, autosave/recovery | Group 4 | Core round-trip, browser recovery, production build, desktop/mobile visual checks, then Group 8 recheck | Group 8 after verification | Verified 2026-07-28; closes with the Stage 4 integration commit |
| Later rows | Defined by each current-stage prompt | Prompt-designated group | Group 7 | Group 8 | Pending prior PASS plus the user's matching prompt |

No integration commit may include another stage's files. No reset, checkout, clean, batch deletion, or force-add is allowed.

After `[G8-S0 PASS]`, the repository is read-only until the user sends `1-S1`. That message directly grants the `1-S1` window its sole write permission.

## 27.5 Group ownership

Group roles are the actual accountable identities; human names are not required.

| Group | Accountable scope |
| --- | --- |
| Group 1 | Engine core, renderer contracts, Resource Manager, Cache core, project serialization, public Schema/API |
| Group 2 | 2D and graphics effects, including motion, transition, media effects, procedural generative effects, and audio/data effects |
| Group 3 | 3D, camera, lighting, simulation, 3D text, and 3D post-processing |
| Group 4 | Workbench, canvas, layers, timeline UI, property panels, asset/effect UI, AI panel, render-center UI |
| Group 5 | Export and infrastructure: headless renderer, FFmpeg, WebCodecs, queues, segmented render, persistence, object storage, logs, monitoring, recovery |
| Group 6 | AI planning, retrieval, parameter generation, Schema repair, evaluation, redo, templates, AI safety |
| Group 7 | Independent unit, visual, performance, export, compatibility, security, stability, and long-run verification |
| Group 8 | Serial coordination, boundary decisions, final re-verification, integration commits, remote safety |

Current category ownership:

| Category | Primary group | Boundary note |
| --- | --- | --- |
| `motion` | Group 2 | Uses Group 1 timeline/transform contracts |
| `transition` | Group 2 | A/B input and compositor boundary finalized at `8-S4` |
| `media` | Group 2 | Effect behavior is Group 2; decode/storage/resource boundary with Groups 1/5 finalized at `8-S4` |
| `generative` | Group 2 | Procedural effects are not AI planning; boundary with Group 6 finalized at `8-S4` |
| `audio-data` | Group 2 | Effect behavior is Group 2; analysis/cache/infrastructure boundary finalized at `8-S4` |
| `compositor` | Group 1 | Core composition contracts; effect-specific composition stays with Group 2; exact seam at `8-S4` |
| resources | Group 1 / Group 5 | Group 1 owns runtime resource contracts; Group 5 owns persistence/object storage; exact seam at `8-S4` |
| cache | Group 1 / Group 5 | Group 1 owns runtime keys/interfaces; Group 5 owns persistent/distributed operation; exact seam at `8-S4` |
| public Schema/API | Group 1 | Cross-group changes require Group 1 approval and Group 7 verification |
| V1 model Provider | Group 6 after `6-S7` security clearance | Server-side Volcengine Ark only, using `doubao-seed-2-0-lite-260428`; the removed aggregate package must not be restored, rebuilt, or referenced |

## 27.6 P0 release scope and named effects

`P0` is the version phase in Chapter 26.1, not an effect-ID prefix. The earlier fabricated `P01-P40` register is invalid and removed.

Chapter 26.1 defines five directions, eight effects each:

| Direction | Count | Concrete IDs |
| --- | ---: | --- |
| Basic motion | 8 | M01-M08 in `docs/P0_EFFECT_CATALOG.md` |
| Text | 8 | T01-T08 in `docs/P0_EFFECT_CATALOG.md` |
| Vector and stroke | 8 | V01-V04 and D01-D04 in `docs/P0_EFFECT_CATALOG.md` |
| Light and post-processing | 8 | L01-L04 and P01-P04 in `docs/P0_EFFECT_CATALOG.md` |
| Transition and composition | 8 | C01-C04 and H01-H04 in `docs/P0_EFFECT_CATALOG.md` |

The 40 real effect IDs and cross-group boundaries were frozen at `8-S4` in `docs/P0_EFFECT_CATALOG.md`, before `2-S5`. The selection is traceable to the authoritative source tables and does not treat P0 as an ID prefix.

Two source definitions are already known and are not blockers:

| Catalog ID | Effect ID | Parameters | S0 ownership state |
| --- | --- | --- | --- |
| `T08` | `fx.text.textExtrude3D` | `depth`, `bevel`, `material`, `light` | P0 item; Group 3 implements the minimum 3D text path, Group 2 integrates catalog/presets, Group 1 owns contracts |
| `P05` | `fx.post.depthOfField` | `focusDistance`, `aperture`, `maxBlur` | Not selected for P0 40; Group 3 owns depth/camera behavior, Group 2 owns catalog/fallback, Group 1 owns compositor/depth contracts |

## 27.7 Chapter 27 milestone gates

| Stage | Required delivery | Gate |
| ---: | --- | --- |
| 1 | Data model, Schema, renderer API; core package and example project | Core contracts approved by Group 1 and verified by Group 7 |
| 2 | Timeline, layers, transforms, keyframes; playable basic animation | Determinism and playback tests pass |
| 3 | WebGL composition, masks, effect stack; 2D engine MVP | Composition and visual baselines pass |
| 4 | Editor foundation; layers, canvas, properties, timeline | Core editing workflow passes |
| 5 | First 40 effects; functions, presets, tests | The `8-S4` ID/boundary decision exists and all effect acceptance assets pass |
| 6 | Offline render/export; PNG, GIF, WebM, MP4 | Export matrix passes |
| 7 | AI DSL and planning; prompt-to-project | Schema, safety, and generation tests pass |
| 8 | Particle, audio, procedural; 80 effects | Performance and deterministic cache tests pass |
| 9 | 3D, physics, post-processing; 120 effects | 3D/simulation quality and fallback tests pass |
| 10 | Performance, compatibility, stability | Release-candidate verification passes |

Stage 1 public contract freeze: packages and engine `0.1.0`; Project Schema `1.0.0`; Effect Definition Schema `1.0.0`; Renderer Adapter API `1.0.0`; JSON Schema ID `https://schemas.codemotion.dev/contracts/v1/contracts.schema.json`. The authoritative scope and change-control record is `docs/api/stage-1.md`.

Stage 2 stability freeze: root/engine/core/Schema `0.2.0`; timeline and scene-graph `0.1.0`; Project Schema `1.1.0`; command interface at core `0.2.0`; Effect Definition Schema and Renderer Adapter API remain `1.0.0`. The authoritative scope and fixed-time/command record is `docs/api/stage-2.md`.

Stage 3 stability freeze: root/engine/core/Schema `0.3.0`; Project Schema `1.2.0`; Renderer Adapter API `1.1.0`; renderer-api package `0.2.0`; expression, effect-graph, renderer-webgl, resource-manager, and cache packages `0.1.0`; Effect Definition Schema remains `1.0.0`. The authoritative core and WebGL records are `docs/api/stage-3.md` and `docs/api/stage-3-webgl.md`.

Stage 4 stability freeze: editor `0.1.0` on the unchanged Stage 3 public contracts. The editor scope and verification record is `docs/api/stage-4.md`; the executable Stage 5 input catalog and final ownership boundaries are frozen in `docs/P0_EFFECT_CATALOG.md`.

Stage 5 stability freeze: effects-2d and effects-3d `1.0.0`; the ordered 40-entry P0 registry digest is `f827b6cf684fa6963e00ce33d4dd90efbd6b03ba6505c3d0149058bd53d73a3c`. Stage 1-4 public contracts remain unchanged. The authoritative registry and Group 8 verification record is `docs/api/stage-5.md`.

Stage 6 stability freeze: exporter `0.1.0`; Stage 1-5 public Core, Project Schema, Effect Definition Schema, Renderer Adapter API, and P0 registry remain unchanged. The server-side fixed-frame project renderer, media integrity boundary, FFmpeg export matrix, and render-center verification record is `docs/api/stage-6.md`.

Stage 7 remediation boundary freeze (`1-S7R-A`): no public Core, Project Schema, Effect Definition Schema, Renderer Adapter API, or P0 registry change is required. The authoritative server-only `ai-task/v1` input/output, complete 40-effect aggregate interface, tenant/authorization boundary, media-format gap classification, and 11-preset staging decision are in `docs/api/stage-7r-group-1-boundary.md`. This is a contract decision and does not claim that the assigned Group 5 or Group 6 remediation is implemented.

Stage 7 remediation authentication/upload freeze (`1-S7R-F0`, corrected by `1-S7R-F0-CORRECTION`): V1 uses an OIDC Authorization Code + PKCE BFF that verifies signed JWTs and issues only opaque HttpOnly server sessions to browsers. Production login and callback are bound to the initiating browser by same-origin navigation evidence and a single-use five-minute pre-login Cookie; local development uses an explicitly enabled, loopback-only, browser-bound one-time-code server session and cannot be enabled in preview/production. The exact principal, three request-forgery rules, authorization-before-body, browser media API, canonical MIME-to-temporary-suffix mapping, non-configurably bounded streaming multipart protocol, shared persistent `TenantMediaStore`, file ownership, and verification gates are authoritative in `docs/api/stage-7r-group-1-auth-upload-boundary.md`. No frozen Core, Project Schema, Effect Definition Schema, Renderer Adapter API, time contract, or P0 registry changes.

Stage 7 formal project-chain freeze (`1-S7R-G0`, corrected by `1-S7R-G0-CORRECTION`): the only AI Project -> edit -> Preview -> Export path uses the versioned `browser-project/v1` strict safe overlay, session-derived owner, the one runtime `TenantMediaStore`, server-only trusted materialization, and the existing `createProjectFrameProducer(...,{resolveRasterSource})` extension. Project Schema remains `1.2.0`; the approved public changes are Schema package `0.4.0` transport APIs and single six-scope contract, AI planner package `0.4.0` with `ai-plan-result/v2` safe serialization, Rasterization Contract `1.1.0` with optional text `fillRgba`, and exact preview/export scopes/routes. Formal text/shape/inline-SVG source ownership, atomic owner-keyed download lease/tombstone lifecycle, non-overlapping group file ownership, owner-aware real-audio evidence, strict serial segments, and acceptance gates are authoritative in `docs/api/stage-7r-project-materialization-boundary.md`. This is a contract decision, does not claim implementation, and does not authorize `G0-1`.

## 27.8 S0 exit gate

`G8-S0` passed only after: the repository and recorded empty-remote evidence were verified; the authoritative requirement copy had the expected SHA-256; the package was whole, ignored, untracked, and unused at that gate; there were no tracked deletions; serial/message-authorization rules, toolchain decisions, and Groups 1-8 were recorded; the false P01-P40 table was absent; T08/P05 and the Chapter 27/34 decision were recorded; only S0-safe files were committed locally; and post-commit status was clean. The user's later pre-Stage-6 removal of the untracked package does not invalidate that historical evidence. The package must now remain absent and must not be restored, rebuilt, or referenced. A later remote connection reset does not overturn the recorded evidence. Stage 1 began when the user sent `1-S1`, with no additional Group 8 opening action.
