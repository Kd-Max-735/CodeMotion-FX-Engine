import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
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
    console.log(`WEBGL_GOLDENS=${JSON.stringify({
      schemaVersion: "1.0.0",
      runtime: outcome.result.runtime,
      frames: outcome.result.goldens
    })}`);
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
  console.log(JSON.stringify({
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
    qualityChecks: Object.keys(outcome.result.quality).length * 3,
    resourceKinds: Object.keys(outcome.result.resources).length,
    resourcesBalanced: Object.values(outcome.result.resources).every(
      (entry) => entry.created === entry.deleted && entry.duplicateDeletes === 0
    ),
    benchmarkMedianMaxMs: Math.max(...medians)
  }, null, 2));
} finally {
  await browser?.close();
  vite.kill();
}
