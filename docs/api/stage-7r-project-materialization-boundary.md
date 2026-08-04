# Stage 7R project materialization, preview, and export boundary

Status: **GROUP 1 FROZEN** on 2026-08-03 under `1-S7R-G0`, corrected by
`1-S7R-G0-CORRECTION` and the authority ownership allocation was corrected by
`1-S7R-G0-1-AUTHORITY-BOUNDARY-CORRECTION`; the G0-2 test scope and version
semantics were corrected by `1-S7R-G0-2-SCOPE-CORRECTION`. The catalog asset
authority boundary was corrected by
`1-S7R-G0-4-CATALOG-ASSET-AUTHORITY-CORRECTION`. This record closes the
formal-chain blockers found by
`G7-S7R-CLOSEOUT-AUDIT` and the four contract gaps reported by `G7-S7R-G0`.
It defines later implementation segments; it does not claim they are implemented
and does not authorize `G0-1`.

## 1. Unique architecture decision

The only V1 formal chain is:

```text
authenticated browser project
-> server session principal
-> browser-project/v1 validation
-> owner-aware asset materialization
-> trusted server-only MotionProject
-> formal text / shape / inline-SVG / uploaded-media raster sources
-> createProjectFrameProducer
-> preview or export
-> safe pixels, task view, or authorized download
```

Three objects are deliberately different:

1. `BrowserProjectEnvelopeV1` is JSON-safe, editable, and untrusted. Its asset
   definitions contain opaque IDs and fixed non-resolving placeholders only.
2. `TrustedProjectMaterializationV1` is server-only. It contains a Schema-valid
   `MotionProject`, owner-verified `VerifiedStoredMedia`, and runtime adapters.
3. `LayerRasterSource` values are request-scoped runtime values. They may contain
   glyph coverage, vector paths, or decoded pixels and are never serialized.

There is one Project model, one Project Schema, one asset registry, and one media
directory. A browser projection is a transport view of `MotionProject`, not a
second Project type or registry. The authority store remains the single
`TenantMediaStore` constructed by `createServerRuntime`.

## 2. Public contract and version decision

`MotionProject` and Project Schema stay at `1.2.0`. Core, Effect Definition Schema,
P0 catalog order, time contract, and `createProjectFrameProducer` signature do not
change. The reason is that the existing Schema already supports opaque asset IDs,
text properties, inline SVG path data, asset references, effects, and editing.
Security is provided by a narrower transport envelope and server reconstruction,
not by changing the persisted Project model.

Three public contract changes are approved and must be implemented before later
groups consume them:

- `@codemotion/schema` `0.5.0` supersedes `0.4.0` and is the sole owner of the closed
  `browser-project/v1`, `ai-plan-result/v2`, `preview-request/v1`,
  `export-request/v1`, and `export-task/v1` transport types, structural validation
  implementation, authority consumer type, and browser-project sanitizer without
  changing `PROJECT_SCHEMA_VERSION`; request-facing validators are exposed only
  through the statically pre-bound authority frozen below;
- AI task completed results become `ai-plan-result/v2`; raw `PlannedAnimation` and
  its `dsl` field remain a server-only planning DTO and are never serialized to
  browsers; and
- `@codemotion/renderer-api` `0.3.0` changes
  `RASTERIZATION_CONTRACT_VERSION` from `1.0.0` to `1.1.0` and adds optional
  `TextRasterSource.fillRgba?: readonly [number, number, number, number]`.

Every `fillRgba` component is finite and within `[0,1]`. Its alpha is multiplied by
the evaluated layer opacity. Omission preserves the legacy raster color behavior,
so existing `1.0.0` source builders remain source-compatible. Every formal V1 text
source supplies `fillRgba`; no new renderer adapter or renderer callback is added.

There is no compatibility response containing `result.dsl`. These endpoints were
not a released public contract, and retaining the unsafe response would leak
trusted asset fields. After cutover, old AI result and raw-project preview/export
bodies fail with `400 UNSUPPORTED_CONTRACT`. `PlannedAnimation` remains a
TypeScript export through V1, marked `@deprecated` and documented as a server-only
planning DTO, so serial package migration continues to typecheck; it is not a
browser/API contract. `@codemotion/ai-planner` `0.4.0` adds the public
`serializeAiPlanCompletedResultV2` server serializer; Group 5 must invoke it at the
service response boundary. No handler may return the input DTO.

Schema `0.5.0` is required because asset-reference classification is added to the
exported `BrowserProjectAuthorityV1` interface. All direct consumers pin exactly
`0.5.0`; there is no `0.4.0` compatibility shim or dual authority. Project Schema
remains `1.2.0`, transport discriminants remain unchanged, and migration consists
only of consuming the new frozen authority method.

## 3. Browser project contract

The closed transport shape is:

```ts
const BROWSER_PROJECT_CONTRACT = "browser-project/v1" as const;

interface BrowserProjectConstraintsV1 {
  readonly style: readonly string[];
  readonly brand: {
    readonly colors: readonly string[];
    readonly tone: readonly string[];
    readonly requiredText: readonly string[];
    readonly forbiddenContent: readonly string[];
    readonly logoAssetIds: readonly string[];
  };
}

interface BrowserProjectEnvelopeV1 {
  readonly contract: "browser-project/v1";
  readonly project: MotionProject;
  readonly constraints: BrowserProjectConstraintsV1;
}
```

These transport interfaces are exported only by `@codemotion/schema`; editor,
AI, and exporter import them and cannot redeclare structurally similar local
contracts.

### 3.1 Authoritative browser safety overlay

`browser-project/v1` is a strict security subset of `MotionProject` 1.2.0. The
open `JsonObject`/`JsonValue` Core types are compatibility types, not permission to
transport every Core field to a browser. This section is the single authoritative
allowlist; implementations must generate validators from it and must not maintain
local denylists. MotionProject Schema 1.2.0 and all Core types remain unchanged.

The only allowed layer types and their exact, closed `properties` objects are:

| Layer type | Allowed `properties` |
| --- | --- |
| `text` | `text`, `fontFamily`, `fontSize`, optional `color` |
| `shape` | `shapes`, optional `fill`; every `shapes` item is exactly `{path,fill?}` |
| `image` | `fit` |
| `video` | `loop`, `muted` |
| `svg` | optional `svg`, `fill`, `stroke`, `strokeWidth`, `fillRule` |
| `composition` | `compositionId`, optional `timeOffset`, `timeRemap`, `timeLoop` |

Text, color, font, image/video, composition, and inline-SVG values obey the limits
already frozen in this record. A shape `path` uses the same closed `M/m`, `L/l`,
`C/c`, `Z/z` path grammar as inline SVG, with at most 64 KiB UTF-8 and 4,096
commands per layer; coordinates are finite and within the project canvas limit
`[-8192,8192]`. Shape `fill` uses canonical `#RRGGBB` or `#RRGGBBAA`. No other
shape object key or geometry source is allowed. The formal 2D adapter owns shape
rasterization as well as text and inline SVG so a browser shape never carries
pixels or Canvas commands.

