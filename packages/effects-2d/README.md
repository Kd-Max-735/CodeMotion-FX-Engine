# @codemotion/effects-2d

Group 2's complete Stage 5 implementation of the 39 frozen P0 2D effects, plus the
40-item aggregate registry that consumes Group 3's T08 `fx.text.textExtrude3D`
without rewriting its implementation.

Each effect is a real deterministic implementation with:

- package and Effect Definition `1.1.0`, JSON parameter Schema, generated UI Schema, defaults and three valid built-in presets;
- a WebGL2 shader path plus deterministic CPU/Canvas2D fallback;
- `draft`, `preview`, and `final` quality settings, a performance class and measured budget;
- straight/premultiplied Alpha handling, post-effect masks, bounded extreme-parameter normalization and `dispose`;
- independently addressable effect/preset SVG covers plus the live `preview.html`,
  unit coverage, 0/25/50/75/100% Golden Frames and benchmark coverage.

## Usage

```ts
import {
  GROUP_2_P0_BY_ID,
  makeBrushCoverage,
  makeEffectTimeSample,
  makeRealInputFixture
} from "@codemotion/effects-2d";

const effect = GROUP_2_P0_BY_ID.get("fx.transition.liquidWipe")!;
const effectInstanceId = "composition.hero.transition.liquid-wipe";
const time = makeEffectTimeSample(effect.effectId, effectInstanceId, 0.5);
const source = makeRealInputFixture(effect.effectId, "media", 160, 90, false, "srgb", time);
const secondary = makeRealInputFixture(effect.effectId, "media", 160, 90, true, "srgb", time);
const frame = effect.renderPixels(source.surface, effect.presets[2].params, {
  time,
  seed: 42,
  quality: "preview",
  rasterInput: source.input,
  secondaryRasterInput: secondary.input,
  secondary: secondary.surface,
  brushCoverage: makeBrushCoverage(),
  brushAssetId: "builtin://brush/round"
});
effect.dispose();
```

## 1.0.0 to 1.1.0 migration

Effect parameters do not change. Callers replace normalized-only runtime options with
G1's `EffectTimeSample`, provide the real `LayerRasterizationInput` that produced the
source pixels, and provide an independently materialized secondary raster input for
transition/composite effects. WebGL callers pass G1's `TemporalEffectRenderContext`;
A/B effects additionally pass `DualInputTextures`. Hidden elapsed-time keys and
project-global time inference are rejected. Random effects derive their streams from
`createEffectRandom`, keyed by effect type ID, the caller-supplied
`EffectInstance.id` (`effectInstanceId`), and effect-local time rather than absolute
frame. The two IDs are mandatory and are never inferred or replaced with a shared
fixture ID.

Text inputs must contain immutable font identity plus English/Chinese glyph coverage;
Shape/SVG and draw inputs must contain parsed path commands (D02 also requires brush
coverage); light/post inputs require decoded RGBA image/video content. Malformed or
missing provenance fails explicitly.

Run `npm run benchmark -w @codemotion/effects-2d` after the root build. The durable
browser gates are `npm run qa:webgl -w @codemotion/effects-2d` for real Microsoft Edge
WebGL2 pixel readback/parameter/Alpha/mask/performance/resource QA and
`npm run qa:preview -w @codemotion/effects-2d` for 40 non-empty, pairwise-distinct Edge
previews. Open `preview.html` through an HTTP server after the build for interactive use.
Run `npm run evidence:s5r -w @codemotion/effects-2d` after those gates to regenerate
the machine-readable 39-by-20 evidence matrix in
`test/fixtures/s5r-self-check.json`.

## Aggregate registry

`P0_EFFECTS` and `P0_EFFECTS_BY_ID` contain the frozen 40-item catalog in source
order. T08 occupies slot 16 between T07 and V01 and remains owned by Group 3.
`GROUP_2_P0_EFFECTS` and `GROUP_2_P0_BY_ID` remain the unchanged 39-item Group 2
implementation slice.

