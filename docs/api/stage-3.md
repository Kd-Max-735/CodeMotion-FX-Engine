# Stage 3 Core Contracts

Status: **FROZEN** on 2026-07-27 after Stage 1/2 regression, Schema/migration, Effect Graph, resource/cache, WebGL, Golden Frame, release, and vertical-preview verification.

Frozen versions: root/engine/core/Schema `0.3.0`; Project Schema `1.2.0`; Renderer Adapter API `1.1.0`; renderer-api package `0.2.0`; expression, effect-graph, renderer-webgl, resource-manager, and cache packages `0.1.0`. Effect Definition Schema remains `1.0.0`.

Stage 3 adds renderer-independent contracts only. It does not include a WebGL renderer, Shader source, effect implementation, DOM access, or UI dependency.

## Safe expressions

`@codemotion/expression` evaluates `ExpressionAstNode` values without parsing or executing source code. `ExpressionDefinition.ast` persists the safe tree; the legacy `source` string is retained as display/compatibility data and is never executed by this package. Variables come only from the supplied context. Calls resolve only through `DEFAULT_EXPRESSION_FUNCTIONS` or an explicitly registered function. A shared step budget and active-program set enforce execution limits and dependency-cycle detection. Failures return the last valid result, then the program fallback, with a stable `EngineError`.

## Effect Graph

Project Schema `1.2.0` adds optional `CompositionDefinition.effectGraph` using Effect Graph contract version `1.0.0`. The built-in project migration chain is `1.0.0 -> 1.1.0 -> 1.2.0`; both steps change only `schemaVersion`.

`validateEffectGraph` rejects cycles, duplicate/missing nodes and ports, multiply connected or disconnected inputs, incompatible value types, dimensions, Alpha modes and color spaces, unreachable outputs, nodes that cannot reach the output, and excessive intermediate textures. Its topological order is stable by node declaration order.

`reorderEffectStack` requires an exact instance-ID permutation. `executeEffectStack` runs enabled effects in array order and retains the previous output when one item fails. `migrateEffectInstance` applies explicit version routes and normalizes callback or shape failures to `CMFX_EFFECT_MIGRATION_FAILED`.

## Resources and cache

`@codemotion/resource-manager` provides deduplicated loading by explicit `cacheKey`, caller cancellation, reference-counted leases, retry after failure, and one-time release on the final lease or manager disposal.

`@codemotion/cache` creates deterministic, length-prefixed cache keys from every required invalidation field. RenderTexture keys include width, height, format, color space, samples, and usage.

## Renderer capability selection

Renderer Adapter API `1.1.0` adds `detectRendererCapabilities` and `selectRendererAdapter`. Selection checks texture size, Alpha, float textures, color space, and blend modes in explicit backend order. Degraded preview selection must be requested; degraded final selection additionally requires explicit final approval.
