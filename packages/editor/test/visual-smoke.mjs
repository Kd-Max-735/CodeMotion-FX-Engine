import { chromium } from "playwright-core";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadProject, saveProject } from "@codemotion/schema";

const baseUrl = process.env.CMFX_EDITOR_URL ?? "http://127.0.0.1:4174";
const outputDir = resolve(import.meta.dirname, "../../../tmp/stage-4-visual");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader"]
});

const consoleErrors = [];
async function pageAt(width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  return page;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertButtonTextFits(page, label) {
  const overflowing = await page.locator("button:visible").evaluateAll((buttons) => buttons
    .filter((button) => button.scrollWidth > button.clientWidth + 1)
    .map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "button"));
  assert(overflowing.length === 0, `${label} button text overflow: ${overflowing.join(", ")}`);
}

async function canvasFingerprint(page) {
  return page.locator("canvas[aria-label='WebGL 合成预览']").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let offset = 0; offset < pixels.length; offset += 97) hash = Math.imul(hash ^ pixels[offset], 16777619);
    return hash >>> 0;
  });
}

const desktop = await pageAt(1440, 900);
assert(await desktop.locator("h1").first().textContent() === "开始创作", "Workbench did not render.");
assert(await desktop.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Workbench has horizontal overflow.");
await assertButtonTextFits(desktop, "Workbench");
await desktop.screenshot({ path: resolve(outputDir, "workbench-desktop.png"), fullPage: true });
await desktop.locator(".project-tile.featured").click();
await desktop.locator(".backend-status.ok").waitFor({ timeout: 10_000 });

const canvasCheck = await desktop.locator("canvas[aria-label='WebGL 合成预览']").evaluate((canvas) => {
  const context = canvas.getContext("2d");
  if (!context) return { nonBlank: false, samples: 0 };
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let samples = 0;
  for (let offset = 0; offset < pixels.length; offset += 400) if (pixels[offset + 3] > 0) samples += 1;
  return { nonBlank: samples > 20, samples };
});
assert(canvasCheck.nonBlank, "Core WebGL preview canvas is blank.");
const canvasBeforeEffect = await canvasFingerprint(desktop);
const accentRow = desktop.locator(".layer-row").filter({ hasText: "强调图形" });
await accentRow.getByLabel("隐藏图层").click();
await desktop.waitForFunction((before) => {
  const canvas = document.querySelector("canvas[aria-label='WebGL 合成预览']");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return false;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  for (let offset = 0; offset < pixels.length; offset += 97) hash = Math.imul(hash ^ pixels[offset], 16777619);
  return (hash >>> 0) !== before;
}, canvasBeforeEffect);
const canvasWithAccentHidden = await canvasFingerprint(desktop);
assert(canvasWithAccentHidden !== canvasBeforeEffect, "Hidden core layer did not change the WebGL preview.");
await accentRow.getByLabel("显示图层").click();
await desktop.waitForFunction((expected) => {
  const canvas = document.querySelector("canvas[aria-label='WebGL 合成预览']");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return false;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let hash = 2166136261;
  for (let offset = 0; offset < pixels.length; offset += 97) hash = Math.imul(hash ^ pixels[offset], 16777619);
  return (hash >>> 0) === expected;
}, canvasBeforeEffect);
await desktop.locator(".save-indicator").filter({ hasText: "已自动保存" }).waitFor({ timeout: 10_000 });
assert(await desktop.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Editor has horizontal overflow.");
const desktopRegionsOverlap = await desktop.evaluate(() => {
  const boxes = [".left-panel", ".canvas-workspace", ".right-panel", ".timeline-panel"].map((selector) => document.querySelector(selector)?.getBoundingClientRect());
  const overlap = (a, b) => a && b && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  return boxes.some((box, index) => boxes.slice(index + 1).some((other) => overlap(box, other)));
});
assert(!desktopRegionsOverlap, "Editor major regions overlap.");
const visibleTimelineRows = await desktop.locator(".timeline-layer-label").evaluateAll((rows) => rows.filter((row) => row.getBoundingClientRect().height >= 30).length);
assert(visibleTimelineRows >= 3, `Expected visible timeline rows, found ${visibleTimelineRows}.`);
await assertButtonTextFits(desktop, "Editor");

const parameterInput = desktop.locator(".schema-field input[type='number']").first();
const parameterValue = String(Number(await parameterInput.inputValue()) + 1);
await desktop.evaluate(() => {
  window.__cmfxQa = {};
  const input = document.querySelector(".schema-field input[type='number']");
  const status = document.querySelector(".save-indicator");
  let started;
  input?.addEventListener("input", () => { started ??= performance.now(); }, { capture: true });
  const observer = new MutationObserver(() => {
    if (started !== undefined && status?.textContent?.includes("有改动")) {
      window.__cmfxQa.parameter = performance.now() - started;
      observer.disconnect();
    }
  });
  if (status) observer.observe(status, { childList: true, subtree: true, characterData: true });
});
await parameterInput.press("ArrowUp");
await desktop.waitForFunction((expected) => document.querySelector(".schema-field input[type='number']")?.value === expected && typeof window.__cmfxQa?.parameter === "number", parameterValue);
const parameterLatency = await desktop.evaluate(() => window.__cmfxQa.parameter);
assert(parameterLatency < 100, `Parameter feedback took ${parameterLatency.toFixed(1)}ms.`);

await desktop.evaluate(() => {
  const input = document.querySelector("input[aria-label='时间轴播放头']");
  const transport = document.querySelector(".transport b");
  const playhead = document.querySelector(".playhead");
  let started;
  input?.addEventListener("input", () => { started ??= performance.now(); }, { capture: true });
  const observer = new MutationObserver(() => {
    if (started !== undefined && transport?.textContent === "00:02:00" && playhead?.getAttribute("style")?.includes("25%")) {
      window.__cmfxQa.timeline = performance.now() - started;
      observer.disconnect();
    }
  });
  if (transport) observer.observe(transport, { childList: true, subtree: true, characterData: true });
  if (playhead) observer.observe(playhead, { attributes: true, attributeFilter: ["style"] });
});
await desktop.locator("input[aria-label='时间轴播放头']").fill("2");
await desktop.waitForFunction(() => typeof window.__cmfxQa?.timeline === "number");
const timelineLatency = await desktop.evaluate(() => window.__cmfxQa.timeline);
assert(timelineLatency < 200, `Timeline feedback took ${timelineLatency.toFixed(1)}ms.`);
await desktop.locator(".panel-tabs button").filter({ hasText: "特效" }).click();
await desktop.locator(".effect-item").dragTo(desktop.locator(".canvas-stage"));
assert(await desktop.locator(".stack-row").count() === 1, "Effect drag-and-drop did not update the selected layer stack.");
await desktop.locator(".save-indicator").filter({ hasText: "有改动" }).waitFor();
await desktop.waitForFunction(() => document.querySelector(".canvas-footer span:nth-child(2)")?.textContent?.includes("6 Draw Calls"));
const canvasAfterEffect = await canvasFingerprint(desktop);
assert(canvasAfterEffect !== canvasBeforeEffect, "The project wrapper was not mapped to the internal WebGL validation pass.");
await desktop.locator(".save-indicator").filter({ hasText: "已自动保存" }).waitFor({ timeout: 10_000 });
const savedProjectJson = await desktop.evaluate(() => {
  const envelope = JSON.parse(localStorage.getItem("codemotion.editor.autosave.v1"));
  return envelope.projectJson;
});
const savedProject = loadProject(savedProjectJson);
const savedAccentLayer = savedProject.compositions[0].layers.find((layer) => layer.id === "layer.accent");
const savedEffect = savedAccentLayer.effects[0];
assert(savedAccentLayer.visible === true, "Autosave retained a temporarily hidden core layer.");
assert(savedEffect?.effectId === "fx.lab.pipelineValidation", `Unexpected autosaved effect ID: ${savedEffect?.effectId}`);
assert(savedEffect?.enabled === true && savedEffect?.params?.strength?.value === 1, "Autosaved pipeline effect lost state.");

await desktop.reload({ waitUntil: "networkidle" });
await desktop.locator(".recovery-bar").waitFor();
await desktop.locator(".recovery-bar .text-button").click();
await desktop.locator(".backend-status.ok").waitFor({ timeout: 10_000 });
await desktop.locator(".layer-row").filter({ hasText: "强调图形" }).locator(".layer-name").click();
assert(await desktop.locator(".stack-row").count() === 1, "Recovered editor did not retain the pipeline effect.");
await desktop.locator(".save-indicator.saved").waitFor({ timeout: 10_000 });
const recoveredSaveText = await desktop.locator(".save-indicator").textContent();
const recoveredErrorText = await desktop.locator(".error-strip").count() > 0 ? await desktop.locator(".error-strip").textContent() : "none";
assert(recoveredSaveText?.includes("已自动保存"), `Recovered editor save state was ${JSON.stringify(recoveredSaveText)}; error: ${recoveredErrorText}`);
await desktop.locator("input[aria-label='时间轴播放头']").fill("2");
await desktop.waitForFunction(() => document.querySelector(".transport b")?.textContent === "00:02:00");
await desktop.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const recoveredDrawCalls = await desktop.locator(".canvas-footer span:nth-child(2)").textContent();
const recoveredBackend = await desktop.locator(".backend-status").first().textContent();
const recoveredCanvasError = await desktop.locator(".canvas-error").count() > 0 ? await desktop.locator(".canvas-error").textContent() : "none";
assert(recoveredDrawCalls?.includes("6 Draw Calls"), `Recovered preview reported ${JSON.stringify(recoveredDrawCalls)}; backend: ${recoveredBackend}; error: ${recoveredCanvasError}`);
const canvasAfterRecovery = await canvasFingerprint(desktop);
assert(canvasAfterRecovery === canvasAfterEffect, "Recovered pipeline preview differs from the autosaved preview.");
assert(await desktop.locator(".error-strip").count() === 0, "Recovered editor displayed an unexpected error strip.");
const downloadPromise = desktop.waitForEvent("download");
await desktop.locator(".export-button").click();
const download = await downloadPromise;
const downloadPath = await download.path();
assert(downloadPath, "Project download did not produce a file.");
const downloadedJson = await readFile(downloadPath, "utf8");
const downloadedProject = loadProject(downloadedJson);
assert(downloadedProject.compositions[0].layers.find((layer) => layer.id === "layer.accent").effects[0]?.effectId === "fx.lab.pipelineValidation", "Downloaded project lost the pipeline effect.");
assert(saveProject(downloadedProject) === downloadedJson, "Downloaded project serialization is not deterministic.");
await desktop.screenshot({ path: resolve(outputDir, "editor-desktop.png"), fullPage: true });
await desktop.getByTitle("特效实验室").click();
await desktop.locator(".lab-preview .backend-status, .lab-header .backend-status.ok").first().waitFor({ timeout: 10_000 }).catch(() => {});
assert(await desktop.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Effect lab has horizontal overflow.");
await assertButtonTextFits(desktop, "Effect lab");
const shaderEditor = desktop.locator("textarea[aria-label='Shader 编辑器']");
const validShader = await shaderEditor.inputValue();
await shaderEditor.fill("#version 300 es\nthis is not valid glsl");
await desktop.locator(".lab-params .primary-command").click();
assert(await desktop.locator(".test-result").textContent() === "BLOCKED", "Invalid Shader was not rejected by the real WebGL compiler.");
await shaderEditor.fill(validShader);
await desktop.locator(".lab-params .primary-command").click();
assert(await desktop.locator(".test-result").textContent() === "PASS", "Valid Shader did not execute in the real WebGL pipeline.");
await desktop.screenshot({ path: resolve(outputDir, "lab-desktop.png"), fullPage: true });
await desktop.close();

const mobile = await pageAt(390, 844);
assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile workbench has horizontal overflow.");
await assertButtonTextFits(mobile, "Mobile workbench");
await mobile.locator(".project-tile.featured").click();
await mobile.locator(".backend-status.ok").waitFor({ timeout: 10_000 });
assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile editor has horizontal overflow.");
await assertButtonTextFits(mobile, "Mobile editor");
await mobile.screenshot({ path: resolve(outputDir, "editor-mobile.png"), fullPage: true });
await mobile.close();

const corruptRecovery = await pageAt(1024, 768);
await corruptRecovery.evaluate(() => localStorage.setItem("codemotion.editor.autosave.v1", "{not-json"));
await corruptRecovery.reload({ waitUntil: "networkidle" });
await corruptRecovery.locator(".recovery-bar .text-button").click();
const recoveryError = await corruptRecovery.locator(".error-strip").textContent();
assert(recoveryError?.includes("自动保存恢复失败"), "Corrupt autosave did not report a recoverable error.");
assert(await corruptRecovery.locator("h1").first().textContent() === "开始创作", "Corrupt autosave replaced the current workbench.");
assert(await corruptRecovery.evaluate(() => localStorage.getItem("codemotion.editor.autosave.v1")) === "{not-json", "Corrupt autosave was discarded without user action.");
await corruptRecovery.close();

await browser.close();
assert(consoleErrors.length === 0, `Browser console errors: ${consoleErrors.join(" | ")}`);
console.log(JSON.stringify({ canvasCheck, parameterLatency, timelineLatency, consoleErrors, outputDir }, null, 2));
