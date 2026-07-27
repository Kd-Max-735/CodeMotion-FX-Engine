# Stage 1 API

## Public contract freeze

Status: **FROZEN** on 2026-07-27 after Stage 1 type, Schema, migration, and example verification.

| Contract | Frozen version |
| --- | --- |
| Root workspace and public packages | `0.1.0` |
| Engine runtime | `0.1.0` |
| Project Schema | `1.0.0` |
| Effect Definition Schema | `1.0.0` |
| Renderer Adapter API | `1.0.0` |
| JSON Schema document | `https://schemas.codemotion.dev/contracts/v1/contracts.schema.json` |

The frozen surface comprises all exports from `@codemotion/core`, `@codemotion/schema`, and `@codemotion/renderer-api`; the 54 definitions in `contracts.schema.json`; stable error codes; project serialization and migration behavior; and the deterministic seed sequence. Additive compatible changes require normal review and tests. Breaking changes require a major contract-version increment plus an explicit project migration or renderer compatibility adapter. No Stage 2 implementation is part of this freeze.

## Packages

### `@codemotion/core`

The core package has no UI or renderer dependency. It exports:

- `MotionProject`, `CompositionDefinition`, `LayerDefinition`, all 16 concrete layer interfaces, `Animatable<T>`, `Keyframe<T>`, `EffectInstance`, and serializable `EffectDefinition`.
- `JsonSchema` represents the complete JSON Schema value domain used by effect parameters: `boolean | JsonObject`. `uiSchema` and `defaultPreset` remain object-only.
- `ENGINE_VERSION`, `PROJECT_SCHEMA_VERSION`, `EFFECT_DEFINITION_SCHEMA_VERSION`, `RENDERER_API_VERSION`, and `CONTRACT_VERSIONS`.
- `EngineError`, `ERROR_CODES`, `Logger`, `createLogger`, and `NOOP_LOGGER`.
- `createSeededRandom` and `normalizeSeed`. Seeds are unsigned 32-bit integers. The PRNG sequence is part of the engine-version contract; rendering code must not use `Math.random()`.

Nested project contracts evolve atomically with `MotionProject.schemaVersion`. An `EffectInstance.version` pins an effect implementation; `EffectDefinition.schemaVersion` versions the catalog record itself.

### `@codemotion/schema`

`contracts.schema.json` is a Draft 2020-12 schema with a versioned `$id`. Its `$defs` expose independent schemas for the requested public contracts and all concrete layer kinds. Typed fields use `AnimatableNumber`, `AnimatableString`, `AnimatableVector2`, or `AnimatableVector3`; only fields declared as `Animatable<JsonValue>` use the generic definition.

```ts
const project = loadProject(json, { migrations, maxInputBytes });
const json = saveProject(project);
const result = validateContract("LayerDefinition", candidate);
```

- `loadProject` parses, applies an explicit migration chain, validates, and returns a typed project.
- `saveProject` validates and emits deterministically key-sorted JSON.
- `migrateProject` never guesses an old format. Every version transition requires a registered `ProjectMigration`. Once a migration callback is selected, callback exceptions, invalid return values, invalid result versions, and cyclic chains are normalized to `CMFX_MIGRATION_FAILED`; absence of a registered route remains `CMFX_UNSUPPORTED_SCHEMA_VERSION`.
- The default JSON input limit is 5 MiB and can be lowered by the caller.

### `@codemotion/renderer-api`

`RendererAdapter` is the only public renderer boundary. It defines initialization, texture allocation/release, frame lifecycle, layer rendering, composition, final output, cancellation, capabilities, and disposal. `assertRendererCompatibility` rejects adapters whose `apiVersion` differs from `RENDERER_API_VERSION`.

`EffectDefinition` intentionally contains only JSON-serializable catalog data. `RegisteredEffectDefinition` adds runtime-only `render`, `migrationHandlers`, and `dispose` functions, because functions cannot be represented or safely accepted through JSON Schema.

No concrete renderer or effect is included in Stage 1.

## Error codes

| Code | Meaning |
| --- | --- |
| `CMFX_INVALID_SEED` | Seed is not a uint32 value |
| `CMFX_INPUT_TOO_LARGE` | Project JSON exceeds the configured byte limit |
| `CMFX_PARSE_ERROR` | JSON parsing failed |
| `CMFX_SCHEMA_INVALID` | A public contract failed schema validation |
| `CMFX_UNSUPPORTED_SCHEMA_VERSION` | No explicit migration starts at the input version |
| `CMFX_MIGRATION_FAILED` | A migration threw, looped, or returned the wrong version |
| `CMFX_RENDERER_INCOMPATIBLE` | Renderer API version mismatch |
| `CMFX_RENDERER_LIFECYCLE` | Reserved for invalid renderer lifecycle state |

## Version policy

Package versions follow SemVer. JSON Schema and Renderer Adapter versions are independent contracts and only change when their respective public surface changes. A breaking schema or adapter change increments its major version and requires an explicit migration or compatibility adapter.