The common layer object is also closed to exactly `id`, `type`, `name`, `visible`,
`locked`, `solo`, `startTime`, `endTime`, `inPoint`, `outPoint`, optional
`parentId`, `zIndex`, `transform`, `opacity`, `blendMode`, `masks`, `effects`, the
type-required `source`, and `properties`. `source` is required only for `image` and
`video` and is exactly `{assetId}`; it is forbidden for every other allowed type.
Browser V1 freezes `masks` to `[]` because Core mask `path` can contain arbitrary
JSON coverage and no browser-safe mask transport is approved. `canvas`, `custom`,
`particle`, `model3d`, `camera`, `light`, `adjustment`, `null`, `data`, and `audio`
layers are forbidden. Audio is represented only by the closed root
`audioTracks` rows `{id,assetId,startTime,endTime,volume}`.

Every animatable position in transforms, opacity, audio volume, composition
`timeRemap`, effect mix, and effect parameters accepts only:

- `{mode:"constant",value}`; or
- `{mode:"keyframes",keyframes:[...]}`, where every keyframe is closed to `time`,
  `value`, optional `easing`, `interpolation`, `inTangent`, and `outTangent` and
  passes the existing time/type/interpolation rules.

`expression` and `binding` modes are forbidden throughout the envelope. A
sanitizer must reject the whole project if either appears; it must never delete
expression source while retaining an AST, fallback, binding path, or otherwise
ambiguous semantics. All numbers, including nested parameter and easing values,
must be finite.

Effects may appear only in a layer `effects` array; composition-level `effects`
must be absent or `[]`, and `effectGraph` must be absent. Every effect object is
closed to the existing `EffectInstance` keys. Its `effectId` must resolve through
the one `P0_EFFECTS_BY_ID` registry, `version` must equal that entry exactly, and
the unwrapped constant value plus every keyframe value must satisfy the matching
property in that entry's `parameterSchema`. A direct `JsonValue` parameter is a
constant. The validator forms the union of effect start/end and every parameter
keyframe time, evaluates all parameters with the frozen timeline evaluator at each
of those times, and validates each complete object against the whole
`parameterSchema`. Unknown/missing parameters follow that Schema and are never
accepted merely because Core uses `Record<string,...>`.
The browser cannot declare an effect implementation, renderer/runtime, Shader, or
catalog override.

Root objects are closed to the declared `MotionProject` keys. `background` is one
of the three existing closed variants; asset background contains only opaque
`assetId`. Composition objects are closed to `id`, `name`, `width`, `height`,
`duration`, optional `fps`, `layers`, optional closed `markers`, absent/empty
`effects`, and absent `effectGraph`. Browser `renderPresets` is fixed to `[]`;
export settings travel only in `export-request/v1`. Fonts and metadata remain the
fixed values below.

At every depth, before semantic validation, the validator rejects:

- keys `__proto__`, `prototype`, or `constructor`, and every key matching
  `^on[A-Za-z0-9_]*$` (for example `onClick` or `onclick`);
- keys whose ASCII identifier tokens (split at camel-case, `_`, `-`, or `.`
  boundaries) contain case-insensitive `script`, `shader`, `glsl`, `wgsl`,
  `plugin`, `pluginId`, `dependency`, `dependencies`, `import`, `module`, or
  `package` (therefore `shaderSource` and `plugin_data` also fail);
- any Shader/source text, Canvas command, plugin data, dependency/package/module
  declaration, event handler, executable callback, typed array, or binary pixels;
- any URL/URI/path-bearing field or URL-like value except the one fixed browser
  asset URI, declared opaque asset IDs, and the declared non-URL vector `path`
  strings above; and
- unknown properties, non-finite numbers, sparse arrays, or a budget violation.

The fixed budgets are: canonical UTF-8 envelope at most 5 MiB; object/array depth
at most 32; at most 100,000 total JSON nodes; generic strings at most 4,096 Unicode
scalar values except the declared 64 KiB vector path fields; at most 256 assets,
32 compositions, 1,024 total layers, 256 markers per composition, 32 audio tracks,
32 effects per layer, 128 parameters per effect, 128 keyframes per animatable, and
256 shape items per shape layer. Constraint string arrays are at most 64 entries;
easing/tangent arrays are at most 16 numbers; every otherwise-unlisted array is at
most 256 entries and every object at most 128 own keys. The stricter
text/raster/request limits elsewhere in this record still win.

Asset references in background, layer sources, audio tracks, logo constraints,
and catalog-declared asset parameters are opaque asset IDs only. A browser-supplied
URI, hash, metadata, proxy, owner, codec, MIME, or path never selects bytes or a
decoder and is discarded only when the trusted server serializer constructs the
fixed asset projection; if present in an inbound envelope it is rejected. The
required asset-row `type` is accepted only as the closed UI hint below and is
ignored for authority. The server always resolves the opaque ID through the shared
owner-aware store.

The audited P0 catalog has exactly one asset-semantic effect parameter: D02
`fx.draw.brushReveal.params.brushTexture`. H01 `mask`, H02 `matteLayer`, and H04
`map` are renderer-context references, not owner assets; every other string
parameter is text, color, vector path, charset, or numeric-map data. V1 freezes
D02 to `builtin://brush/round`. It rejects opaque browser asset IDs and
`asset://` values, creates no asset row, has no authoritative `StoredMedia` type,
and is converted by the Group 2 effects runtime to `CoverageBuffer` through the
built-in brush path. Preview and Export supply that coverage under the same
literal. Uploaded brushes require a future Group 1 contract covering accepted
media types, decode/raster budgets, and an owner-media-to-coverage adapter.

Logo, background, image/video source, audio track, and catalog parameter are
independent roles. The same asset ID may occupy compatible roles, but the
intersection of allowed authoritative media types must be non-empty. Background,
image source, and logo allow `image|svg`; video source allows `video`; audio track
allows `audio`. Duplicate logo rows, unknown IDs, an empty type intersection, or
a catalog parameter masquerading as another role fails closed before owner
resolution.

The sanitizer and validator are fail-closed. Their only public semantic failure is
`422 BROWSER_PROJECT_UNSAFE`; a size/node/depth/array/string budget failure is
`413 PROJECT_TOO_LARGE`. They may return a location and an allowlisted reason in
server-only test diagnostics, but the HTTP message is static and cannot echo the
rejected key/value. The trusted AI-result serializer may replace authoritative
asset rows and fixed version/metadata fields as explicitly specified below; every
other unknown or unsafe structure aborts serialization rather than being dropped.

All three objects are closed. The nested `project` must pass the unchanged
`MotionProject` 1.2.0 Schema and these additional browser rules:

- every `project.assets` item is exactly
  `{id, type, uri:"cmfx-browser-asset://opaque", metadata:{}}`;
- `id` is the opaque `assetId`; it is the only authoritative-looking value allowed
  in a browser asset row;
- `type` is only a UI hint and is limited to `image`, `video`, `audio`, or `svg`;
- `hash` is absent, `metadata` is empty, and `uri` is the same fixed non-resolving
  literal for every asset;
- the asset array contains exactly the unique uploaded asset IDs referenced by the
  background, layer sources, audio tracks, logo IDs, and catalog-defined asset
  parameters; unreferenced rows and duplicate IDs are rejected;
- `project.metadata` is exactly `{timeContractVersion:"1.1.0"}`;
- fonts may contain only the built-in `font.codemotion.unicode-bitmap-v1` entry and
  cannot contain an `assetId` in V1; and
