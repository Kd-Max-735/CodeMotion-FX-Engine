import { performance } from "node:perf_hooks";
import {
  TEXT_EXTRUDE_3D,
  makeTextExtrudeRasterFixture
} from "./dist/index.js";
import {
  resolveEffectTimeSample,
  resolveLayerTimeSample,
  resolveProjectTimeSample
} from "../timeline/dist/index.js";

const duration = 7.3;
const fps = 48;
const instance = {
  id: "benchmark.t08.instance",
  effectId: TEXT_EXTRUDE_3D.effectId,
  version: TEXT_EXTRUDE_3D.version,
  enabled: true,
  startTime: 0,
  endTime: duration,
  mix: { mode: "constant", value: 1 },
  params: TEXT_EXTRUDE_3D.defaultPreset
};
const transform = {
  anchorPoint: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
  position: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
  scale: { mode: "constant", value: { x: 100, y: 100, z: 100 } },
  rotation: { mode: "constant", value: { x: 0, y: 0, z: 0 } }
};
const layer = {
  id: "benchmark.t08.layer",
  type: "null",
  name: "T08 benchmark",
  visible: true,
  locked: false,
  solo: false,
  startTime: 17,
  endTime: 17 + duration,
  inPoint: 0,
  outPoint: duration,
  zIndex: 0,
  transform,
  opacity: { mode: "constant", value: 1 },
  blendMode: "normal",
  masks: [],
  effects: [instance],
  properties: {}
};
const project = resolveProjectTimeSample({
  projectTime: layer.startTime + duration * 0.5,
  previousProjectTime: layer.startTime + duration * 0.5 - 1 / fps,
  fps
});
const layerTime = resolveLayerTimeSample(layer, project);
const time = resolveEffectTimeSample(instance, layerTime, project, duration);
const input = makeTextExtrudeRasterFixture("立体", 64, 36, layerTime);
TEXT_EXTRUDE_3D.renderPixels(input, TEXT_EXTRUDE_3D.defaultPreset, {
  time,
  seed: 20260728,
  quality: "preview"
});
const samples = [];
for (let index = 0; index < 9; index += 1) {
  const started = performance.now();
  TEXT_EXTRUDE_3D.renderPixels(input, TEXT_EXTRUDE_3D.defaultPreset, {
    time,
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
  schemaVersion: "1.1.0",
  timeContractVersion: time.contractVersion,
  text: input.rasterInput.source.text,
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  dimensions: "64x36",
  quality: "preview",
  iterations: samples.length,
  passed: pass ? 1 : 0,
  failed: pass ? 0 : 1
}, null, 2));
if (!pass) process.exitCode = 1;
