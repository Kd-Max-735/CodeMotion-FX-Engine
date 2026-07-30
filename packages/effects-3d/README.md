# @codemotion/effects-3d

Stage 5 Group 3 owns only T08 in this package:

<a id="t08-fxtexttextextrude3d"></a>

## T08 — `fx.text.textExtrude3D`

Version `1.0.0`. The Stage 5R path consumes G1's `EffectTimeSample 1.1.0`
through `TemporalEffectRenderContext`. `effectId` selects this definition while
the required `effectInstanceId` identifies the caller-owned instance. Output
from the official `resolveEffectTimeSample` can be rendered without conversion.

Input must be a real `TextRasterSource`: immutable font identity, Unicode text,
glyph IDs/clusters/metrics and non-empty per-glyph coverage, plus its matching
raster surface/output. Missing glyph provenance and generic pixel-only surfaces
fail explicitly. Progress is not a parameter; all animation comes from the
required effect-local time sample.

Glyph coverage is converted to indexed front/back/side extrusion geometry,
shaded with one of three materials and three directional-light rigs, and
projected with bounded X/Y rotation.

- preferred: WebGL2, 6/12/24 deterministic extrusion samples by quality;
- explicit degraded fallback: Canvas2D/CPU glyph-mesh extrusion with the same
  required time, raster provenance, parameter, Alpha and mask semantics;
- performance class: `heavy`, 64x36 preview median budget: 35 ms;
- presets: Soft Studio, Chrome Rim and Glass Top;
- preview: `preview.html#T08`;
- scope: T08 only; no general scene graph, camera, model loader, PBR system,
  shadow system or Stage 9 platform.
