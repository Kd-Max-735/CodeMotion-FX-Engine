import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  P0_EFFECTS,
  hashPixelSurface,
  makeBrushCoverage,
  makeEffectTimeSample,
  makeRealInputFixture,
  makeTextExtrudeCatalogFixture
} from "@codemotion/effects-2d";
import {
  createProjectFrameProducer,
  exportFixedFrames,
  runProcess
} from "../dist/index.js";

const WIDTH = 48;
const HEIGHT = 32;
const FPS = 4;
const FRAME_COUNT = 5;
const DURATION = FRAME_COUNT / FPS;
const EFFECT_END = 1.000001;
const PROGRESS = [0, 0.25, 0.5, 0.75, 1];
const FORMATS = ["png-sequence", "gif", "webm", "mp4"];
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputRoot = resolve(scriptDirectory, "../../../tmp/s5r-export-evidence");
const evidencePath = resolve(scriptDirectory, "fixtures/s5r-export-evidence.json");
const goldenPath = resolve(scriptDirectory, "../../effects-2d/test/fixtures/golden-frames.json");
const t08GoldenPath = resolve(scriptDirectory, "../../effects-3d/test/fixtures/golden-frames.json");
const t08WebglGoldenPath = resolve(
  scriptDirectory,
  "../../effects-3d/test/fixtures/webgl-golden-frames.json"
);
const golden = JSON.parse(await readFile(goldenPath, "utf8"));
const t08Golden = JSON.parse(await readFile(t08GoldenPath, "utf8"));
const t08WebglGolden = JSON.parse(await readFile(t08WebglGoldenPath, "utf8"));

const THRESHOLDS = Object.freeze({
  "png-sequence": Object.freeze({
    rgbMae: 0,
    alphaMae: 0,
    maxChannelError: 0,
    minForegroundPixels: 0,
    maxTotalMs: 10_000
  }),
  gif: Object.freeze({
    rgbMae: 18,
    alphaMae: 0,
    maxChannelError: 180,
    minForegroundPixels: 0,
    maxTotalMs: 10_000
  }),
  webm: Object.freeze({
    rgbMae: 14,
    alphaMae: 14,
    maxChannelError: 180,
    minForegroundPixels: 0,
    maxTotalMs: 10_000
  }),
  mp4: Object.freeze({
    rgbMae: 16,
    alphaMae: 0,
    maxChannelError: 180,
    minForegroundPixels: 0,
    maxTotalMs: 10_000
  })
});

function constant(value) {
  return { mode: "constant", value };
}

function transform(positionX = 3, positionY = 2) {
  return {
    anchorPoint: constant({ x: 0, y: 0, z: 0 }),
    position: constant({ x: positionX, y: positionY, z: 0 }),
    scale: constant({ x: 94, y: 92, z: 100 }),
    rotation: constant({ x: 0, y: 0, z: 2 })
  };
}

function circleCoverage() {
  const data = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const distance = Math.hypot(
        (x + 0.5) / WIDTH - 0.5,
        (y + 0.5) / HEIGHT - 0.5
      );
      data[y * WIDTH + x] = distance < 0.41 ? 255 : distance < 0.44 ? 128 : 0;
    }
  }
  return { width: WIDTH, height: HEIGHT, data, rowOrder: "top-to-bottom" };
}

function inputKind(effect) {
  if (effect.sourceId.startsWith("T")) return "text";
  if (effect.sourceId.startsWith("V") || effect.sourceId.startsWith("D")) return "vector";
  return "media";
}

function layerType(kind) {
  return kind === "text" ? "text" : kind === "vector" ? "svg" : "image";
}

function makeLayer(id, kind, effect, options = {}) {
  const masks = options.masked === false ? [] : [{
    id: "mask.real",
    name: "real circular coverage",
    enabled: true,
    mode: "add",
    inverted: false,
    path: constant(circleCoverage()),
    opacity: constant(0.9),
    feather: constant({ x: 0, y: 0 })
  }];
  const common = {
    id,
    type: layerType(kind),
    name: id,
    visible: id !== "secondary",
    locked: false,
    solo: false,
    startTime: 0,
    endTime: DURATION + 0.5,
    inPoint: 0,
    outPoint: DURATION + 0.5,
    zIndex: id === "secondary" ? 0 : 1,
    transform: options.transformed === false ? transform(0, 0) : transform(),
    opacity: constant(id === "secondary" ? 0.72 : 0.84),
    blendMode: "normal",
    masks: id === "secondary" ? [] : masks,
    effects: effect === undefined ? [] : [effect],
    properties: kind === "text"
      ? { text: "FX中文", fontFamily: "fixture", fontSize: 18 }
      : kind === "vector" ? { svg: "real-path-provenance" } : { fit: "fill" }
  };
  return kind === "media"
    ? { ...common, source: { assetId: `${id}.asset` } }
    : common;
}

