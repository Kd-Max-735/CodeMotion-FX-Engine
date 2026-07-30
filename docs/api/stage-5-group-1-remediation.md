# Stage 5R Group 1 public contracts

Status: implementation candidate for Group 7 verification.

## Time contract `1.1.0`

All times are finite seconds on logical clocks. No clock reads wall time, display refresh rate, `Date`,
`performance.now()`, or private object fields.

| Value | Meaning |
| --- | --- |
| `projectTime` | Absolute logical time in the project. |
| `LayerTimeSample.localTime` | `projectTime - layer.startTime`; moving a layer changes neither this value nor its source-time offset at an equivalent local sample. |
| `LayerTimeSample.sourceTime` | `layer.inPoint + localTime`; source trimming affects this value only. |
| `EffectTimeSample.effectTime` | `max(0, layer.localTime - (effect.startTime ?? 0))`. Effect `startTime` and `endTime` are in the owning layer's local time space. |
| `EffectTimeSample.progress` | Effect-local time divided by its local duration and clamped to `[0, 1]`; an omitted end uses the layer-local duration. |
| `EffectTimeSample.effectId` | Effect type/definition ID; exactly `EffectInstance.effectId`, so the resolver output is directly consumable by an effect runtime. |
| `EffectTimeSample.effectInstanceId` | Effect instance ID; exactly `EffectInstance.id`, used to distinguish repeated instances of the same effect type. |
| `deltaTime` | Difference between the current and explicitly supplied previous logical sample. It is not inferred from FPS. |
| `fps` / `frame` | FPS only quantizes a project sample to `floor(projectTime * fps)`; it does not scale layer/effect time or parameter values. |

Ranges are half-open. Effects are active on `[startTime, endTime)`. `EffectTimeSample` is invariant under
translation of the layer and project clocks, changes to project duration, and changes to FPS when sampled
at the same layer-local time.

Animatable evaluation uses its owner's clock:

- project/composition properties: project or current composition time;
- layer transform, opacity, source remap, and masks: layer-local time;
- effect mix and effect parameters: effect-local time.

`@codemotion/timeline` exports `resolveProjectTimeSample`, `resolveLayerTimeSample`,
`resolveEffectTimeSample`, `evaluationTimeForScope`, `evaluateAnimatableAt`, and
`createEffectRandom`. Random sampling keys use a length-prefixed tuple of effect type ID, effect instance
ID, stream name, and an effect-local sample index, never an absolute frame. Length prefixes prevent
delimiter-shaped IDs from aliasing. Consequently, different instances of the same effect type receive
independent streams while repeated evaluation of one instance is stable.

Legacy absolute effect windows have contract version `0.0.0`. Call
`migrateLegacyAbsoluteEffectTiming(legacy, layerAbsoluteStart)` to subtract the owning layer start and
produce version `1.1.0`. Time samples from contract `1.0.0` used `effectId` for `EffectInstance.id` and
did not carry the effect type ID. `migrateEffectTimeSampleV1(sample, effect)` requires the original
`EffectInstance`, verifies that the legacy field matches `effect.id`, then writes
`effectId = effect.effectId` and `effectInstanceId = effect.id`. Migration without that source instance
is rejected because the missing type ID cannot be inferred safely.

These migrations are separate from Project Schema `1.2.0`: the old schema never
versioned timing semantics, so changing the Project Schema version would not be an evidence-based
migration. New runtime integrations must use the versioned time sample directly. Hidden keys such as
`__cmfxElapsedSeconds` are not part of any contract and must not be read or written.

## Layer rasterization contract `1.0.0`

`@codemotion/renderer-api` exports the following public inputs and outputs:

- `LayerRasterizationInput` / `LayerRasterizationOutput`;
- `TextRasterSource`, `VectorRasterSource`, and `MediaRasterSource`;
- `FontRasterAsset`, `RasterGlyph`, glyph `CoverageBuffer`, and `MissingGlyphPolicy`;
- `RasterTransform`, `RasterMaskInput`, `PixelBuffer`, and `DualInputTextures`;
- `assertLayerRasterizationInput`, `assertLayerRasterizationOutput`, and
  `assertDualInputTextures`;
- `TemporalEffectRenderContext`, `RegisteredTemporalEffectDefinition`, and
  `assertTemporalEffectContext`;
- `RASTER_COORDINATE_CONTRACT`.

Text input carries an immutable font asset ID/hash, metrics, explicit missing-glyph policy, glyph IDs,
clusters, advances, glyph half-open bounds, and per-pixel glyph coverage. `use-notdef` requires an
explicit `.notdef` glyph ID. Shape and SVG inputs carry actual path commands and fill rules. Image and
video inputs carry decoded RGBA content with asset identity and frame time. There is no `solid` source
variant.

Coordinates have a top-left origin, +x right, +y down. Pixels cover half-open unit squares and are
sampled by area coverage; the pixel center is `(x + 0.5, y + 0.5)`. The row-major transform is:

```text
translate(position) * rotate * skew * scale * translate(-anchor)
```

Masks are coverage textures transformed in the same coordinate system. Raster output is a real content
texture with source provenance, content bounds, covered-pixel count, content digest, and premultiplied
Alpha. `usedSolidFallback` is the literal `false`; non-media layers cannot be represented by a full-frame
solid substitute. Dual-input effects receive independently materialized, dimension/color-compatible
`source` and `secondary` textures.

## Color, Alpha, blend, and backend conformance `1.0.0`

The reference working space is linear-sRGB. Every backend follows this order:

1. unassociate source Alpha;
2. decode the sRGB/Display-P3 transfer function;
3. convert source primaries to linear-sRGB;
4. blend with Porter-Duff source-over in linear-sRGB;
5. convert linear-sRGB to output primaries;
6. encode the output transfer function;
7. associate output Alpha.

Display-P3 uses its own primaries, not merely the sRGB transfer curve. `normal`, separable blend modes,
and the non-separable hue/saturation/color/luminosity modes use the same linear working-space contract.
A backend that cannot implement a requested color space or blend mode must report the missing
capability or fail; it must not silently substitute another mode.

`COLOR_CONFORMANCE_FIXTURES`, `BLEND_CONFORMANCE_FIXTURES`, and
`BACKEND_CONFORMANCE_CONTRACT` are exported by `@codemotion/renderer-api`. RGBA8 backend results have a
one-channel-code tolerance and float paths have a `1e-5` tolerance. The CPU reference implementation in
`@codemotion/renderer-webgl` implements sRGB, linear-sRGB, Display-P3 conversion and all public blend
modes. The WebGL adapter continues to advertise only the modes/color spaces its shader path actually
implements, so capability selection can choose a conforming fallback rather than silently degrade.

## Required consumers

| Group | Required public contract consumption |
| --- | --- |
| G2 | Consume `EffectTimeSample.effectId` as the effect type and `effectInstanceId` as instance identity; replace every private elapsed-time key with `effectTime`; use `progress`, `deltaTime`, and `createEffectRandom` from the same sample; accept `DualInputTextures` for A/B effects. |
| G3 | Use `TemporalEffectRenderContext` and real text glyph coverage/font assets for T08 and later 3D text inputs. |
| G4 | Construct explicit project/layer/effect samples for preview; supply real text/Shape/SVG raster inputs and font/missing-glyph decisions. |
| G5 | Migrate legacy absolute effect windows at the load boundary; evaluate effect params/mix in effect-local time; replace non-media solid surfaces with `LayerRasterizationInput`; enforce color/backend fixtures in export. |

This segment does not implement G2 effects, G3 rendering behavior, G4 UI, or G5 export behavior.
