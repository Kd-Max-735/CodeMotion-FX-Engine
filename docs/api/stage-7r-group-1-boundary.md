# Stage 7R Group 1 contract and boundary freeze

Status: **GROUP 1 FROZEN** on 2026-07-30. This record decides contracts only. It
does not claim that the Group 5 or Group 6 remediation listed below is implemented.

Authentication, browser media ingress, Cookie/CSRF rules, and server composition
ownership are further frozen by
`docs/api/stage-7r-group-1-auth-upload-boundary.md`. For those subjects, the newer
`1-S7R-F0` record as closed by `1-S7R-F0-CORRECTION` is authoritative.

The formal AI Project -> edit -> Preview -> Export chain, browser-safe project
projection, owner-aware materialization, and text/shape/inline-SVG raster ownership
are frozen by `docs/api/stage-7r-project-materialization-boundary.md`. The
`1-S7R-G0` record as corrected by `1-S7R-G0-CORRECTION` is authoritative for those
later subjects, including its strict browser safety overlay, atomic download
lease/tombstone protocol, six-scope ownership, and owner-aware audio evidence.

Authority: `1-S7R-A`, Chapter 27, and the requirement document sections 16.4, 17,
18, 19, 24.8, and 25.4.

## Public contract decision

**No public Schema/API change is required.**

The following frozen contracts remain unchanged:

| Contract | Version |
| --- | --- |
| Core/engine package | `0.3.0` |
| Project Schema | `1.2.0` |
| Effect Definition Schema | `1.0.0` |
| Renderer Adapter API | `1.1.0` |
| Time contract | `1.1.0` |
| `effects-2d` package | `1.1.0` |
| `effects-3d` package | `1.0.0` |

The existing `AssetDefinition`, `MotionProject`, `EffectDefinition`,
`EffectInstance`, and `RenderPreset.settings` shapes already carry every value that
may enter an editable project. Authentication, tenant ownership, provider traces,
Storyboard data, retrieval scores, and brand-planning rules are service data and
must not be added to `MotionProject` or treated as project-supplied authority.

This is a package-internal, server-only contract freeze named `ai-task/v1`. It is
not a browser API, Core contract, or new JSON Schema ID. Group 6 must validate it at
runtime before provider or planning work and may implement it with package-local
TypeScript and AJV validators.

## Current implementation findings

The audit found concrete remediation work; this contract freeze does not hide it:

- `packages/ai-planner/src/pipeline.ts` imports and uses
  `GROUP_2_P0_EFFECTS` for retrieval, selection, version/default lookup, and static
  validation, so T08 is currently unavailable to AI;
- `LocalResourceInput` carries a server storage directory but no authenticated
  principal or tenant-scoped resolver precedes its construction;
- the current planning options have width/height but no closed style/brand input
  contract;
- Stage 6 media ingress has no AVIF, SVG, or AAC entry; and
- `DOCUMENT_EXPORT_PRESETS` has four validated entries, not the required 11.

These are assigned follow-up implementation gaps, not reasons to change the frozen
public contracts.

## Complete P0 effect catalog

The sole AI catalog input is the aggregate package interface:

```ts
import {
  P0_EFFECTS,
  P0_EFFECTS_BY_ID,
  type P0CatalogEffectDefinition
} from "@codemotion/effects-2d";
```

`P0_EFFECTS` supplies all 40 entries in `docs/P0_EFFECT_CATALOG.md` order: 39 Group
2 entries plus Group 3 T08 `fx.text.textExtrude3D` at slot 16. Group 6 must not
import `GROUP_2_P0_EFFECTS` for retrieval, selection, parameter validation, static
DSL validation, or effect-version lookup because that interface intentionally has
only 39 entries. It must not build a second catalog or import T08 separately.

The current S5R aggregate tuple digest over
`{slot,sourceId,effectId,version,owner}` is
`f291c95e02166d5fffdff9a0a7021465e2e18194679bb13827544081cc16a81b`.
The older Stage 5 digest records the pre-S5R versions and is historical evidence,
not the current AI lookup digest.

Group 6 may normalize each aggregate entry to this internal read-only view:

```ts
interface AiEffectCatalogEntry {
  readonly sourceId: string;
  readonly effectId: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly inputTypes: readonly string[];
  readonly parameterSchema: JsonSchema;
  readonly defaultPreset: JsonObject;
  readonly performanceClass: "light" | "medium" | "heavy" | "extreme";
  readonly supportsAlpha: boolean;
  readonly supportsMask: boolean;
}
```

Every selected ID must resolve through `P0_EFFECTS_BY_ID`. Parameters must start
from that same entry's `defaultPreset`, merge only validated overrides, pass that
entry's `parameterSchema`, and write that entry's exact `version` into the DSL.
Retrieval may rank all 40; compatibility rules may reject an entry for a particular
layer, input set, output target, or performance budget but may not make T08 absent.

## AI input boundary

Only an authenticated server controller may construct `ai-task/v1`:

