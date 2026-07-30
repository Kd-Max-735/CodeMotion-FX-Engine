import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const exporterRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(exporterRoot, "../..");
const effectsRoot = resolve(repoRoot, "packages/effects-3d");
const expected = JSON.parse(await readFile(
  resolve(effectsRoot, "test/fixtures/webgl-golden-frames.json"),
  "utf8"
));
const port = 4179;
const url = `http://127.0.0.1:${port}/preview.html`;
const vite = spawn(process.execPath, [
  resolve(repoRoot, "node_modules/vite/bin/vite.js"),
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
  "--strictPort"
], { cwd: effectsRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
  throw new Error(`T08 Vite server did not start.\n${serverLog}`);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.body.dataset.webglGoldens !== undefined);
  const official = await page.evaluate(() => ({
    webgl2: document.body.dataset.webgl2,
    resources: document.body.dataset.resources,
    frames: JSON.parse(document.body.dataset.webglGoldens),
    medianMs: Number(document.body.dataset.webglMedianMs)
  }));
  if (errors.length > 0) throw new Error(`T08 Edge errors: ${errors.join("; ")}`);
  if (official.webgl2 !== "true" || official.resources !== "balanced") {
    throw new Error("T08 Edge WebGL2/resources contract failed.");
  }
  if (new Set(Object.keys(official.frames)).size !== 5
    || !["0", "0.25", "0.5", "0.75", "1"].every((key) => key in official.frames)
    || new Set(Object.values(official.frames)).size !== 5) {
    throw new Error(`T08 Edge five-point semantics failed: ${JSON.stringify(official.frames)}.`);
  }

  const timepoints = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas.getContext("webgl2", { alpha: true, preserveDrawingBuffer: true });
    const slider = document.querySelector("input");
    return Object.fromEntries([0, 0.25, 0.5, 0.75, 1].map((progress) => {
      const runs = [];
      slider.value = String(progress);
      for (let run = 0; run < 3; run += 1) {
        slider.dispatchEvent(new Event("input"));
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let foregroundPixels = 0;
        for (let offset = 3; offset < pixels.length; offset += 4) {
          if (pixels[offset] > 0) foregroundPixels += 1;
        }
        runs.push({ hash: document.body.dataset.fingerprint, foregroundPixels });
      }
      return [String(progress), runs];
    }));
  });
  for (const [progress, runs] of Object.entries(timepoints)) {
    if (new Set(runs.map((run) => run.hash)).size !== 1
      || runs.some((run) => run.foregroundPixels === 0)) {
      throw new Error(`T08 Edge ${progress} failed non-empty three-run determinism.`);
    }
  }

  const texts = ["立体", "FX", "AΩ"];
  const unicode = {};
  for (const text of texts) {
    await page.selectOption("select", { label: text });
    unicode[text] = await page.evaluate(() => {
      const hashes = [];
      const slider = document.querySelector("input");
      slider.value = "0.5";
      for (let run = 0; run < 3; run += 1) {
        slider.dispatchEvent(new Event("input"));
        hashes.push(document.body.dataset.fingerprint);
      }
      return hashes;
    });
    if (new Set(unicode[text]).size !== 1) {
      throw new Error(`T08 Edge ${text} is not deterministic across three runs.`);
    }
  }
  if (new Set(Object.values(unicode).map((hashes) => hashes[0])).size !== texts.length) {
    throw new Error("T08 Edge Unicode inputs do not produce distinct WebGL results.");
  }
  console.log(JSON.stringify({
    browser: await page.evaluate(() => navigator.userAgent),
    renderer: await page.evaluate(() => {
      const gl = document.querySelector("canvas").getContext("webgl2");
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }),
    timeContractVersion: expected.timeContractVersion,
    frames: official.frames,
    distinctFrames: new Set(Object.values(official.frames)).size,
    timepoints,
    threeRunDeterministic: true,
    unicode,
    resources: official.resources,
    medianMs: official.medianMs,
    budgetMs: expected.budgetMs
  }, null, 2));
} finally {
  await browser?.close();
  vite.kill();
}