Aggregate tests, previews and QA use `makeTextExtrudeCatalogFixture` for T08. Callers
must explicitly provide `effectId: "fx.text.textExtrude3D"`, their own
`effectInstanceId`, effect-local seconds, duration, FPS and project start. The helper
uses the official 1.1.0 timeline resolvers and G3's reviewed real `TextRasterSource`;
the removed generic pixel/progress compatibility input is not re-exported.

## Effect inventory

Every entry uses preferred backend `webgl`, fallback `canvas2d`, and the three
effect-specific presets `Gentle`, `Balanced`, and `Bold`.

### Motion

<a id="m01-fxmotionfade"></a>
- M01 `fx.motion.fade` — `from`, `to`, `duration`, `easing`; Light.
<a id="m02-fxmotionslide"></a>
- M02 `fx.motion.slide` — `direction`, `distance`, `overshoot`, `vector`; Light.
<a id="m03-fxmotionscalepop"></a>
- M03 `fx.motion.scalePop` — `startScale`, `endScale`, `spring`, `pivot`; Light.
<a id="m04-fxmotionrotatein"></a>
- M04 `fx.motion.rotateIn` — `angle`, `pivot`, `blur`, `turns`; Medium.
<a id="m05-fxmotionbounce"></a>
- M05 `fx.motion.bounce` — `height`, `gravity`, `bounces`, `damping`; Light.
<a id="m06-fxmotionelastic"></a>
- M06 `fx.motion.elastic` — `amplitude`, `period`, `decay`, `axis`; Light.
<a id="m07-fxmotionfloat"></a>
- M07 `fx.motion.float` — `axis`, `range`, `frequency`, `phase`; Light.
<a id="m08-fxmotionshake"></a>
- M08 `fx.motion.shake` — `intensity`, `frequency`, `decay`, `seedOffset`; Light.

### Text

<a id="t01-fxtexttypewriter"></a>
- T01 `fx.text.typewriter` — `speed`, `cursor`, `wordMode`, `cursorWidth`; Light.
<a id="t02-fxtextcharactercascade"></a>
- T02 `fx.text.characterCascade` — `stagger`, `axis`, `offset`, `selector`; Light.
<a id="t03-fxtextkinetictypography"></a>
- T03 `fx.text.kineticTypography` — `layoutMode`, `beatMap`, `scaleMap`, `strength`; Medium.
<a id="t04-fxtexttextpathreveal"></a>
- T04 `fx.text.textPathReveal` — `path`, `progress`, `orientation`, `feather`; Medium.
<a id="t05-fxtexttextmorph"></a>
- T05 `fx.text.textMorph` — `sourceText`, `targetText`, `matchMode`, `progress`; Heavy.
<a id="t06-fxtextscrambledecode"></a>
- T06 `fx.text.scrambleDecode` — `charset`, `speed`, `lockDirection`, `progress`; Medium.
<a id="t07-fxtextwordexplode"></a>
- T07 `fx.text.wordExplode` — `force`, `rotation`, `depth`, `selector`; Medium.

### Vector and draw

<a id="v01-fxvectorpathtrim"></a>
- V01 `fx.vector.pathTrim` — `start`, `end`, `offset`, `strokeWidth`; Light.
<a id="v02-fxvectorpathmorph"></a>
- V02 `fx.vector.pathMorph` — `fromPath`, `toPath`, `normalize`, `progress`; Medium.
<a id="v03-fxvectorshaperepeater"></a>
- V03 `fx.vector.shapeRepeater` — `count`, `offset`, `rotation`, `scale`; Medium.
<a id="v04-fxvectorradialburst"></a>
- V04 `fx.vector.radialBurst` — `count`, `radius`, `angle`, `thickness`; Medium.
<a id="d01-fxdrawhandwriting"></a>
- D01 `fx.draw.handwriting` — `path`, `pressure`, `speedVariation`, `progress`; Medium.
<a id="d02-fxdrawbrushreveal"></a>
- D02 `fx.draw.brushReveal` — `brushTexture`, `size`, `roughness`, `progress`; Medium.
<a id="d03-fxdrawinkspread"></a>
- D03 `fx.draw.inkSpread` — `diffusion`, `edgeNoise`, `absorption`, `progress`; Heavy.
<a id="d04-fxdrawchalkstroke"></a>
- D04 `fx.draw.chalkStroke` — `grain`, `scatter`, `opacity`, `progress`; Medium.

