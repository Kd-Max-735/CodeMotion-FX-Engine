# Current server single-tool architecture

Status: **CURRENT AUTHORITY** as of 2026-08-14.

This document is the authoritative architecture for the current CodeMotion FX Engine product direction. It supersedes every older card-selection, model effect-selection, retrieval/ranking, multi-effect planning, browser rendering, ReAct, Agent, and front-end editing flow where those records conflict. Historical requirement and stage records remain evidence and are not rewritten.

## Product boundary

1. The front end will eventually display tool names only. A user manually selects exactly one tool.
2. One request executes exactly one effect tool. There is no effect stack, tool composition, implicit selection, retrieval, ranking, recommendation, or model-selected fallback in this path.
3. The model reads only the selected tool's Chinese Markdown instruction and its closed parameter contract. It does not receive another tool's definition or a tool catalog.
4. The sole model provider remains the server-side Volcengine Ark model `doubao-seed-2-0-lite-260428`.
5. The model returns one native selected-tool call. Its arguments contain the selected effect parameters plus shared `output.durationSeconds` and `output.generationMode`; it cannot emit project structure, layers, resource identities, file paths, URLs, renderer choices, arbitrary frame rates, other export settings, or a second tool call.
6. Resources and runtime inputs are authenticated, owner-authorized, server-bound, and locked outside the model envelope.
7. Preview, rendering, and export are server operations. No browser or DOM renderer is part of the current architecture.
8. ReAct, Agent, multi-tool calls, multi-effect composition, and a front-end editor remain deferred until all 120 real effect functions are complete.

## Model wire contract

```json
{
  "type": "exact_selected_snake_case_tool_name",
  "data": {
    "effectParams": {
      "only": "fields declared by this tool's closed parameter Schema"
    },
    "output": {
      "durationSeconds": 5,
      "generationMode": "standard"
    }
  }
}
```

The envelope contains exactly `type` and `data`. `type` is a server-supplied `const` equal to the user's selected `toolName`. `data` is a server-composed closed object containing closed `effectParams` and the shared closed `output` object. `output` permits `durationSeconds` in the range 1–60 seconds at 0.1-second precision and `generationMode` as the exact enum `fast | standard | fine`. No aliases, case folding, fuzzy matching, effect IDs, batch IDs, or model-selected tool names are accepted.

Natural-language duration and generation-mode policies are shared rather than duplicated across 120 effect Markdown files. Omitted duration is 5 seconds; relative longer/shorter requests adjust an explicit or default baseline by 2 seconds; vague long-video and short-video requests use reviewed common presets. An explicit duration is the baseline before any explicit relative adjustment. Omitted mode is `standard`; generation-speed requests select `fast`, normal or standard requests select `standard`, and high-quality or smoother requests select `fine`. The server maps these modes to 15, 30, and 60 FPS respectively. The model cannot emit an arbitrary FPS. Codec, format, and all other export settings remain server-owned.

Every numeric value must be finite and satisfy its range and step constraints. Every enum must be an exact member. `null` is rejected unless the individual parameter Schema explicitly allows it and defines the same default behavior. Missing optional fields receive the server definition's matching default; required fields remain required. Raw parameters, defaulted parameters, and normalized parameters are all validated, and effect-specific validation runs both before and after normalization.

Resource-bearing parameter names and values are forbidden. This includes asset/resource/file IDs, image/video/audio identities, masks, LUTs, depth maps, fonts, models, textures, local or network paths, and URLs. A failure stops before `render`.

## Public package boundary

`@codemotion/effect-functions` is the versioned public workspace contract. Its required surface is:

- `EffectToolDefinition`
- `ServerEffectRenderContext`
- `AuthorizedEffectInputs`
- `EffectInputSlotDefinition`
- `EffectParameterEnvelope`
- `EffectRenderResult`
- `EffectBackendDefinition`
- `EffectPerformanceGrade`
- `EffectFallbackStrategy`

`EffectToolDefinition` contains `effectId`, `toolName`, `displayName`, `version`, `category`, `parameterSchema`, `defaults`, `presets`, `inputSlots`, `primaryBackend`, `fallbackStrategy`, `performanceGrade`, `normalizeParams`, `validateParams`, and `render`.

The two input channels are intentionally not assignable to one another:

| Channel | Producer | Contents | Model-visible |
| --- | --- | --- | --- |
| `EffectParameterEnvelope.data` | Ark model | Real effect values allowed by the selected tool Schema | Yes |
| Shared native `output.durationSeconds` | Ark model | Requested video duration only | Yes |
| Shared native `output.generationMode` | Ark model | Exact `fast`, `standard`, or `fine` mode | Yes |
| `AuthorizedEffectInputs` | Authenticated server | Owner-scoped, locked image/video/audio/mask/LUT/depth/font/model/texture/data bindings | No |

