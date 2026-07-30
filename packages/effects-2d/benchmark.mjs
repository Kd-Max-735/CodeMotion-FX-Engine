import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  P0_EFFECTS,
  makeBrushCoverage,
  makeEffectTimeSample,
  makeRealInputFixture,
  makeTextExtrudeCatalogFixture
} from "./dist/index.js";

const results = [];

for (const effect of P0_EFFECTS) {
  const textExtrude = effect.sourceId === "T08"
    ? makeTextExtrudeCatalogFixture({
        effectId: effect.effectId,
        effectInstanceId: "benchmark.cpu.T08",
        text: "FX",
        width: 64,
        height: 36,
        effectTime: 0.5,
        duration: 1,
        fps: 60,
        projectStart: 19
      })
    : undefined;
  const time = textExtrude?.time ?? makeEffectTimeSample(
    effect.effectId,
    `benchmark.cpu.${effect.sourceId}`,
    0.5,
    1,
    19,
    60,
    1 / 60
  );
  const kind = effect.category === "text" ? "text"
    : effect.category === "vector" || effect.category === "draw" ? "vector" : "media";
  const source = textExtrude
    ? undefined
    : makeRealInputFixture(effect.effectId, kind, 64, 36, false, "srgb", time);
  const secondary = textExtrude
    ? undefined
    : makeRealInputFixture(effect.effectId, "media", 64, 36, true, "srgb", time);
  const render = () => effect.sourceId === "T08"
    ? effect.renderPixels(textExtrude.input, effect.defaultPreset, {
        time,
        seed: 20260728,
        quality: "preview"
      })
    : effect.renderPixels(source.surface, effect.defaultPreset, {
        time,
        seed: 20260728,
        quality: "preview",
        rasterInput: source.input,
        secondaryRasterInput: secondary.input,
        secondary: secondary.surface,
        brushCoverage: makeBrushCoverage(),
        brushAssetId: "builtin://brush/round"
      });
  render();
  const samples = [];
  for (let index = 0; index < 7; index += 1) {
    const started = performance.now();
    render();
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const medianMs = samples[Math.floor(samples.length / 2)];
  results.push({
    sourceId: effect.sourceId,
    effectId: effect.effectId,
    performanceClass: effect.performanceClass,
    medianMs: Number(medianMs.toFixed(3)),
    budgetMs: effect.benchmarkBudgetMs,
    pass: medianMs <= effect.benchmarkBudgetMs
  });
}

console.table(results);
const failed = results.filter((result) => !result.pass);
const report = {
  schemaVersion: "1.0.0",
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  dimensions: "64x36",
  quality: "preview",
  timeContractVersion: "1.1.0",
  t08Input: "TextRasterSource",
  iterations: 7,
  passed: results.length - failed.length,
  failed: failed.length,
  results
};
console.log(JSON.stringify(report, null, 2));
if (failed.length === 0) {
  await writeFile(
    resolve(import.meta.dirname, "test/fixtures/cpu-benchmark-evidence.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
}
if (failed.length > 0) process.exitCode = 1;