function effectInstance(effect) {
  return {
    id: `instance.${effect.sourceId}`,
    effectId: effect.effectId,
    version: effect.version,
    enabled: true,
    startTime: 0,
    endTime: EFFECT_END,
    mix: constant(1),
    maskId: "mask.real",
    params: {}
  };
}

function projectFixture(effect, source, secondary, controls = {}) {
  const instance = effectInstance(effect);
  if (controls.masked === false) delete instance.maskId;
  const kind = inputKind(effect);
  const primary = makeLayer("primary", kind, controls.effectEnabled === false ? undefined : instance, controls);
  if (primary.type === "text" && source.kind === "text") {
    primary.properties.text = source.text;
    primary.properties.fontFamily = source.font.family;
    primary.properties.fontSize = Math.max(
      1,
      ...source.glyphs.map((glyph) => glyph.bounds.height)
    );
  }
  const secondaryLayer = makeLayer("secondary", "media", undefined, { masked: false });
  const project = {
    schemaVersion: "1.2.0",
    engineVersion: "0.3.0",
    id: `evidence.${effect.sourceId}`,
    name: effect.effectId,
    width: WIDTH,
    height: HEIGHT,
    fps: FPS,
    duration: DURATION + 0.5,
    background: { type: "transparent" },
    colorSpace: "srgb",
    seed: 0x5a17c0de,
    assets: [],
    compositions: [{
      id: "main",
      name: "main",
      width: WIDTH,
      height: HEIGHT,
      duration: DURATION + 0.5,
      fps: FPS,
      layers: [secondaryLayer, primary]
    }],
    fonts: [],
    audioTracks: [],
    renderPresets: [],
    metadata: { timeContractVersion: "1.1.0" }
  };
  return {
    project,
    options: {
      rasterSources: new Map([["primary", source], ["secondary", secondary]]),
      secondaryLayerIds: new Map([[instance.id, "secondary"]]),
      coverageAssets: new Map([["builtin://brush/round", makeBrushCoverage()]])
    }
  };
}

function frameRequest(index) {
  return {
    frame: index,
    time: index / FPS,
    deltaTime: index === 0 ? 0 : 1 / FPS,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function differentPixels(first, second, tolerance = 2) {
  let count = 0;
  for (let offset = 0; offset < first.length; offset += 4) {
    if ([0, 1, 2, 3].some((channel) =>
      Math.abs(first[offset + channel] - second[offset + channel]) > tolerance)) count += 1;
  }
  return count;
}

function flattenBlack(frame) {
  const output = new Uint8Array(frame.length);
  for (let offset = 0; offset < frame.length; offset += 4) {
    const alpha = frame[offset + 3] / 255;
    const linear = [0, 1, 2].map((channel) => {
      const encoded = frame[offset + channel] / 255;
      return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
    });
    for (let channel = 0; channel < 3; channel += 1) {
      const value = linear[channel] * alpha;
      const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
      output[offset + channel] = Math.round(encoded * 255);
    }
    output[offset + 3] = 255;
  }
  return output;
}

function metrics(expected, actual, alphaFormat) {
  let rgbAbsolute = 0;
  let alphaAbsolute = 0;
  let maxChannelError = 0;
  let foregroundPixels = 0;
  let semiTransparentPixels = 0;
  for (let offset = 0; offset < expected.length; offset += 4) {
    let foreground = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(expected[offset + channel] - actual[offset + channel]);
      rgbAbsolute += difference;
      maxChannelError = Math.max(maxChannelError, difference);
      if (actual[offset + channel] > 8) foreground = true;
    }
    const alphaDifference = alphaFormat
      ? Math.abs(expected[offset + 3] - actual[offset + 3])
      : 0;
    alphaAbsolute += alphaDifference;
    maxChannelError = Math.max(maxChannelError, alphaDifference);
    if (alphaFormat) foreground = actual[offset + 3] > 8;
    if (foreground) foregroundPixels += 1;
    if (actual[offset + 3] > 0 && actual[offset + 3] < 255) semiTransparentPixels += 1;
  }
  const pixels = expected.length / 4;
  return {
    rgbMae: rgbAbsolute / (pixels * 3),
    alphaMae: alphaAbsolute / pixels,
    maxChannelError,
    foregroundPixels,
    semiTransparentPixels
  };
}

function preset(format) {
  return {
    id: `evidence-${format}`,
    name: format,
    format,
    quality: "final",
    settings: {
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      alpha: format === "png-sequence" || format === "webm",
      audio: false,
      crf: 0,
      ...(format === "webm" ? { videoCodec: "libvpx-vp9" } : {}),
      ...(format === "mp4" ? { videoCodec: "libx264" } : {})
    }
  };
}

async function decodeArtifact(format, outputPath) {
  const args = ["-v", "error"];
  if (format === "png-sequence") {
    args.push("-framerate", String(FPS), "-start_number", "0", "-i", resolve(outputPath, "frame-%08d.png"));
  } else {
    if (format === "webm") args.push("-c:v", "libvpx-vp9");
    args.push("-i", outputPath);
  }
  args.push("-frames:v", String(FRAME_COUNT), "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1");
  const started = performance.now();
  const result = await runProcess("ffmpeg", args);
  const decodeMs = performance.now() - started;
  const expectedBytes = FRAME_COUNT * WIDTH * HEIGHT * 4;
  if (result.stdout.byteLength !== expectedBytes) {
    throw new Error(`${format} decoded ${result.stdout.byteLength} bytes; expected ${expectedBytes}.`);
  }
  return { bytes: new Uint8Array(result.stdout), decodeMs };
}

async function artifactBytes(format, outputPath) {
  if (format !== "png-sequence") return (await stat(outputPath)).size;
  let total = 0;
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    total += (await stat(resolve(outputPath, `frame-${String(index).padStart(8, "0")}.png`))).size;
  }
  return total;
}

