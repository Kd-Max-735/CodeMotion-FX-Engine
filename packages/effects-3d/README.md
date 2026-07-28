# @codemotion/effects-3d

Stage 5 Group 3 owns only T08 in this package:

<a id="t08-fxtexttextextrude3d"></a>

## T08 — `fx.text.textExtrude3D`

Version `1.0.0`. The P0 path turns a rasterized text Alpha texture into a bounded
extrusion geometry, shades its front/bevel/sides with one of three materials and
three directional-light rigs, and projects it with bounded X/Y rotation.

- preferred: WebGL2, 6/12/24 deterministic extrusion samples by quality;
- explicit degraded fallback: Canvas2D/CPU layered extrusion with matching
  parameter, Alpha and mask semantics;
- performance class: `heavy`, 64x36 preview median budget: 35 ms;
- presets: Soft Studio, Chrome Rim and Glass Top;
- preview: `preview.html#T08`;
- scope: T08 only; no general scene graph, camera, model loader, PBR system,
  shadow system or Stage 9 platform.