- no typed arrays, pixels, closures, Maps, `VerifiedStoredMedia`, paths, proxy data,
  Provider fields, task internals, or additional transport properties are allowed.

`schemaVersion`, `engineVersion`, and `metadata.timeContractVersion` are fixed by
the sanitizer and rejected if changed. The browser may edit project name, canvas,
fps, duration, background, compositions, layer ordering/timing, the six allowed
layer/property families, transforms, opacity, catalog effects/parameters, opaque
asset selections, audio tracks, and user-owned style/brand constraints within the
fixed validation limits. It may not edit masks or embed render presets. The
service does not treat constraint values as identity or asset authority.

The trusted AI-result projection sanitizer must discard all server-side source
`AssetDefinition.uri`, `hash`, and `metadata`, plus project AI trace data including
Provider/model IDs, request/input fingerprints, usage, risks, storage data, and
content hashes. It creates the fixed asset rows above from opaque IDs only. The
inbound browser validator never performs this rewrite and instead rejects a
non-fixed row. Neither path serializes `storedPath`,
`rasterProxyPath`, `ResourceDescriptor`, Ark eligibility, importer probe output, or
raw pixel/coverage buffers.

### 3.2 P0 validator authority and package boundary

`@codemotion/schema` owns transport data contracts, the one structural validation
implementation, the frozen `BrowserProjectAuthorityV1` consumer interface, and the
non-root authority builder. Its package root does not export
`BrowserProjectValidationOptionsV1`, a validator/sanitizer accepting `effectsById`,
`catalog`, `registry`, parameter-Schema authority, a replaceable token/digest, or a
factory that can be called while handling a request.

`BrowserProjectAuthorityV1.classifyBrowserProjectAssetReferences(value)` first
performs the same closed validation and returns a deeply frozen ordered list.
Each row contains only opaque `assetId`, one closed role, one closed location, and
the allowed authoritative media-type set. It exposes no registry, Effect
Definition, parameter Schema, evaluator, options, token, or digest. Invalid input,
unknown references, duplicate role rows, or incompatible role types returns the
existing safe transport failure without partial results.

Reference proof is positional. Background, layer source, audio track, and logo
rows come only from their declared fields. Catalog rows may come only from the
real static P0 registry snapshot. Recursive string scanning is forbidden: a
normal parameter string equal to an asset ID is not a reference. URI-like effect
values are accepted only when the real parameter Schema declares that exact
literal, which freezes D02 to its builtin value without exposing the Schema.

The only builder export is the exact restricted subpath
`@codemotion/schema/internal/browser-project-authority`; wildcard internal exports
are forbidden. It is a module-composition hook, not a request API. It validates and
snapshots the supplied definitions, eagerly compiles their parameter Schemas, keeps
the snapshot and evaluator in a closure, freezes every authority method and the
authority object, and returns no readable or replaceable registry. Missing, null,
non-Map, incomplete, duplicate, mismatched, or malformed configuration fails with
one fixed sanitized configuration error and creates no degraded validator. Route
mounting cannot proceed without a successfully created authority.

G0-1 does not prove P0 catalog identity: Schema neither imports `effects-2d` nor
copies the 40 IDs, definitions, Schemas, or a directory digest. G0-2 Group 2 owns
the identity seam in `packages/effects-2d/src/browser-project-authority.ts`. That
module statically imports the same-package real `P0_EFFECTS_BY_ID`, invokes the
Schema internal builder exactly once during module initialization, and exports the
frozen `P0_BROWSER_PROJECT_AUTHORITY_V1`. Its public validation/sanitization methods
accept contract data only and never accept registry/options. G0-2 tests must prove
that a shape-correct 40-entry forged Map (including a removed real effect and an
added permissive forged effect) cannot enter that public authority path.

The sole dependency direction is `core -> schema -> effects-2d -> ai-planner/editor
services`; `schema -> effects-2d` is forbidden. G0-3 `browser-result.ts` and G0-4
`project-materialization.ts`, `ai-plan-service.ts`, `preview-task-service.ts`, and
`export-task-service.ts` consume only `P0_BROWSER_PROJECT_AUTHORITY_V1`. They cannot
import the internal builder or accept a registry. G0-3/G0-4 remain blocked until
the G0-2 authority adapter has passed and been integrated.

No further Group 2 product correction is required for this V1 decision. The real
D02 Schema default and existing Group 2 runtime already provide the fixed builtin
literal and coverage conversion; Schema `0.5.0` applies the browser-only narrowing
inside the closed authority. Group 2 must not broaden D02 to owner uploads or add
catalog metadata under G0-4. Future upload support returns to Group 1 first.

## 4. AI completed result

`AiPlanTaskView.result`, when status is `completed`, is exactly the following
closed structure (every nested object rejects additional properties):

```ts
interface AiPlanCompletedResultV2 {
  readonly contract: "ai-plan-result/v2";
  readonly storyboard: {
    readonly intent: string;
    readonly duration: number;
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly style: readonly string[];
    readonly brand: BrowserProjectConstraintsV1["brand"];
    readonly requirements: readonly string[];
    readonly constraints: readonly string[];
    readonly shots: readonly BrowserSafeStoryboardShotV1[];
  };
  readonly editableProject: BrowserProjectEnvelopeV1;
  readonly issues: readonly {
    readonly code:
      | "SCHEMA_VALIDATION"
      | "TIME_CONTRACT"
      | "DURATION"
      | "REFERENCE"
      | "CYCLE"
      | "EFFECT"
      | "EFFECT_VERSION"
      | "PARAMETER"
      | "PERFORMANCE"
      | "SAFETY";
    readonly severity: "error" | "warning";
    readonly message: string;
  }[];
  readonly preview: {
    readonly width: 160;
    readonly height: 90;
    readonly quality: "draft";
    readonly frameCount: number;
    readonly timeContractVersion: "1.1.0";
  };
}

type BrowserSafeStoryboardLayerV1 =
  | {
      readonly id: string;
      readonly description: string;
      readonly type: "text";
      readonly text: string;
    }
  | {
      readonly id: string;
      readonly description: string;
      readonly type: "svg";
    }
  | {
      readonly id: string;
      readonly description: string;
      readonly type: "image" | "video";
      readonly localAssetId: string;
    };

interface BrowserSafeStoryboardEffectV1 {
  readonly sourceId: string;
  readonly effectId: string;
  readonly effectVersion: string;
  readonly targetLayerId: string;
  readonly params: Readonly<Record<string, JsonValue>>;
}

interface BrowserSafeStoryboardShotV1 {
  readonly id: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly description: string;
  readonly layers: readonly BrowserSafeStoryboardLayerV1[];
  readonly effects: readonly BrowserSafeStoryboardEffectV1[];
}
```

Storyboard ranges are finite, ordered, and inside the project duration. IDs are
non-empty and unique in their declared scope; every `localAssetId` is an opaque ID
present in `editableProject.project.assets`; every effect uses its exact P0 ID and
version with catalog-validated parameters. No storyboard object can contain URI,
path, hash, metadata, Provider ID, remote file ID, or runtime data. Preview frame
hashes and AI trace/understanding internals are not returned. Progress events may
contain only phase, opaque local asset ID, and byte counts.