async function renderPreview(effect) {
  const kind = inputKind(effect);
  const sample = makeEffectTimeSample(effect.effectId, `evidence.${effect.sourceId}`, 0.5);
  const source = effect.sourceId === "T08"
    ? makeTextExtrudeCatalogFixture({
      effectId: effect.effectId,
      effectInstanceId: "instance.T08.source",
      text: "AΩ",
      width: WIDTH,
      height: HEIGHT,
      effectTime: 0.5,
      duration: 1,
      fps: FPS,
      projectStart: 0
    }).input.rasterInput.source
    : makeRealInputFixture(
      effect.effectId,
      kind,
      WIDTH,
      HEIGHT,
      false,
      "srgb",
      sample
    ).input.source;
  const secondary = makeRealInputFixture(
    effect.effectId,
    "media",
    WIDTH,
    HEIGHT,
    true,
    "srgb",
    sample
  ).input.source;
  const fixture = projectFixture(effect, source, secondary);
  const producer = createProjectFrameProducer(fixture.project, new Map(), fixture.options);
  const frames = [];
  for (let index = 0; index < FRAME_COUNT; index += 1) {
    frames.push(await producer(frameRequest(index)));
  }
  const deterministic = await producer(frameRequest(2));
  const deterministicThird = effect.sourceId === "T08"
    ? await producer(frameRequest(2))
    : deterministic;
  const untransformedFixture = projectFixture(effect, source, secondary, { transformed: false });
  const untransformed = await createProjectFrameProducer(
    untransformedFixture.project,
    new Map(),
    untransformedFixture.options
  )(frameRequest(2));
  const unmaskedFixture = projectFixture(effect, source, secondary, { masked: false });
  const unmasked = await createProjectFrameProducer(
    unmaskedFixture.project,
    new Map(),
    unmaskedFixture.options
  )(frameRequest(2));
  const noEffectFixture = projectFixture(effect, source, secondary, { effectEnabled: false });
  const noEffect = await createProjectFrameProducer(
    noEffectFixture.project,
    new Map(),
    noEffectFixture.options
  )(frameRequest(2));
  const goldenHashes = [];
  if (effect.sourceId === "T08") {
    for (const progress of PROGRESS) {
      const current = makeTextExtrudeCatalogFixture({
        effectId: effect.effectId,
        effectInstanceId: t08Golden.effectInstanceId,
        text: t08Golden.text,
        width: t08Golden.width,
        height: t08Golden.height,
        effectTime: progress * t08Golden.duration,
        duration: t08Golden.duration,
        fps: t08Golden.fps,
        projectStart: 73
      });
      goldenHashes.push(hashPixelSurface(effect.renderPixels(
        current.input,
        effect.defaultPreset,
        { time: current.time, seed: t08Golden.seed, quality: t08Golden.quality }
      )));
    }
  } else {
    for (const progress of PROGRESS) {
      const goldenTime = makeEffectTimeSample(
        effect.effectId,
        `golden.cpu.${effect.sourceId}`,
        progress,
        1,
        0,
        30,
        1 / 30
      );
      const goldenSource = makeRealInputFixture(
        effect.effectId,
        kind,
        golden.width,
        golden.height,
        false,
        "srgb",
        goldenTime
      );
      const goldenSecondary = makeRealInputFixture(
        effect.effectId,
        "media",
        golden.width,
        golden.height,
        true,
        "srgb",
        goldenTime
      );
      goldenHashes.push(hashPixelSurface(effect.renderPixels(
        goldenSource.surface,
        effect.defaultPreset,
        {
          time: goldenTime,
          seed: golden.seed,
          quality: golden.quality,
          rasterInput: goldenSource.input,
          secondaryRasterInput: goldenSecondary.input,
          secondary: goldenSecondary.surface,
          brushCoverage: makeBrushCoverage(),
          brushAssetId: "builtin://brush/round"
        }
      )));
    }
  }
  const expectedGolden = PROGRESS.map((progress) => effect.sourceId === "T08"
    ? t08Golden.frames[String(progress)]
    : golden.frames[effect.effectId][String(progress)]);
  return {
    frames,
    goldenHashes,
    featureChecks: {
      realRasterSource: true,
      sourceKind: source.kind,
      deterministic: sha256(deterministic) === sha256(frames[2])
        && sha256(deterministicThird) === sha256(frames[2]),
      transformDeltaPixels: differentPixels(frames[2], untransformed),
      maskDeltaPixels: differentPixels(frames[2], unmasked),
      effectDeltaPixels: differentPixels(frames[2], noEffect),
      alphaPixels: frames.reduce((count, frame) => {
        for (let offset = 3; offset < frame.length; offset += 4) {
          if (frame[offset] > 0 && frame[offset] < 255) count += 1;
        }
        return count;
      }, 0),
      textGlyphCoverage: effect.sourceId.startsWith("T") ? source.kind === "text" && source.glyphs.length > 0 : null,
      dualInput: effect.sourceId.startsWith("C") || effect.sourceId.startsWith("H")
        ? secondary.kind === "image" || secondary.kind === "video" : null,
      goldenSemantics: goldenHashes.every((hash, index) => hash === expectedGolden[index]),
      goldenDistinctFrames: new Set(expectedGolden).size,
      previewDistinctFrames: new Set(frames.map(sha256)).size
      ,
      t08Consumer: effect.sourceId === "T08" ? {
        input: "TextExtrude3DRasterInput",
        unicodeText: source.kind === "text" ? source.text : null,
        threeRunDeterministic: sha256(deterministicThird) === sha256(frames[2]),
        cpuGoldenFrames: goldenHashes.length,
        webglGoldenFrames: Object.keys(t08WebglGolden.frames).length,
        webglDistinctFrames: new Set(Object.values(t08WebglGolden.frames)).size,
        timeContractVersion: t08Golden.timeContractVersion
      } : null
    }
  };
}