```ts
type AiScope = "ai:plan";
type AiAssetPurpose =
  | "reference-image"
  | "reference-video"
  | "reference-audio"
  | "logo";

interface AiTaskPrincipal {
  readonly tenantId: string;
  readonly userId: string;
  readonly taskId: string;
  readonly scopes: readonly AiScope[];
}

interface AiAssetReference {
  readonly assetId: string;
  readonly purpose: AiAssetPurpose;
}

interface AiCanvasConstraint {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
}

interface AiBrandConstraint {
  readonly colors: readonly string[];       // #RRGGBB or #RRGGBBAA
  readonly tone: readonly string[];
  readonly requiredText: readonly string[];
  readonly forbiddenContent: readonly string[];
  readonly logoAssetIds: readonly string[]; // subset of purpose "logo"
}

interface AiPlanningInputV1 {
  readonly contract: "ai-task/v1";
  readonly prompt: string;
  readonly assets: readonly AiAssetReference[];
  readonly canvas: AiCanvasConstraint;
  readonly durationSeconds: number;
  readonly style: readonly string[];
  readonly brand: AiBrandConstraint;
}
```

The client supplies opaque asset IDs only. It cannot supply `AssetDefinition`,
`uri`, hash, local path, storage root, provider file ID, principal IDs, or model
credentials. The server resolves each reference under the authenticated principal,
checks purpose/type agreement, then calls the Stage 6
`verifyStoredMediaAsset` boundary. Only after both authorization and integrity
checks may it construct the existing trusted `LocalResourceInput`.

Canvas values are positive integers, each dimension is at most the exporter's
`MAX_EXPORT_DIMENSION` (`8192`), and the product is at most
`MAX_EXPORT_PIXELS` (`33,554,432`). Aspect ratio is derived from width/height; a UI
ratio preset is not model authority. FPS is finite in `[1, 60]`. Duration is finite
in `[0.5, 60]` seconds for Stage 7. Style and brand values are data constraints,
never appended as higher-priority system instructions. Logo IDs must resolve to
authorized image or sanitized SVG assets included in `assets`.

## Storyboard, selection, parameters, and DSL

The model response is untrusted. Group 6 must parse it to a versioned internal
envelope before project construction:

```ts
interface AiEffectSelectionV1 {
  readonly sourceId: string;
  readonly effectId: string;
  readonly effectVersion: string;
  readonly targetLayerId: string;
  readonly params: JsonObject;
}

interface AiStoryboardShotV1 {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly description: string;
  readonly layerIds: readonly string[];
  readonly effects: readonly AiEffectSelectionV1[];
}

interface AiStoryboardV1 {
  readonly intent: string;
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly style: readonly string[];
  readonly brand: AiBrandConstraint;
  readonly shots: readonly AiStoryboardShotV1[];
}

interface AiPlanningResultV1 {
  readonly contract: "ai-task/v1";
  readonly storyboard: AiStoryboardV1;
  readonly dsl: MotionProject;
  readonly issues: readonly StaticIssue[];
  readonly preview: LowResolutionPreview;
}
```

The Storyboard is planning evidence, not executable code. It may contain only
declared layers, authorized asset references, catalog effect selections, and JSON
parameters. It cannot contain scripts, dependency requests, URLs, file paths,
Shader source, provider IDs, or credentials.

Before returning a result, Group 6 must enforce all of the following:

1. every selected effect is the exact `P0_EFFECTS_BY_ID` entry and its source ID and
   version agree;
2. every parameter snapshot passes that entry's parameter Schema;
3. shot, layer, effect, asset, and audio references exist and time ranges are
   bounded;
4. no parent, composition, or effect-graph cycle exists;
5. the heavy-effect budget and input/output/layer compatibility checks pass;
6. the DSL passes frozen `MotionProject` Schema `1.2.0` and time contract `1.1.0`;
7. a real low-resolution preview renders from the resulting DSL.

Schema repair may repair the untrusted intermediate response into this closed
shape. It may not weaken a Schema, invent an effect, bypass authorization, or
silently drop an invalid requested constraint.

## User and tenant isolation

Authentication terminates before `@codemotion/ai-planner`. The controller derives
`AiTaskPrincipal` from verified server session/token middleware; no field copied
from request JSON is authentication evidence.

Authorization is fail-closed:

- `ai:plan` is required before queueing, asset lookup, file read, or provider call;
- asset lookup is keyed by `(tenantId, assetId)` and then checked for the current
  user or tenant grant;
- task/result/cache/redo keys include `(tenantId, userId, taskId)`;
- project metadata, asset IDs, hashes, and provider output cannot grant access;
- the trusted storage directory is selected by the server-side tenant resolver;
- rate, concurrency, and cost quotas are charged to tenant and user, not only to a
  process-global provider bucket;
- provider upload mappings and cleanup remain per invocation, and remote files are
  individually deleted in `finally`;
- logs and audits use non-reversible fingerprints and never contain raw tenant/user
  IDs, paths, credentials, provider file IDs, or provider bodies.

Required isolation tests use two tenants with the same user-facing asset ID and two
concurrent tasks referencing the same local asset. They must prove cross-tenant
denial before disk/network access, correct per-task provider mapping, independent
cleanup, tenant-scoped cache misses, and that one task cannot fetch another task's
Storyboard, DSL, preview, trace, redo state, or audit record.

