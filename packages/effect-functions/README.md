# @codemotion/effect-functions

Versioned public contract for the server-only, user-selected, single-effect tool path.

`EffectParameterEnvelope` is the complete model output boundary. It contains only the exact selected `toolName` and effect parameters. `AuthorizedEffectInputs` is a separate server-created, owner-scoped and locked resource channel. The executor validates, defaults, normalizes, revalidates, verifies authorized inputs, and only then calls `render`.

The package has no DOM library and no browser rendering API. The shared registry is intentionally empty until concrete batch implementations exist and pass their own tests.