The browser adopts `editableProject` as the editor document only after the result
contract and nested browser project validate. It then uses the normal command
history/autosave path. Page refresh restores the same browser-safe envelope; no AI
task memory is needed. Preview/export never accept an AI `taskId` in place of the
current edited envelope.

## 5. Owner-aware materialization

The one authority interface is the existing store-compatible contract:

```ts
interface OwnerMediaResolverV1 {
  resolve(
    owner: Readonly<{ tenantId: string; userId: string }>,
    assetId: string,
    signal?: AbortSignal
  ): Promise<VerifiedStoredMedia>;
}
```

The production object is exactly the `TenantMediaStore` instance returned by
`createServerRuntime`. AI planning, project materialization, preview, and export
receive that same object by dependency injection. No handler constructs another
store or Map-backed authority. The authority/cache key is always
`(tenantId,userId,assetId)`; decoded-frame, raster, preview, task, and export caches
must additionally include the owner key and verified content identity.

Materialization returns this server-only value:

```ts
interface TrustedProjectMaterializationV1 {
  readonly project: MotionProject;
  readonly media: ReadonlyMap<string, VerifiedStoredMedia>;
  readonly constraints: BrowserProjectConstraintsV1;
}
```

It is never JSON serialized. Materialization performs this fixed order:

1. accept a principal already resolved from the server session and derive
   `OwnerContext`; owner fields in JSON/query/headers are forbidden;
2. parse the closed `browser-project/v1` envelope and validate the unchanged
   Project Schema, then enforce the complete Section 3.1 safety overlay;
3. reject duplicate IDs, missing/unknown references, composition cycles, layer
   parent cycles, unsupported layer/reference combinations, non-P0 effect IDs,
   stale effect versions, invalid parameters/keyframes, and unresolved
   catalog-defined layer/asset references;
4. call only `classifyBrowserProjectAssetReferences`, collect its opaque IDs, and
   retain every occurrence's role/type requirement without reading client
   URI/hash/type or metadata;
5. call the shared store `resolve(owner,assetId,signal)` once per unique ID before
   any consumer disk read or decode; an owner-key miss is safe `404 NOT_FOUND`;
6. validate every resolved authoritative type against every classified occurrence;
   image layers/background/logo accept `image` or imported `svg`, video layers
   accept `video`, audio tracks accept `audio`, D02 creates no owner resolve, and
   V1 has no uploaded-font path;
7. replace the entire asset array with each resolved
   `VerifiedStoredMedia.asset`, preserve only validated project structure/effect
   parameters and safe constraints, and validate the reconstructed Project again;
8. return the trusted project and owner-bound media Map only to the current request
   or task.

Client `type`, fixed URI, empty metadata, or any forged alternative is never used
to choose a path, decoder, proxy, hash, or format. A non-fixed URI, present hash,
non-empty asset metadata, path-like value, or browser asset type outside the safe
enum fails `422 BROWSER_PROJECT_UNSAFE`; it is never normalized into
authority.

V1 exposes no media-delete route. A stored asset cannot be deleted while this
contract is active, removing the resolve/delete race. Any future delete feature is
BLOCKED until Group 1 freezes owner-scoped leases/tombstones. Request abort, task
cancel, connection close, and runtime close propagate one `AbortSignal` through
resolve, verification, decode, formal raster resolution, frame rendering, and
FFmpeg. No new disk or network operation may start after abort.

On runtime close, new preview/export work receives `503 SERVICE_CLOSING`, all
active controllers abort, FFmpeg/processes and response streams close, request/task
temporary outputs are removed individually, and close awaits settlement. On
restart, the rehydrated shared `TenantMediaStore` serves resubmitted browser-safe
projects without AI task memory.

## 6. Preview API

The route is fixed:

| Method and route | Scope | Contract |
| --- | --- | --- |
| `POST /api/editor-preview` | `project:preview` | request-scoped one-frame preview |

The closed JSON body is:

```ts
interface EditorPreviewRequestV1 {
  readonly contract: "preview-request/v1";
  readonly editableProject: BrowserProjectEnvelopeV1;
  readonly frame: {
    readonly time: number;
    readonly width: number;
    readonly height: number;
    readonly quality: "draft" | "preview" | "final";
  };
}
```

The complete body is at most 5 MiB. Width/height remain positive, at most 960 each,
and at most 921,600 pixels. Time is finite and clamped to the last valid frame only
after project validation. Success is `200 application/octet-stream` containing
exactly top-to-bottom RGBA8 `width*height*4` bytes. Existing safe headers remain:
`X-CMFX-Width`, `X-CMFX-Height`, `X-CMFX-Time`, `X-CMFX-Quality`,
`X-CMFX-Time-Contract: 1.1.0`, and `X-CMFX-Renderer`.

The service session-authenticates, checks exact `project:preview`, and validates
Origin plus session CSRF before Content-Length, body reading, materialization,
disk, decode, or renderer access. Client disconnect aborts the one operation; no
preview task persists.

## 7. Export API and lifecycle

The routes and scopes are fixed:

| Method and route | Scope | Success |
| --- | --- | --- |
| `GET /api/editor-exports` | `export:read` | `200 {tasks: ExportTaskViewV1[]}` |
| `POST /api/editor-exports` | `export:create` | `202 {task: ExportTaskViewV1}` |
| `GET /api/editor-exports/:taskId` | `export:read` | `200 {task: ExportTaskViewV1}` |
| `POST /api/editor-exports/:taskId/cancel` | `export:create` | `200 {task: ExportTaskViewV1}` |
| `POST /api/editor-exports/:taskId/retry` | `export:create` | `202 {task: ExportTaskViewV1}` with a new task ID |
| `GET /api/editor-exports/:taskId/download` | `export:read` | authorized attachment stream |

Create accepts only:

```ts
interface ExportCreateRequestV1 {
  readonly contract: "export-request/v1";
  readonly editableProject: BrowserProjectEnvelopeV1;
  readonly settings: ExportSettingsV1;
}

interface ExportSettingsV1 {
  readonly format: "png-sequence" | "gif" | "webm" | "mp4";
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly duration: number;
  readonly alpha: boolean;
  readonly audio: boolean;
}

interface ExportTaskFailureV1 {
  readonly stage: "render" | "inspect" | "encode";
  readonly frame: number;
  readonly time: number;
  readonly recoverFromFrame: number;
  readonly code:
    | "FRAME_RENDER_FAILED"
    | "FRAME_INSPECTION_FAILED"
    | "OUTPUT_ENCODING_FAILED";
  readonly message: string;
}

interface ExportTaskViewV1 {
  readonly contract: "export-task/v1";
  readonly id: string;
  readonly projectName: string;
  readonly format: ExportSettingsV1["format"];
  readonly status:
    | "queued"
    | "running"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled";
  readonly progress: number;
  readonly completedFrames: number;
  readonly frameCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly settings: ExportSettingsV1;
  readonly video: {
    readonly codec: string;
    readonly audioCodec?: string;
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly duration: number;
  };
  readonly estimatedBytes: number;
  readonly outputBytes?: number;
  readonly downloadName?: string;
  readonly expiresAt?: string;
  readonly failure?: ExportTaskFailureV1;
}
```