## Media format gap decision

These decisions distinguish input support from export support:

| Item | Decision |
| --- | --- |
| AVIF input | Pre-Stage-7 gap in Stage 6 media ingress. Group 5 must add signature/MIME agreement, FFprobe/FFmpeg decode, limits, content-addressed storage, integrity recheck, preview, and AI round-trip tests before Group 6 may advertise it. |
| SVG input/logo | Pre-Stage-7 gap. Core already has `AssetDefinition.type = "svg"`, so no Schema change is needed. Group 5 must provide bounded parsing, active-content/external-reference rejection, sanitization, deterministic raster proxy, hash/integrity checks, and malicious-SVG tests. Group 6 receives only the verified asset/proxy, never raw unsanitized markup. |
| AAC input | Pre-Stage-7 gap in Stage 6 media ingress. It needs container/codec-aware MIME and decode tests; extension-only acceptance is forbidden. |
| AAC output | Already real in Stage 6 H.264 MP4 muxing and is not a gap. |
| SVG static/vector-preserving export | Not a Stage 7 input blocker and not delivered by Stage 6. It depends on a real SVG renderer, representability checks, raster fallback, and Stage 8-10 compatibility/security work; a filename-only exporter is not completion. |

Until Group 5 closes the three ingress gaps, Group 6 may accept only formats that
the real Stage 6 `importMedia` and `verifyStoredMediaAsset` path accepts. It must
reject, not transcode by filename or send unsupported bytes directly to Ark.

## Eleven export presets

The requirement names 11 built-ins. `DOCUMENT_EXPORT_PRESETS` currently contains
four runnable Stage 6 presets, not 11:

| Requirement preset | Exact remediation setting | State |
| --- | --- | --- |
| 1080p landscape MP4 | 1920x1080, 30 fps, H.264/AAC, no Alpha | Stage 6 delivered |
| 1080p portrait MP4 | 1080x1920, 30 fps, H.264/AAC, no Alpha | Stage 6 gap |
| 4K landscape | 3840x2160, 30 fps, H.264/AAC, no Alpha | Stage 9 segmented-render capability and Stage 10 stability/compatibility |
| transparent WebM | 1920x1080, 30 fps, VP9/Opus, Alpha | Stage 6 delivered |
| HD GIF | 1280x720, 30 fps, no audio | Stage 6 delivered |
| small GIF | 640x360, 15 fps, no audio | Stage 6 gap |
| PNG sequence | 1920x1080, 30 fps, RGBA | Stage 6 delivered |
| social portrait | 1080x1920, 30 fps, H.264/AAC, no Alpha | Stage 6 gap; distinct product ID from generic portrait |
| commerce product GIF | 800x800, 20 fps, no audio | Stage 6 gap |
| PPT GIF | 1280x720, 15 fps, no audio | Stage 6 gap |
| web background WebM | 1920x1080, 30 fps, VP9, no audio, no Alpha | Stage 6 gap |

The six non-4K gaps are configuration/acceptance work on the existing Stage 6
encoders and do not depend on Stage 8. The preset center UI and browser-fast export
may arrive in Stage 8, but they cannot substitute for these server presets. The 4K
row is deferred because the requirement places 4K segmented rendering in P2; adding
only a 3840x2160 name before segmented recovery and resource/performance evidence
would be a false preset.

A preset counts only after `validateExportPreset`, real fixed-frame export, FFprobe,
decoded-frame diversity, exact dimension/rate/codec checks, and its Alpha/audio
rules pass. The small GIF must also be smaller than the HD GIF for the same bounded
fixture. A registry row, label, or duplicate alias without these tests does not
count.

## Allowed follow-up scope

- Group 6 may change only the server-side AI package/tests needed to consume
  `P0_EFFECTS`, implement `ai-task/v1`, validate all 40 effects, and enforce the
  authenticated resolver boundary.
- Group 5 may change only media ingress and exporter preset implementation/tests for
  the gaps assigned above.
- Group 4 may bind UI controls to the server contract only after those package gates
  pass; it may not call the model or resolve storage in the browser.
- No later group may change Core, Project Schema, Effect Definition Schema, Renderer
  Adapter API, or the ordered P0 registry under this decision. Any such need returns
  to Group 1 with version, migration, compatibility, and contract-test evidence.
- Authentication and browser upload follow-up must also stay inside the exact file
  ownership and protocol frozen by
  `docs/api/stage-7r-group-1-auth-upload-boundary.md`.
  That authoritative protocol includes browser-bound pre-login and callback
  transactions, the fixed 15-entry MIME-to-temporary-suffix table, and
  non-configurably bounded streaming multipart parsing; follow-up groups have no
  discretion to replace or enlarge those boundaries.
- Formal project adoption, preview, and export must follow the versioned browser
  projection, shared owner resolver, raster adapter, routes/scopes, and serial file
  ownership in `docs/api/stage-7r-project-materialization-boundary.md`.
