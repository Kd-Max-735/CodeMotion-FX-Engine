import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "../..");
const port = 4176;
const url = `http://127.0.0.1:${port}/webgl-qa.html`;
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const vite = spawn(
  process.execPath,
  [
    resolve(repoRoot, "node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort"
  ],
  { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
);
let serverLog = "";
vite.stdout.on("data", (chunk) => { serverLog += String(chunk); });
vite.stderr.on("data", (chunk) => { serverLog += String(chunk); });

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Vite did not start.\n${serverLog}`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: edgePath,
    headless: true,
    args: [
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--disable-gpu-sandbox"
    ]
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => window.__CMFX_WEBGL_QA__ !== undefined || window.__CMFX_WEBGL_QA_ERROR__ !== undefined,
    undefined,
    { timeout: 120_000 }
  );
  const outcome = await page.evaluate(() => ({
    result: window.__CMFX_WEBGL_QA__,
    error: window.__CMFX_WEBGL_QA_ERROR__
  }));
  if (outcome.error) throw new Error(outcome.error);
  if (!outcome.result) throw new Error("Edge QA did not publish a result.");
  if (browserErrors.length > 0) throw new Error(`Edge page errors: ${browserErrors.join("; ")}`);
  if (outcome.result.failures.length > 0) {
    throw new Error(`WebGL QA failures:\n${outcome.result.failures.join("\n")}`);
  }

  if (process.argv.includes("--capture")) {
    const captured = {
      schemaVersion: "1.1.0",
      inputFixtureVersion: "real-raster-1.0.0",
      baselineReason: "EffectTimeSample 1.1 explicit effect-instance random isolation and real raster inputs",
      runtime: outcome.result.runtime,
      frames: outcome.result.goldens
    };
    const target = resolve(import.meta.dirname, "fixtures/webgl-golden-frames.json");
    await writeFile(target, `${JSON.stringify(captured, null, 2)}\n`, "utf8");
    console.log(`WEBGL_GOLDENS_WRITTEN=${target}`);
  } else {
    const fixture = JSON.parse(await readFile(
      resolve(import.meta.dirname, "fixtures/webgl-golden-frames.json"),
      "utf8"
    ));
    if (JSON.stringify(outcome.result.goldens) !== JSON.stringify(fixture.frames)) {
      throw new Error("Real WebGL2 Golden Frames differ from the reviewed fixture.");
    }
  }

  const medians = Object.values(outcome.result.performance).map((entry) => entry.medianMs);
  const report = {
    schemaVersion: "1.1.0",
    browser: outcome.result.runtime.userAgent,
    webgl: outcome.result.runtime.webglVersion,
    renderer: outcome.result.runtime.renderer,
    effects: Object.keys(outcome.result.goldens).length,
    goldenFrames: Object.values(outcome.result.goldens)
      .reduce((count, frames) => count + Object.keys(frames).length, 0),
    parameters: Object.values(outcome.result.perturbations)
      .reduce((count, entries) => count + Object.keys(entries).length, 0),
    semanticDistinctFrames: outcome.result.semanticDistinctFrames,
    maskChecks: outcome.result.masks.checked,
    alphaChecks: outcome.result.alpha.checked,
    deterministicChecks: outcome.result.deterministic.checked,
    instanceRandomChecks: outcome.result.instanceRandom.checked,
    instanceRandomThreeRunDeterministic:
      outcome.result.instanceRandom.threeRunDeterministic,
    instanceRandomStreamsDistinct: outcome.result.instanceRandom.streamsDistinct,
    colorSpaceChecks: outcome.result.colorSpaces,
    qualityChecks: Object.keys(outcome.result.quality).length * 3,
    resourceKinds: Object.keys(outcome.result.resources).length,
    resourcesBalanced: Object.values(outcome.result.resources).every(
      (entry) => entry.created === entry.deleted && entry.duplicateDeletes === 0
    ),
    benchmarkMedianMaxMs: Math.max(...medians),
    gpuMedianMaxMs: Math.max(...Object.values(outcome.result.performance).map((entry) => entry.gpuMedianMs)),
    onePercentLowFpsMin: Math.min(...Object.values(outcome.result.performance).map((entry) => entry.onePercentLowFps)),
    drawCallsMax: Math.max(...Object.values(outcome.result.performance).map((entry) => entry.drawCalls)),
    textureAllocationsMax: Math.max(...Object.values(outcome.result.performance).map((entry) => entry.textureAllocations)),
    estimatedVramMaxBytes: Math.max(...Object.values(outcome.result.performance).map((entry) => entry.estimatedVramBytes)),
    peakHeapMaxBytes: Math.max(...Object.values(outcome.result.performance).map((entry) => entry.peakHeapBytes)),
    firstFrameMaxMs: Math.max(...Object.values(outcome.result.performance).map((entry) => entry.firstFrameMs)),
    shaderCompileMaxMs: Math.max(...Object.values(outcome.result.performance).map((entry) => entry.shaderCompileMs)),
    performance: outcome.result.performance,
    resources: outcome.result.resources
  };
  await writeFile(
    resolve(import.meta.dirname, "fixtures/webgl-evidence.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8"
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  vite.kill();
}
