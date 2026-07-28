import { performance } from "node:perf_hooks";
import {
  TEXT_EXTRUDE_3D,
  makeTextExtrudePreviewInput
} from "./dist/index.js";

const source = makeTextExtrudePreviewInput(64, 36);
TEXT_EXTRUDE_3D.renderPixels(source, TEXT_EXTRUDE_3D.defaultPreset, {
  progress: 0.5,
  seed: 20260728,
  quality: "preview"
});
const samples = [];
for (let index = 0; index < 9; index += 1) {
  const started = performance.now();
  TEXT_EXTRUDE_3D.renderPixels(source, TEXT_EXTRUDE_3D.defaultPreset, {
    progress: 0.5,
    seed: 20260728,
    quality: "preview"
  });
  samples.push(performance.now() - started);
}
samples.sort((left, right) => left - right);
const medianMs = samples[Math.floor(samples.length / 2)];
const pass = medianMs <= TEXT_EXTRUDE_3D.benchmarkBudgetMs;
console.table([{
  sourceId: "T08",
  effectId: TEXT_EXTRUDE_3D.effectId,
  performanceClass: TEXT_EXTRUDE_3D.performanceClass,
  medianMs: Number(medianMs.toFixed(3)),
  budgetMs: TEXT_EXTRUDE_3D.benchmarkBudgetMs,
  pass
}]);
console.log(JSON.stringify({
  schemaVersion: "1.0.0",
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  dimensions: "64x36",
  quality: "preview",
  iterations: samples.length,
  passed: pass ? 1 : 0,
  failed: pass ? 0 : 1
}, null, 2));
if (!pass) process.exitCode = 1;