Every object above is closed. Width and height are integers in `[2,8192]`, their
product is at most `33,554,432`, fps is an integer in `[1,120]`, and duration is
finite, positive, and no greater than project duration. MP4 forbids alpha; GIF and
PNG sequence forbid audio; enabled audio requires exactly one valid project audio
track covering the duration. Values outside these rules fail with
`422 PROJECT_VALIDATION_FAILED` before task creation.

`video.codec` is exactly `png`, `gif`, `libvpx-vp9`, or `libx264` as selected by
format; `video.audioCodec` is absent unless audio is enabled and is then `libopus`
for WebM or `aac` for MP4. The three failure messages are respectively the static
strings `Frame rendering failed.`, `Rendered frame validation failed.`, and
`Output encoding failed.`; raw exception text is never appended. Optional task
fields are also closed: only `completed` has `outputBytes`, `downloadName`, and
`expiresAt`; only `failed` has `failure` and `expiresAt`; `cancelled` has only
`expiresAt`; non-terminal statuses have none of those fields.

The complete body is at most 5 MiB. Retry has no body and re-materializes the
persisted browser-safe envelope under the current owner before creating a new task.
The task authority key is `(tenantId,userId,taskId)`. List/get/cancel/retry/download
use that key; cross-owner and unknown IDs both return `404 NOT_FOUND` before output
stat/read. `failure.code` is an allowlisted stable public code and
`failure.message` is a static sanitized message. Task views contain no logs,
machine/Node/FFmpeg version, project JSON, owner, path, hash, token, Provider
detail, raw FFmpeg command, probe data, or stderr.

Create/cancel/retry require exact Origin and session CSRF after authentication and
scope, but before body, task mutation, disk, decode, render, or FFmpeg. Read-only
GETs require the session and exact scope. Download additionally requires
`Sec-Fetch-Site: same-origin` and an exact same-origin Referer; the browser client
downloads through authenticated fetch/blob rather than a cross-site navigation.

Cancel is idempotent for `queued`, `running`, `cancelling`, and `cancelled` tasks.
It transitions active work to `cancelling`, aborts the single task controller, then
settles as `cancelled`. Cancelling a `completed` or `failed` task returns
`409 TASK_STATE_CONFLICT`. Retry is permitted only from `failed` or `cancelled` and
always creates a new task; it never reuses trusted materialization or stale media.

Export manifests and browser-safe envelopes are persisted under the server export
root, not the media root. This is task persistence, not a second media/Project
registry. Output directories use server-generated task IDs only. On restart,
`queued`, `running`, and `cancelling` tasks become `cancelled` and partial output is
removed individually; completed tasks and validated manifests are rehydrated.

### 7.1 Atomic download lease and tombstone protocol

The persistent task record has a deletion phase of `live`,
`tombstoned-cleanup-pending`, or `tombstoned-clean`. A browser never receives that
field or an `expired` status. A download-lease record is keyed under the complete
authority key `(tenantId,userId,taskId)` and contains a random lease ID, runtime
instance ID, and acquisition time. While that instance is live, its process
registry associates the lease ID with the response-stream abort controller. A
process-local counter, controller, or file handle without the persisted
owner-keyed lease record is insufficient.

After session and exact `export:read` authorization, download uses this sole order:

1. in one persistent transaction/critical section on
   `(tenantId,userId,taskId)`, look up the owner-keyed task, verify the owner,
   require `completed`, compare `now < expiresAt`, require deletion phase `live`,
   and persist/increment one active lease; if `now >= expiresAt`, the same operation
   first persists the tombstone and returns `404 NOT_FOUND` without a lease;
2. using only the server-persisted manifest, open the one canonical output with
   no-follow/path-containment and expected-file checks while the lease is held;
3. only after the handle is open create the HTTP response stream and attach the
   lease abort controller; and
4. release/decrement that exact lease in `finally` after normal completion, open
   failure, client disconnect, request abort, stream error, or runtime close.

Owner check, completed-state check, expiry/tombstone check, and lease increment are
therefore atomic. Cleanup cannot interleave between lease acquisition and file
open. An open failure never creates a response and still releases the lease. List
omits every tombstoned record immediately; owner-keyed get and download return the
same `404 NOT_FOUND`. Cross-owner and unknown keys also return `404`, so no response
reveals that a task or expired output once existed.

At expiry or any administrative/task deletion start, the service first commits
`tombstoned-cleanup-pending`; no subsequent lease can be acquired. Leases already
acquired may finish for at most 30 seconds from tombstone creation. At that fixed
deadline the runtime aborts their registered controllers, waits at most another
five seconds for `finally` release, closes remaining handles, and proceeds or
records a retryable cleanup failure. New leases cannot starve cleanup indefinitely.
Runtime close applies the same abort/release path with its existing close deadline.

Cleanup waits for the persisted active lease count to reach zero (or completes the
bounded abort above), then removes each explicit manifest output file in its own
operation. It never uses recursive/batch deletion or a glob. An empty task
directory may be removed only after its expected entries have each been handled.
Failure leaves `tombstoned-cleanup-pending`, the remaining explicit filenames, and
the sanitized failure class persisted; retries occur after 1, 5, and 30 minutes
and then hourly until successful. Each retry revalidates containment and processes
one file at a time.

The task record, browser-safe envelope, manifest of pending files, deletion phase,
tombstone time, and active lease records are atomically persisted and rehydrated.
On restart, tombstones are never changed back to `live`. Leases bearing a prior
runtime instance ID have no surviving response stream; startup transactionally
marks them stale, clears only those lease records, and resumes cleanup. A crash
between tombstone and cleanup or between individual file removals is thus
idempotently recoverable.

Retention is exact: `completed` becomes tombstoned 24 hours after completion;
`failed` and `cancelled` safe views become tombstoned 24 hours after their terminal
transition. Their non-downloadable partial outputs are individually cleaned at
terminal settlement through the persisted pending-file manifest while the safe
task view remains `live`; a cleanup failure does not expose or make those files
downloadable. Restart-converted active tasks become `cancelled` at restart time and
use that deadline. The internal expired state is the persisted task tombstone and
is browser-visible only as absence/`404`.
After all output and manifest files are gone, the record becomes
`tombstoned-clean`; that minimal tombstone is retained for seven more days and is
then individually deleted. Task IDs are never reused. Until cleanup succeeds the
pending record remains persisted beyond seven days and is never browser-visible.

A live download response is `Cache-Control: private, no-store`,
`X-Content-Type-Options: nosniff`, and a safe `Content-Disposition`; range requests
are not supported in V1. Its media type is exactly `application/zip` for PNG
sequence, `image/gif` for GIF, `video/webm` for WebM, or `video/mp4` for MP4.

## 8. Scopes and safe errors

The authenticated principal scope union becomes exactly:

```ts
type ApplicationScope =
  | "ai:plan"
  | "assets:read"
  | "assets:write"
  | "project:preview"
  | "export:create"
  | "export:read";
```

`ApplicationScope`, the ordered frozen `APPLICATION_SCOPES` six-value constant,
and its exact runtime validator are one public transport/auth contract exported by
`@codemotion/schema`. Server authentication and every browser client import them;
no package or file may retain a local three-scope or structurally copied union.

