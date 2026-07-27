# Stage 2 API

## Stability freeze

Status: **FROZEN** on 2026-07-27 after Stage 1 regression, fixed-time, command-history, scene-graph, and example verification.

| Contract | Frozen version |
| --- | --- |
| Root workspace, engine, core, and Schema package | `0.2.0` |
| Timeline package and fixed-time API | `0.1.0` |
| Scene Graph package | `0.1.0` |
| Command interface (`UndoableCommand`, `CommandHistory`) | Core `0.2.0` |
| Project Schema | `1.1.0` |
| Effect Definition Schema | `1.0.0` (unchanged) |
| Renderer Adapter API | `1.0.0` (unchanged) |

The fixed-time and command surfaces above are stable for Stage 2. Breaking changes require the corresponding package/contract version change, updated documentation, and regression coverage. Fixed-time behavior must remain independent of wall/display clocks; command failures must preserve history state and use `CMFX_COMMAND_FAILED`.

Stage 2 adds deterministic timeline and scene evaluation without a UI or renderer. Engine/core and schema package are `0.2.0`; Project Schema is `1.1.0`. Effect Definition Schema and Renderer Adapter API remain at `1.0.0`.

Project Schema `1.1.0` reserves and validates CompositionLayer `timeRemap` and `timeLoop`. The built-in `1.0.0 -> 1.1.0` migration changes only `schemaVersion`; Stage 1 data requires no inferred rewrite.

## Fixed time

`@codemotion/timeline` exports `frameToSeconds`, `secondsToFrame`, `frameTime`, and `fixedFrameRange`. Formal playback and export advance by integer frame:

```text
seconds = frame / fps
```

No timeline API reads `requestAnimationFrame`, display refresh rate, `Date`, or `performance.now()`.

Layer timing uses this contract:

- `[startTime, endTime)` is the layer span in its parent composition.
- `[inPoint, outPoint)` is the retained source range.
- `sourceTime = inPoint + (parentTime - startTime)`.
- The effective active end is `min(endTime, startTime + outPoint - inPoint)`.
- Composition `timeOffset` is added after source/remapped time. `timeLoop` is `none`, `repeat`, or `ping-pong`.
- Loop ranges are half-open. At an exact ping-pong fold, the sample is the greatest IEEE-754 value below `end`; this preserves the peak without producing an excluded `end` sample or consulting a display clock.

## Keyframes

`evaluateKeyframes` sorts without mutating input. Before/after boundaries return the first/last value. At duplicate times, the last keyframe at that time wins. Supported interpolations are `linear`, `hold`, `bezier` (Hermite tangents), `spring`, and `spline` (smoothstep). Number, Vector2, and Vector3 values interpolate component-wise; other JSON values use hold semantics.

`evaluateAnimatable` evaluates constants and keyframes directly. Expression and binding modes require explicit resolvers. `bakeKeyframes` and `bakeAnimatable` sample an inclusive integer frame range at explicit fps.

All documented easing names are implemented by `evaluateEasing`:

Definitions and parameter constraints are validated before input clamping or exact endpoint returns, so an invalid definition always raises `CMFX_KEYFRAME_INVALID` regardless of sampled progress.

| Easing | `params` |
| --- | --- |
| `linear`, `easeIn`, `easeOut`, `easeInOut`, `bounce` | none |
| `cubicBezier` | `[x1, y1, x2, y2]` |
| `spring` | `[stiffness, damping, mass, initialVelocity]`; underdamped, critical, and overdamped regimes use their corresponding second-order solutions |
| `elastic` | `[amplitude, period]` |
| `back` | `[overshoot]` |
| `steps` | `[count, position]`, position `0=end`, `1=start` |
| `customCurve` | `[x0, y0, x1, y1, ...]`, strictly increasing x |

## Scene graph

`@codemotion/scene-graph` exports `SceneGraph`, matrix helpers, and transform evaluation. Construction rejects duplicate IDs, missing parents, parent cycles, missing compositions, and precomposition cycles.

`SceneGraph.evaluateFrame(compositionId, frame)` uses the composition fps, falling back to project fps. Evaluation combines parent and precomposition world matrices and opacity. Transform order is translation, Z/Y/X rotation, skew, percentage scale, then negative anchor translation.

## Undo/Redo

`@codemotion/core` exports `UndoableCommand<TState>` and `CommandHistory<TState>`. Commands are renderer/UI independent and must be pure state transitions. A new execute after undo clears redo history; failed execute/undo/redo operations retain history state and raise `CMFX_COMMAND_FAILED`.