await mkdir(outputRoot, { recursive: true });
await mkdir(resolve(evidencePath, ".."), { recursive: true });
const evidence = {
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  contracts: {
    time: "1.1.0",
    raster: "1.0.0",
    colorBackend: "1.0.0"
  },
  dimensions: { width: WIDTH, height: HEIGHT, fps: FPS },
  sampledProgress: PROGRESS,
  thresholds: THRESHOLDS,
  effects: []
};

for (const [slotIndex, effect] of P0_EFFECTS.entries()) {
  const preview = await renderPreview(effect);
  const effectEvidence = {
    slot: slotIndex + 1,
    sourceId: effect.sourceId,
    effectId: effect.effectId,
    version: effect.version,
    featureChecks: preview.featureChecks,
    formats: []
  };
  for (const format of FORMATS) {
    const effectDirectory = resolve(outputRoot, effect.sourceId, format);
    await mkdir(effectDirectory, { recursive: true });
    const outputPath = format === "png-sequence"
      ? effectDirectory
      : resolve(effectDirectory, `${effect.sourceId}.${format}`);
    const encodeStarted = performance.now();
    await exportFixedFrames({
      preset: preset(format),
      duration: DURATION,
      outputPath,
      colorSpace: "srgb",
      renderFrame(request) {
        return preview.frames[request.frame];
      }
    });
    const encodeMs = performance.now() - encodeStarted;
    const decoded = await decodeArtifact(format, outputPath);
    const fileBytes = await artifactBytes(format, outputPath);
    const threshold = THRESHOLDS[format];
    const alphaFormat = format === "png-sequence" || format === "webm";
    const cells = [];
    for (let index = 0; index < FRAME_COUNT; index += 1) {
      const start = index * WIDTH * HEIGHT * 4;
      const actual = decoded.bytes.slice(start, start + WIDTH * HEIGHT * 4);
      const expected = alphaFormat ? preview.frames[index] : flattenBlack(preview.frames[index]);
      const measured = metrics(expected, actual, alphaFormat);
      const pass = measured.rgbMae <= threshold.rgbMae
        && measured.alphaMae <= threshold.alphaMae
        && measured.maxChannelError <= threshold.maxChannelError
        && measured.foregroundPixels >= threshold.minForegroundPixels;
      cells.push({
        progress: PROGRESS[index],
        projectTime: index / FPS,
        goldenHash: preview.goldenHashes[index],
        expectedBlank: metrics(expected, expected, alphaFormat).foregroundPixels === 0,
        previewSha256: sha256(expected),
        decodedSha256: sha256(actual),
        ...measured,
        pass
      });
    }
    const totalMs = encodeMs + decoded.decodeMs;
    const foregroundCells = cells.filter((cell) => cell.foregroundPixels > 0).length;
    const decodedDistinctFrames = new Set(cells.map((cell) => cell.decodedSha256)).size;
    effectEvidence.formats.push({
      format,
      alphaConclusion: alphaFormat ? "preserved-and-compared" : "linear-black-flattened-before-encode",
      encodeMs,
      decodeMs: decoded.decodeMs,
      totalMs,
      realtimeMultiple: DURATION / (totalMs / 1000),
      fileBytes,
      threshold,
      cells,
      foregroundCells,
      decodedDistinctFrames,
      pass: totalMs <= threshold.maxTotalMs
        && foregroundCells > 0
        && (preview.featureChecks.goldenDistinctFrames === 1 || decodedDistinctFrames > 1)
        && cells.every((cell) => cell.pass)
    });
  }
  effectEvidence.pass = effectEvidence.featureChecks.deterministic
    && effectEvidence.featureChecks.transformDeltaPixels > 0
    && effectEvidence.featureChecks.maskDeltaPixels > 0
    && effectEvidence.featureChecks.effectDeltaPixels > 0
    && effectEvidence.featureChecks.alphaPixels > 0
    && effectEvidence.featureChecks.goldenSemantics
    && effectEvidence.formats.every((format) => format.pass);
  evidence.effects.push(effectEvidence);
  process.stdout.write(`${effect.sourceId} ${effectEvidence.pass ? "PASS" : "FAIL"}\n`);
}

