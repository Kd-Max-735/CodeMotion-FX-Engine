import { performance } from "node:perf_hooks";
import {
  P0_EFFECTS,
  makePreviewInput,
  makeTextExtrudePreviewInput
} from "./dist/index.js";

const source = makePreviewInput(64, 36);
const textExtrudeSource = makeTextExtrudePreviewInput(64, 36);
const secondary = makePreviewInput(64, 36, true);
const mask = makePreviewInput(64, 36);
const results = [];

for (const effect of P0_EFFECTS) {
  const effectSource = effect.sourceId === "T08" ? textExtrudeSource : source;
  effect.renderPixels(effectSource, effect.defaultPreset, {
    progress: 0.5,
    seed: 20260728,
    quality: "preview",
    secondary,
    mask
  });
  const samples = [];
  for (let index = 0; index < 7; index += 1) {
    const started = performance.now();
    effect.renderPixels(effectSource, effect.defaultPreset, {
      progress: 0.5,
      seed: 20260728,
      quality: "preview",
      secondary,
      mask
    });
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
console.log(JSON.stringify({
  schemaVersion: "1.0.0",
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  dimensions: "64x36",
  quality: "preview",
  iterations: 7,
  passed: results.length - failed.length,
  failed: failed.length
}, null, 2));
if (failed.length > 0) process.exitCode = 1;