Route scopes imply only the asset reads required by that operation; callers do not
also need `assets:read`. Scope comparison remains exact and case-sensitive.

Every JSON failure uses the F0 safe error envelope. Status/code mapping is fixed:

| Status | Codes |
| --- | --- |
| `400` | `MALFORMED_REQUEST`, `UNSUPPORTED_CONTRACT` |
| `401` | `UNAUTHENTICATED` |
| `403` | `FORBIDDEN`, `REQUEST_ORIGIN_REJECTED` |
| `404` | `NOT_FOUND` for asset, task, or download owner-key miss |
| `409` | `TASK_STATE_CONFLICT`, `ASSET_CHANGED_DURING_MATERIALIZATION` |
| `413` | `PROJECT_TOO_LARGE`, `RASTER_BUDGET_EXCEEDED` |
| `422` | `PROJECT_VALIDATION_FAILED`, `BROWSER_PROJECT_UNSAFE`, `ASSET_REFERENCE_INVALID`, `EFFECT_VALIDATION_FAILED`, `FONT_UNAVAILABLE`, `INLINE_SVG_INVALID`, `MEDIA_VALIDATION_FAILED` |
| `429` | `RENDER_RATE_LIMITED` |
| `500` | `PREVIEW_RENDER_FAILED`, `EXPORT_FAILED` |
| `503` | `SERVICE_CLOSING`, `MEDIA_STORAGE_UNAVAILABLE`, `RENDERER_UNAVAILABLE` |

Messages, task logs, and headers are sanitized and cannot contain owner values,
cookies, auth/session tokens, paths, asset/content hashes, Provider IDs, proxy
paths, FFmpeg arguments, probe output, or raw exceptions.

## 9. Formal text, shape, and inline-SVG raster adapter

V1 uses the existing
`createProjectFrameProducer(project,media,{resolveRasterSource})` extension. No new
renderer callback or exporter-to-AI dependency is approved.

Group 2 owns one formal implementation in `@codemotion/effects-2d`:

```ts
const FORMAL_2D_RASTER_ADAPTER_VERSION = "1.0.0" as const;

interface Formal2dRasterRequestV1 {
  readonly layer: LayerDefinition;
  readonly compositionWidth: number;
  readonly compositionHeight: number;
  readonly renderWidth: number;
  readonly renderHeight: number;
  readonly projectSeed: number;
  readonly projectTime: number;
  readonly layerTime: number;
  readonly signal?: AbortSignal;
}

function resolveFormal2dRasterSourceV1(
  request: Formal2dRasterRequestV1
): TextRasterSource | VectorRasterSource | undefined;
```

It returns a source only for text, the closed Section 3.1 shape grammar, and
inline-SVG layers. Image/video, including uploaded SVG represented as an image
layer, return `undefined` and follow the owner-verified media decode path. Shape
paths produce a `VectorRasterSource` under the same command/count/byte/color
validation and abort rules; Canvas commands or browser pixels are never accepted.

Formal text rules are fixed:

- `properties.text`, `fontFamily`, and `fontSize` are authoritative project values;
- V1 supports exactly `Codemotion Planner Unicode Bitmap`; the project font row is
  `font.codemotion.unicode-bitmap-v1`; any other family/asset is
  `422 FONT_UNAVAILABLE` rather than a host-font fallback;
- glyph coverage is derived deterministically from NFC Unicode grapheme clusters,
  the built-in algorithm version, font size, composition dimensions, requested
  render dimensions, and project seed;
- `properties.color`, when present, is canonical `#RRGGBB` or `#RRGGBBAA`; absent
  color is `#FFFFFFFF`; it becomes `fillRgba`;
- evaluated layer opacity, time, masks, and transform remain the existing
  `createProjectFrameProducer` responsibility and multiply the source alpha;
- text is at most 4,096 Unicode scalar values, font size is finite in `[1,8192]`,
  and total glyph coverage is at most 16 MiB per layer/frame; and
- missing/unsupported glyph, invalid color/font/size, budget overrun, or abort fails
  closed. No OS font lookup, browser DOM, canvas, AI Provider, or UI process is used.

Formal inline-SVG rules are fixed:

- `properties.svg` is not arbitrary XML. V1 defines it as sanitized SVG path data
  using only `M/m`, `L/l`, `C/c`, and `Z/z`, commas, whitespace, and finite numbers;
- XML tags/entities, URLs, scripts, style blocks, external resources, event
  handlers, animation, nested SVG, and other path commands are rejected;
- UTF-8 input is at most 64 KiB, at most 4,096 parsed commands, every coordinate has
  absolute value at most 16, and viewport is exactly `{x:0,y:0,width:1,height:1}`;
- optional `properties.fill`, `stroke`, `strokeWidth`, and `fillRule` are validated;
  defaults are `fill="#FFFFFFFF"`, no stroke, width zero, and `nonzero`;
- paths are parsed once per cache key and rasterized at each requested render size;
  a 160x90 source is never scaled into formal preview/export; and
- malformed/unsafe/budget-exceeding input is `422 INLINE_SVG_INVALID` or `413
  RASTER_BUDGET_EXCEEDED`; abort stops parsing/raster work.

Uploaded SVG remains a `TenantMediaStore` asset and uses its verified
`rasterProxyPath`/media decoder. It never enters the inline path parser.

Preview and Export construct the same formal resolver and pass it to
`createProjectFrameProducer`. Group 6 removes its private text/vector source
builders and calls this Group 2 function for every 160x90 AI preview frame using
that frame's actual requested dimensions. `ai-planner/raster-sources.ts` may retain
only the unrelated coverage helper; a copied second text/shape/SVG implementation
is forbidden.

The preview/export task constructs `resolveRasterSource` as a closure over its one
task/request `AbortSignal` and passes that same signal both to
`resolveFormal2dRasterSourceV1` and to every `FrameProducer` call. This uses the
existing callback shape while ensuring resolve, verify, decode, rasterization,
render, and FFmpeg observe the same cancellation source.

Given identical validated project, owner-verified assets, project/layer time,
dimensions, seed, adapter version, and tool versions, Preview, Export, and AI draft
produce deterministic source data. Preview and Export at the same dimensions and
frame must be pixel-identical before encoding.

## 10. Formal-chain validation

Materialization is structural and non-generative. It never restores deleted text,
forbidden content, effects, layers, or Provider output. It preserves validated
layer text, inline paths, transforms, timing, effect IDs/versions/parameters,
style, brand colors/tone, required text, forbidden content, and logo IDs.

Every required-text string must occur in at least one currently visible text layer.
Forbidden content is compared case-insensitively against project, composition, and
layer names plus visible text. Failure is `422 PROJECT_VALIDATION_FAILED` before
resolve/decode/render. System/provider safety rules remain mandatory independently
of the user-editable project constraints.

Unknown asset/effect/layer references, duplicate IDs, parent/composition cycles,
stale effect versions, invalid keyframe/time ranges, invalid P0 parameters, excess
heavy effects, or URI-like values in fields not declared by the P0 catalog fail
before disk or FFmpeg. Catalog-defined owner-asset references, if a later approved
catalog permits any, must be emitted by the static authority, name an asset row,
and resolve under the same owner. V1 D02 is builtin-only and never enters that set.

