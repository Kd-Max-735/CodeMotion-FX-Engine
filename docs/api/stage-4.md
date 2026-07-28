# Stage 4 editor foundation

Status: **FROZEN** on 2026-07-28 after core integration, autosave/recovery, production build, desktop/mobile visual, and P0 catalog gate verification.

## Scope

Stage 4 adds `@codemotion/editor` `0.1.0` without changing the frozen core, Project Schema, Effect Definition Schema, or Renderer Adapter API.

Delivered surfaces:

- project workbench with format/FPS selection, recent autosaves, template entry points, JSON import, render-queue status, and recovery;
- animation editor with layer create/copy/delete/reorder, visibility/lock/solo, WebGL canvas, safe area, selection overlay, Schema-driven properties, effect search/drag/sort, keyframes, timeline scrubbing, playback, undo/redo, and project download;
- effect laboratory with parameter JSON, editable GLSL, real WebGL compilation/execution, backend/texture/draw-call/CPU/VRAM reporting, and explicit states for deferred test/export capabilities;
- local autosave through the frozen `saveProject`/`loadProject` contract and error mapping to layer, effect, and parameter paths.

The editor uses `CommandHistory` from `@codemotion/core`, timeline evaluation from `@codemotion/timeline`, serialization and validation from `@codemotion/schema`, and `WebGLRendererAdapter` from `@codemotion/renderer-webgl`. Preview pixels are read from the real Stage 3 render textures and presented on the visible canvas.

The project-facing laboratory wrapper uses the Schema-valid ID `fx.lab.pipelineValidation`. The preview layer explicitly maps that wrapper to the Stage 3 renderer pass `internal.pipeline.tint-validation`, whose `catalogContribution` remains `false`. Neither ID is a Stage 5 catalog effect, and the wrapper contributes zero entries to the 40-effect target.

## Verification

Run from the repository root:

```text
npm run typecheck
npm test
npm run build -w @codemotion/editor
npm run qa:visual -w @codemotion/editor
```

Verified on 2026-07-28:

- strict typecheck passed;
- 13 test files and 103 tests passed, including Stage 1-3 regressions and corrupt-autosave isolation;
- the editor production bundle completed successfully;
- Edge headless at 1440x900 and 390x844 had no horizontal page overflow, major editor-region overlap, button-text overflow, browser console errors, or blank canvas;
- WebGL canvas sampling found 1296 non-transparent samples;
- edited invalid GLSL was rejected as `BLOCKED`; restoring valid GLSL compiled and executed as `PASS`;
- browser layer visibility changed and restored real WebGL pixels; drag, autosave, refresh recovery, corrupt-autosave preservation, restored preview, and downloaded-project round-trip passed;
- measured browser parameter feedback was 13.2 ms against the 100 ms target;
- measured browser timeline feedback was 17.5 ms against the 200 ms target;
- desktop and mobile screenshots are generated under ignored `tmp/stage-4-visual/`.

## Deferred boundaries

- The concrete P0 40 IDs and ownership boundaries are frozen in `docs/P0_EFFECT_CATALOG.md`; implementations, presets, and acceptance assets remain Stage 5 work.
- Export execution and render progress remain Stage 6 work; Stage 4 exposes queue status only.
- AI generation remains Stage 7 work. The workbench shows an unconnected AI entry and never reports generated success.
- Golden Frame approval and multi-browser verification remain independent Group 7 gate evidence. The laboratory exposes their honest pending states.