const formatSummary = Object.fromEntries(FORMATS.map((format) => {
  const rows = evidence.effects.map((effect) => effect.formats.find((entry) => entry.format === format));
  return [format, {
    effects: rows.length,
    frames: rows.reduce((sum, row) => sum + row.cells.length, 0),
    totalEncodeMs: rows.reduce((sum, row) => sum + row.encodeMs, 0),
    totalDecodeMs: rows.reduce((sum, row) => sum + row.decodeMs, 0),
    totalFileBytes: rows.reduce((sum, row) => sum + row.fileBytes, 0),
    minimumRealtimeMultiple: Math.min(...rows.map((row) => row.realtimeMultiple)),
    maximumRgbMae: Math.max(...rows.flatMap((row) => row.cells.map((cell) => cell.rgbMae))),
    maximumAlphaMae: Math.max(...rows.flatMap((row) => row.cells.map((cell) => cell.alphaMae))),
    pass: rows.every((row) => row.pass)
  }];
}));
evidence.summary = {
  effects: evidence.effects.length,
  timepointsPerEffect: FRAME_COUNT,
  formatsPerEffect: FORMATS.length,
  matrixCells: evidence.effects.reduce((sum, effect) =>
    sum + effect.formats.reduce((formatSum, format) => formatSum + format.cells.length, 0), 0),
  passedCells: evidence.effects.reduce((sum, effect) =>
    sum + effect.formats.reduce((formatSum, format) =>
      formatSum + format.cells.filter((cell) => cell.pass).length, 0), 0),
  formatSummary,
  pass: evidence.effects.length === 40
    && evidence.effects.every((effect) => effect.pass)
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
if (!evidence.summary.pass) {
  throw new Error(`S5R export evidence failed: ${evidence.summary.passedCells}/${evidence.summary.matrixCells} cells.`);
}
process.stdout.write(`Wrote ${evidence.summary.matrixCells} passing cells to ${evidencePath}\n`);