Neither Preview nor Export can use only an AI task ID. They always receive the
current `browser-project/v1` envelope, so manual edits are authoritative project
content while service-owned asset fields are rebuilt. Restart/page refresh works
from the browser autosave plus the persistent owner media index; no private AI Map,
closure, low-resolution source, or task-local `MotionProject` is required.

## 11. Strict ownership and serial implementation

Every segment follows: assigned group writes -> Group 7 independently verifies ->
Group 8 inspects status and complete staged diff, commits only that segment -> user
authorizes the next segment. No two groups write concurrently.

### Segment G0-1: Group 1 public transport/raster contracts

Allowed files only:

- `packages/schema/src/browser-project.ts` (new),
  `packages/schema/src/ai-plan-result.ts` (new),
  `packages/schema/src/editor-render-api.ts` (new), and
  `packages/schema/src/index.ts`, plus the correction-only new restricted
  `packages/schema/src/internal/browser-project-authority.ts`;
- matching focused tests under `packages/schema/test/` and
  `packages/schema/package.json`;
- `packages/renderer-api/src/raster.ts`,
  `packages/renderer-api/test/conformance.test.ts`,
  `packages/renderer-api/package.json`;
- exact dependency pins in `packages/ai-planner/package.json`,
  `packages/editor/package.json`, `packages/cache/package.json`,
  `packages/effects-2d/package.json`, `packages/effects-3d/package.json`,
  `packages/exporter/package.json`, and `packages/renderer-webgl/package.json`; and
- root `package-lock.json` only for these approved versions.

This segment originally implemented Schema `0.4.0`; the catalog authority
correction advances Schema to `0.5.0`. Renderer-api remains `0.3.0`. It implements browser
contract validation/sanitization, the six-value public scope contract, and optional
`fillRgba`. Positive tests must cover every allowed layer/property family,
constant/keyframe animatables, exact P0 effects, owner-opaque assets, and every
boundary budget. Negative tests must cover every forbidden layer, expression and
binding (including AST-only remnants), custom/plugin/Canvas/Shader/dependency/
module/package/event-handler structures, unknown URL/URI/path fields, prototype
pollution keys at every depth, stale/arbitrary effects, invalid parameters,
non-finite numbers, and each size/depth/count overrun with the fixed error code.
It cannot change the MotionProject Schema, Core types/version, renderer callback
shape, or P0 catalog.

G0-1 succeeds when the Schema root has no arbitrary-registry safety entry, the
restricted builder closes and freezes authority with fixed configuration failure,
transport and blank-ID validation pass, and the G0-2 identity owner/files are
frozen. Real P0 static pre-binding and the production public safety entry become
established only by G0-2 PASS; G0-1 must not claim that identity proof.

### Segment G0-2: Group 2 formal raster implementation

Waits for the G0-1 integration commit. Allowed files only:

- `packages/effects-2d/src/project-raster-sources.ts` (new),
  `packages/effects-2d/src/browser-project-authority.ts` (new),
  `packages/effects-2d/src/inputs.ts`, `packages/effects-2d/src/index.ts`,
  `packages/effects-2d/test/project-raster-sources.test.ts`,
  `packages/effects-2d/test/browser-project-authority.test.ts`,
  `packages/effects-2d/test/effects-2d.test.ts`, README/CHANGELOG;
- `packages/effects-2d/package.json` for version `1.2.0` and the exact
  `@codemotion/schema` `0.5.0` dependency;
- exact `@codemotion/effects-2d` pins in `packages/ai-planner/package.json`,
  `packages/editor/package.json`, and `packages/exporter/package.json`; and
- root `package-lock.json` only for that approved version and exact Schema
  dependency.

Group 2 cannot modify exporter, AI pipeline, Project Schema, renderer API, or UI.
Its focused tests must prove the closed shape grammar renders through the same
formal vector path at requested dimensions and rejects commands, fields, numbers,
and budgets outside Section 3.1. Its authority module statically imports the real
same-package `P0_EFFECTS_BY_ID`, calls the restricted builder once at module
initialization, and exclusively exports frozen `P0_BROWSER_PROJECT_AUTHORITY_V1`.
The authority test owns real identity, forged/reordered/cloned/missing/replaced
catalog resistance, exact versions/Schemas, and proof that no request can select
or replace authority.

The three version domains are independent and frozen as follows:

1. the npm package version becomes `@codemotion/effects-2d` `1.2.0`, representing
   the P0 browser-project authority adapter, formal text and inline-SVG raster
   sources, and integration with Schema `0.5.0` and Renderer API `0.3.0`;
2. every existing P0 2D Effect Definition keeps its already-frozen definition
   version, currently `1.1.0`; the package bump does not migrate definitions; and
3. existing Effect presets remain `1.1.0`. A preset version changes only when its
   data contract actually migrates under separate Group 1 approval, and G0-2 has
   no such migration.

Package, Effect Definition, and preset versions must not be asserted equal.
Group 2 may modify `packages/effects-2d/test/effects-2d.test.ts` only for the
minimum G0-2 package-version migration and new authority/raster regression
assertions. It cannot delete, weaken, dynamically skip, or broadly rewrite the
existing 40-effect, Golden Frame, determinism, visual, or historical acceptance
tests; change visual algorithms or P0 order/count; or regenerate Golden Frames in
bulk.

G0-2 verification must:

1. assert package JSON version `1.2.0`;
2. retain explicit assertions that existing Effect Definitions and presets remain
   `1.1.0`;
3. retain exactly 40 P0 effects;
4. retain T08 at ordered position 16;
5. keep all existing Golden Frame and determinism tests passing;
6. prove the authority/raster additions do not change existing 40-effect output;
7. limit lockfile and consumer changes to exact package dependency updates without
   effect-instance migration; and
8. perform no MotionProject, EffectInstance, or preset migration.

### Segment G0-3: Group 6 AI result and adapter reuse

Waits for the G0-2 integration commit. Allowed files only:

- `packages/ai-planner/src/pipeline.ts`, `raster-sources.ts`, `index.ts`, and a new
  `browser-result.ts`;
- `packages/ai-planner/test/ai-planner.test.ts` and focused new result/raster tests;
- `packages/ai-planner/package.json` for version `0.4.0` and the already-approved
  dependency pins, `packages/editor/package.json` for the exact `0.4.0` pin, and
  root `package-lock.json` only for those changes.

Group 6 must implement the safe v2 result serializer, remove private text/shape/SVG
builders, reuse the formal adapter for draft preview, and retain provider safety.
`browser-result.ts` consumes only `P0_BROWSER_PROJECT_AUTHORITY_V1`; it cannot
import the Schema internal builder or accept registry/options.
The Group 5 segment wires that serializer into the HTTP task view; until then the
raw DTO remains server-only. Group 6 cannot modify editor source, authentication,
upload, exporter, or public contracts.

### Segment G0-4: Group 5 materialization and server services

Waits for the G0-3 integration commit. Allowed files only:

- `packages/editor/src/project-materialization.ts` (new),
  `preview-task-service.ts`, `export-task-service.ts`, `ai-plan-service.ts`,
  `auth-session-service.ts`, `server-runtime.ts`, and `index.ts`;
