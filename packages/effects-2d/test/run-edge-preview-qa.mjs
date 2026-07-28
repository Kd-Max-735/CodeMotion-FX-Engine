import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const packageRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(packageRoot, "../..");
const port = 4177;
const url = `http://127.0.0.1:${port}/preview.html`;
const vite = spawn(process.execPath, [
  resolve(repoRoot, "node_modules/vite/bin/vite.js"),
  "--host",
  "127.0.0.1",
  "--port",
  String(port),
  "--strictPort"
], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelectorAll("article canvas").length === 40);
  const report = await page.evaluate(() => {
    const hash = (data) => {
      let value = 0x811c9dc5;
      for (const byte of data) {
        value ^= byte;
        value = Math.imul(value, 0x01000193);
      }
      return (value >>> 0).toString(16).padStart(8, "0");
    };
    return [...document.querySelectorAll("article")].map((card) => {
      const canvas = card.querySelector("canvas");
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      return {
        sourceId: card.id,
        effectId: card.querySelector("p").textContent.split(" · ")[0],
        hash: hash(pixels),
        nonEmpty: pixels.some((byte, index) => index % 4 === 3 && byte !== 0)
      };
    });
  });
  if (errors.length > 0) throw new Error(`Edge page errors: ${errors.join("; ")}`);
  if (report.length !== 40) throw new Error(`Expected 40 preview cards, received ${report.length}.`);
  const empty = report.filter((entry) => !entry.nonEmpty);
  if (empty.length > 0) throw new Error(`Empty previews: ${empty.map((entry) => entry.sourceId).join(",")}`);
  if (new Set(report.map((entry) => entry.hash)).size !== 40) {
    throw new Error("The 40 Edge preview fingerprints are not pairwise distinct.");
  }
  console.log(JSON.stringify({
    browser: await page.evaluate(() => navigator.userAgent),
    previews: report.length,
    nonEmpty: report.filter((entry) => entry.nonEmpty).length,
    distinct: new Set(report.map((entry) => entry.hash)).size
  }, null, 2));
} finally {
  await browser?.close();
  vite.kill();
}
