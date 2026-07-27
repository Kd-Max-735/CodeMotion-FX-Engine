# Stage 3 WebGL 2D Backend

`@codemotion/renderer-webgl` implements the Stage 3 `RendererAdapter` contract with an injected WebGL2 context. The package has no DOM dependency, so browser canvases, workers, and test contexts can provide the context through the same factory boundary.

## Pipeline contract

- RenderTextures are texture/framebuffer pairs. `releaseTexture` and `dispose` are idempotent and release every live GPU object once.
- Uploaded pixels disable browser color conversion and are normalized to premultiplied Alpha at the upload boundary.
- Composition evaluates supported blend modes in linear light, then encodes the target color space. Stage 3 supports `srgb` and `linear-srgb`; Display P3 remains a capability miss rather than being silently approximated.
- Masks support add/intersect coverage and subtract through inversion for an individual mask pass. Multiple masks are applied in declared order.
- Effect passes use RenderTextures in stack order. A compile, link, allocation, or draw failure is reported as `CMFX_EFFECT_EXECUTION_FAILED`; the previous valid texture continues into the next pass.
- Context creation and loss use `CMFX_RENDERER_LIFECYCLE`. `initializeFirstAvailableRenderer` isolates initialization failure and tries the next caller-ordered backend.

Stage 3 intentionally limits RenderTextures to one sample. Float targets require `EXT_color_buffer_float`.

## Validation effect

`internal.pipeline.tint-validation` exists only to prove Shader and effect-stack flow. Both CPU and WebGL descriptors set `catalogContribution: false`; it is not one of the first 40 product effects and must not be registered in the effect catalog.

The 2x2 RGBA fixture under `packages/renderer-webgl/test/fixtures/` is the fixed Stage 3 Golden Frame. It covers mask opacity, the validation effect, screen blending, color conversion, and premultiplied output.

`packages/renderer-webgl/test/browser-smoke.html` runs that fixture in a real WebGL2 context from built package output. `examples/stage-3-vertical-preview.html` is the minimum portrait preview: 270x480, WebGL mask/effect/composite, RGBA readback, and visible canvas output. Both require `npm run build` and a static server rooted at the repository.