### Light and post

<a id="l01-fxlightneonglow"></a>
- L01 `fx.light.neonGlow` — `color`, `radius`, `intensity`, `flicker`; Heavy.
<a id="l02-fxlightscanbeam"></a>
- L02 `fx.light.scanBeam` — `angle`, `width`, `softness`, `speed`; Medium.
<a id="l03-fxlightlensflare"></a>
- L03 `fx.light.lensFlare` — `source`, `ghosts`, `streak`, `chromatic`; Heavy.
<a id="l04-fxlightenergypulse"></a>
- L04 `fx.light.energyPulse` — `center`, `radius`, `falloff`, `rings`; Medium.
<a id="p01-fxpostgaussianblur"></a>
- P01 `fx.post.gaussianBlur` — `radius`, `passes`, `edgeMode`, `alphaAware`; Heavy.
<a id="p02-fxpostdirectionalblur"></a>
- P02 `fx.post.directionalBlur` — `angle`, `distance`, `samples`, `edgeMode`; Heavy.
<a id="p03-fxpostradialblur"></a>
- P03 `fx.post.radialBlur` — `center`, `strength`, `mode`, `samples`; Heavy.
<a id="p04-fxpostmotionblur"></a>
- P04 `fx.post.motionBlur` — `shutterAngle`, `samples`, `velocity`, `centered`; Heavy.

### Transition and composite

<a id="c01-fxtransitionwipe"></a>
- C01 `fx.transition.wipe` — `direction`, `softness`, `angle`, `progress`; Light.
<a id="c02-fxtransitionradialwipe"></a>
- C02 `fx.transition.radialWipe` — `center`, `startAngle`, `clockwise`, `progress`; Medium.
<a id="c03-fxtransitionliquidwipe"></a>
- C03 `fx.transition.liquidWipe` — `noise`, `viscosity`, `edgeGlow`, `progress`; Heavy.
<a id="c04-fxtransitionpixeldissolve"></a>
- C04 `fx.transition.pixelDissolve` — `grid`, `order`, `seed`, `progress`; Medium.
<a id="h01-fxcompositemaskreveal"></a>
- H01 `fx.composite.maskReveal` — `mask`, `progress`, `feather`, `invert`; Medium.
<a id="h02-fxcompositetrackmatte"></a>
- H02 `fx.composite.trackMatte` — `matteLayer`, `mode`, `invert`, `opacity`; Medium.
<a id="h03-fxcompositeblend"></a>
- H03 `fx.composite.blend` — `mode`, `opacity`, `premultiply`, `mix`; Medium.
<a id="h04-fxcompositedisplacementmap"></a>
- H04 `fx.composite.displacementMap` — `map`, `xAmount`, `yAmount`, `channel`; Medium.

## Runtime contracts

Transition effects consume A/B surfaces and return A exactly at 0% and B exactly at
100% when no external mask is present. Composite effects consume a secondary surface
or mask without mutating either input. All stochastic behavior uses the supplied seed.
Parameters outside Schema bounds, non-finite values, invalid enums and null-like values
normalize to safe bounded defaults.

Golden hashes are in `test/fixtures/golden-frames.json`. They cover every effect at
0%, 25%, 50%, 75% and 100%. The 39 Group 2 effects use the aggregate A/B/mask
fixture; T08 uses Group 3's canonical raster-text input, seed and final-quality fixture.