- `packages/exporter/src/media.ts`, `task-store.ts`, and `index.ts` only for the
  shared owner resolver/task persistence and close/cancel guarantees;
- corresponding focused editor/exporter tests, including new materialization,
  route, persistence, cancellation, audio, download-lease/tombstone, and leak
  tests; and
- no package/lock change unless Group 1 separately approves a demonstrated need.

Group 5 replaces global `mediaRoot` resolution with the injected shared store,
mounts AI/preview/export in one runtime, and implements scopes/routes/errors above.
Its materialization, AI, preview, and export services consume only
`P0_BROWSER_PROJECT_AUTHORITY_V1`, and route mounting fails before serving traffic
if that module authority did not initialize. They cannot import the Schema internal
builder or accept registry/options.
Materialization must consume `classifyBrowserProjectAssetReferences` occurrence by
occurrence for resolve/type checks; residual-asset-as-logo classification, local
field-name tables, recursive parameter scanning, and direct P0 registry imports are
forbidden.
Its tests own the real owner-aware audio resolution/decode/export/mux chain and the
atomic download lifecycle, including concurrency, expiry, disconnect, abort,
runtime close, crash rehydration, bounded drain, and individual cleanup retry. It
does not implement UI or copy the formal raster adapter.

### Segment G0-5: Group 4 browser and composition wiring

Waits for the G0-4 integration commit. Allowed files only:

- `packages/editor/src/ai-plan-client.ts`, `media-asset-client.ts`, `AiPlanner.tsx`,
  `store.ts`, `App.tsx`;
- `packages/editor/src/preview-renderer.ts`, `export-center.ts`, `RenderCenter.tsx`;
- `packages/editor/vite.config.ts` to mount exactly one shared server runtime;
- necessary `styles.css`, browser/client tests, and visual smoke files.

Group 4 adopts `editableProject`, preserves the safe envelope through autosave and
manual edits, sends the versioned preview/export bodies with same-origin
credentials/CSRF, and performs authenticated blob download. It cannot construct a
principal/store, verify tokens, materialize trusted assets, or rasterize
text/shape/SVG. `media-asset-client.ts` recognizes all and only `ai:plan`,
`assets:read`, `assets:write`, `project:preview`, `export:create`, and `export:read`
by importing the public `ApplicationScope`/validator; it must remove the drifting
local three-scope declaration. Group 4 may consume and validate session scopes and
send opaque audio asset IDs, but cannot construct a principal, synthesize/forge a
scope, or change server authorization semantics. G0-4 does not own this file, so
this addition creates no G0-4/G0-5 overlap. Group 4 browser tests own scope-gated
audio selection and prove that URI/hash/metadata/path/codec edits are never sent as
audio authority.

After G0-5, Group 7 runs the complete real-chain closeout. Group 8 may integrate
that verification segment only after every earlier segment has its own Group 7 PASS
and Group 8 commit. Any need outside an allowed list returns to Group 1; another
group cannot alter these public contracts.

## 12. Frozen acceptance matrix

Later verification must prove at least:

1. two owners with the same opaque asset ID preview/export their own bytes and do
   not share decoded, preview, export, or task cache entries;
2. cross-owner asset/task/download requests return `404` before file stat/read,
   decode, render, task mutation, or FFmpeg;
3. forged browser URI/hash/path/type/metadata cannot affect materialization;
4. AI completed responses contain no internal URI, content hash, importer metadata,
   raster proxy, server path, owner, token, or Provider detail;
5. restart-rehydrated owner media supports resubmitted preview/export and completed
   download lifecycle rules;
6. AI text-only projects formally preview and export PNG/MP4;
7. AI inline-SVG projects formally preview and export;
8. uploaded image, video, and SVG projects formally preview/export through owner
   media resolution and the SVG proxy path;
9. text/shape/SVG are generated at requested dimensions and never upscale 160x90
   data;
10. Preview and Export have pixel-identical key frames at equal frame/dimensions;
11. AI result adoption, manual edit, autosave/reload, preview, and export succeed;
12. required text remains visible in final decoded frames;
13. invalid/forbidden content fails and materialization never restores it;
14. request abort, cancel, runtime close, and restart stop resolver, verification,
    decode, raster work, render, and FFmpeg;
15. partial outputs, expired downloads, task records, and active download races obey
    the fixed lifecycle and individual cleanup rules;
16. all safe errors/logs/responses are free of path, hash, token, owner, raw probe,
    FFmpeg, and Provider details; and
17. the real authenticated chain upload -> AI -> edit -> preview -> export passes
    FFprobe, decoded-frame diversity, and output frame-difference evidence;
18. two owners using the same user-visible audio `assetId` each resolve and mux
    only their own authoritative audio bytes through the shared
    `TenantMediaStore` and `OwnerMediaResolverV1`;
19. a cross-owner audio reference returns `404 NOT_FOUND` before output/media stat,
    read, decode, task mutation, or FFmpeg process start;
20. forged browser audio URI, hash, metadata, proxy, path, MIME, codec, or owner
    values cannot influence materialization; only the opaque ID is accepted and
    authoritative format/codec comes from the owner store;
21. a real browser upload of audio enters Preview and Export through that one
    shared store/resolver, never a global media root or private asset Map, and both
    consumers use the same owner-aware audio reference;
22. an audio-enabled MP4 really muxes AAC and every applicable audio-enabled WebM
    really muxes Opus; FFprobe proves the audio stream exists, codec is exact, and
    duration is within one output-frame interval plus 50 ms, and full decode of the
    output succeeds;
23. request abort, task cancel, client disconnect, runtime close, and restart
    terminate in-flight owner audio read, decode, and FFmpeg work and leave only
    the persisted retryable cleanup state allowed by Section 7.1;
24. audio logs, safe errors, and task responses contain no path, hash, owner,
    codec probe body, FFprobe text, FFmpeg command/stderr, or internal metadata;
25. G0-5 browser tests prove all six imported scopes gate the matching UI action,
    while G0-4 service/exporter tests prove items 18-24 on real uploaded audio;
26. parallel completed downloads, expiry racing a new download, disconnect,
    request abort, runtime close, tombstone during an active stream, crash/restart
    at every persisted phase, stale-lease recovery, bounded drain/abort, and each
    individual cleanup failure/retry obey the atomic Section 7.1 protocol;
27. the G0-1 positive/negative browser-overlay suite proves the exact allowlist,
    Animatable restriction, P0 effect/version/parameter validation, recursive
    executable/dependency/prototype rejection, fixed budgets, stable errors, and no
    second validator implementation;
28. the current editor's closed shape path formally previews and exports through
    the Group 2 adapter without Canvas commands, embedded pixels, or a second
    raster implementation; and
29. authority tests prove ordinary strings matching an asset ID do not create a
    reference, D02 accepts only `builtin://brush/round`, classification is deeply
    frozen and cannot be replaced by request data, and catalog/logo roles never
    collapse into a residual asset category.

The gate remains BLOCKED if any test substitutes an in-memory private asset Map,
raw `PlannedAnimation.dsl`, global media root, fixed 160x90 raster source, fake
preset/output, unverified browser asset fields, a local scope union, or a mocked
audio mux/probe result.