The package compiles with the ES server library and exposes no `Window`, `Document`, DOM node, canvas element, browser storage, or browser renderer type. The shared registry starts empty and imports no placeholder batch.

## Authoritative request sequence

1. Authenticate the session and enforce exact Origin, CSRF, scope, tenant, user, and audit rules before accepting a body or resource binding.
2. Resolve the one user-selected `toolName` to one registered `EffectToolDefinition`; reject missing, ambiguous, unpublished, or stale definitions.
3. Resolve the tool's declared `inputSlots` against owner-authorized server media/resource stores. Bind every resource to the authenticated tenant and user and lock it for this request.
4. Load only that tool's reviewed Chinese Markdown and closed parameter Schema. Call only server-side Ark `doubao-seed-2-0-lite-260428`.
5. Parse the one native tool call, reject extra argument fields, require exact selected function name, separate `effectParams` from shared `output.durationSeconds` and `output.generationMode`, and reject non-finite or resource-bearing values.
6. Validate raw effect parameters, apply only definition defaults to omitted optional fields, validate again, run `validateParams`, normalize, then revalidate Schema and `validateParams`; validate duration and generation mode independently against the shared contract and map the mode to a server-owned FPS.
7. Verify required input slots, cardinality, kind, owner, lock state, server context, and declared server backend.
8. Execute the selected effect for each server-owned output frame. Validation or authorization failure cannot enter the renderer.
9. Store preview/render/export outputs through the existing owner-scoped server lifecycle and safe download/export chain. While a video task runs, sample bounded NVIDIA whole-device VRAM telemetry server-side, retain the task peak, log safe numeric samples, and expose unavailable status without reporting a false zero.
10. Return a safe tool-result summary to the same Ark conversation with `tool_choice: none`, require a non-empty final Chinese response, and never include resource IDs or server paths in that second model turn.

## Compatibility and migration

The existing 40 registered P0 effects, `effectId` values, authentication, tenant media store, renderer contracts, preview routes, and exporter remain preserved. Some historical effect definitions place resource-like references such as brush textures, masks, mattes, maps, or paths in `parameterSchema`; those definitions are compatibility inputs only and are not valid new single-tool schemas as-is.

Migration is additive:

- new tools implement `EffectToolDefinition` in `@codemotion/effect-functions`;
- existing effects receive explicit adapters only after a field specification separates model `params` from server `inputSlots`;
- adapters may call existing effects-2d/effects-3d/renderer/exporter internals, but cannot expose their historical resource identity fields to the model;
- persisted Project Schema, existing renderer APIs, and the ordered 40-effect registry are unchanged by this contract package;
- the old `ai-task/v1` planning/project-generation path remains historical compatibility code and is not the current product architecture.

No code, commit, backup, or package may be recovered from `D:\CodeMotion FX Engine`. `doubao_glm_api_package/` must remain absent and ignored.

## Parallel directory ownership and serial Git

Future effect implementation may run in parallel only with disjoint directory ownership:

| Work | Source owner root | Test owner root | Field-spec owner root |
| --- | --- | --- | --- |
| New functions 1-8 | `src/batches/batch-01` through `batch-08` | `test/batches/batch-01` through `batch-08` | `field-specs/batch-01` through `batch-08` |
| Existing adapters | Assigned existing-effect source root | Assigned existing-effect test root | `field-specs/existing-01` or `existing-02` |

No worker may edit the public contract, registry, another owner's directory, governance, or shared package metadata without explicit reassignment. Parallel coding does not permit parallel Git integration: tests, status inspection, complete staged-diff inspection, staging, and local commits remain serial. The registry may reference a batch only after its implementation exists and its contract tests pass.

## Supersession map

| Historical record | Current status |
| --- | --- |
| Original V1 requirement document | Historical foundation; retained unchanged |
| `docs/api/stage-7.md` | Model planning/retrieval/project-generation flow superseded |
| `docs/api/stage-7r-group-1-boundary.md` | AI Storyboard, selection, parameter, and DSL flow superseded |
| `docs/api/stage-7r-group-1-auth-upload-boundary.md` | Browser AI payload/resource-selection details superseded; authentication, Origin, CSRF, tenant/media security remain authoritative |
| `docs/api/stage-7r-project-materialization-boundary.md` | Browser project/edit/preview materialization flow superseded; owner-scoped media/export safety remains authoritative |
| `docs/api/v2.2-sample-card-refactor.md` | Card workflow, model selection, and retrieval/ranking superseded |

## Acceptance gate

The contract is ready only when build and typecheck pass and tests demonstrate: a valid envelope; exact-type mismatch rejection; unknown-parameter rejection; bounds and enum enforcement; NaN/Infinity rejection; resource ID, URL, and path rejection; Schema/default consistency; post-normalization revalidation; owner-locked resource separation; no renderer call on failure; no DOM/browser-global dependency; and an empty registry with no nonexistent batch imports.
