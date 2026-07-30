import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  GROUP_2_P0_EFFECTS,
  P0_EFFECTS,
  hashPixelSurface,
  makeBrushCoverage,
  makeEffectTimeSample,
  makeRealInputFixture,
  makeTextExtrudeCatalogFixture
} from "../dist/index.js";

const width = 64;
const height = 36;
const seed = 20260728;
const progressValues = [0, 0.25, 0.5, 0.75, 1];
const frames = {};

for (const effect of GROUP_2_P0_EFFECTS) {
  frames[effect.effectId] = {};
  for (const progress of progressValues) {
    const time = makeEffectTimeSample(
      effect.effectId,
      `golden.cpu.${effect.sourceId}`,
      progress
    );
    const kind = effect.category === "text" ? "text"
      : effect.category === "vector" || effect.category === "draw" ? "vector" : "media";
    const source = makeRealInputFixture(effect.effectId, kind, width, height, false, "srgb", time);
    const secondary = makeRealInputFixture(effect.effectId, "media", width, height, true, "srgb", time);
    const output = effect.renderPixels(source.surface, effect.defaultPreset, {
      time,
      seed,
      quality: "final",
      rasterInput: source.input,
      secondaryRasterInput: secondary.input,
      secondary: secondary.surface,
      brushCoverage: makeBrushCoverage(),
      brushAssetId: "builtin://brush/round"
    });
    frames[effect.effectId][String(progress)] = hashPixelSurface(output);
  }
}

const t08 = P0_EFFECTS.find((effect) => effect.sourceId === "T08");
if (!t08) throw new Error("T08 aggregate dependency is missing.");
const t08EffectInstanceId = "golden.cpu.T08";
frames[t08.effectId] = {};
for (const effectTime of progressValues) {
  const fixture = makeTextExtrudeCatalogFixture({
    effectId: t08.effectId,
    effectInstanceId: t08EffectInstanceId,
    text: "FX",
    width,
    height,
    effectTime,
    duration: 1,
    fps: 60,
    projectStart: 41
  });
  frames[t08.effectId][String(effectTime)] = hashPixelSurface(t08.renderPixels(
    fixture.input,
    t08.defaultPreset,
    { time: fixture.time, seed, quality: "final" }
  ));
}

const fixture = {
  schemaVersion: "1.1.0",
  inputFixtureVersion: "real-raster-1.0.0",
  baselineReason: "EffectTimeSample 1.1 explicit effect-instance identity, real TextRasterSource for T08, and deterministic vector resampling",
  width,
  height,
  seed,
  quality: "final",
  t08Source: {
    width,
    height,
    text: "FX",
    effectInstanceId: t08EffectInstanceId,
    seed,
    quality: "final"
  },
  frames
};

const target = resolve(import.meta.dirname, "fixtures/golden-frames.json");
await writeFile(target, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ target, effects: Object.keys(frames).length, frames: 200 }, null, 2));
