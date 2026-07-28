import { chromium } from "playwright-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { addAssetToProject, importMedia, runProcess } from "@codemotion/exporter";
import { createStarterProject } from "@codemotion/editor";
import { saveProject } from "@codemotion/schema";

const baseUrl = process.env.CMFX_EDITOR_URL ?? "http://127.0.0.1:4174";
const root = resolve(import.meta.dirname, "../../../tmp/stage-6-browser");
const input = resolve(root, "input");
const media = resolve(import.meta.dirname, "../../../tmp/stage-6-media");
const screenshots = resolve(root, "screenshots");
await mkdir(input, { recursive: true });
await mkdir(screenshots, { recursive: true });

const imagePath = resolve(input, "browser.png");
const audioPath = resolve(input, "browser.wav");
const videoPath = resolve(input, "browser.mp4");
const tamperedImagePath = resolve(input, "browser-tampered.png");
await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0xe95f3c:s=32x24:d=0.4", "-frames:v", "1", imagePath]);
await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=550:duration=0.4", "-c:a", "pcm_s16le", audioPath]);
await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=s=32x24:r=24:d=0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0x4f7cff:s=32x24:d=0.4", "-frames:v", "1", tamperedImagePath]);
const image = await importMedia({ sourcePath: imagePath, claimedMime: "image/png", allowedRoots: [input], storageDirectory: media });
const audio = await importMedia({ sourcePath: audioPath, claimedMime: "audio/wav", allowedRoots: [input], storageDirectory: media });
const video = await importMedia({ sourcePath: videoPath, claimedMime: "video/mp4", allowedRoots: [input], storageDirectory: media });
const tamperedImage = await importMedia({ sourcePath: tamperedImagePath, claimedMime: "image/png", allowedRoots: [input], storageDirectory: media });
let project = createStarterProject("阶段6浏览器", 32, 24, 24);
project = addAssetToProject(addAssetToProject(addAssetToProject(addAssetToProject(project, image), audio), video), tamperedImage);
project.compositions[0].layers = [{
  ...project.compositions[0].layers[0],
  id: "layer.browser.media",
  name: "Browser referenced image",
  type: "image",
  source: { assetId: image.asset.id },
  properties: { fit: "fill" }
}];
project.audioTracks = [{
  id: "track.browser.audio",
  assetId: audio.asset.id,
  startTime: 0,
  endTime: project.duration,
  volume: { mode: "constant", value: 1 }
}];
project.assets.push({
  id: "asset_missing_stage6",
  type: "image",
  uri: `media://${"f".repeat(64)}.png`,
  hash: `sha256:${"f".repeat(64)}`,
  metadata: { mime: "image/png", bytes: 128, duration: 0, width: 32, height: 24, codec: "png", decodeVerified: true }
});
const envelope = JSON.stringify({ savedAt: Date.now(), projectJson: saveProject(project, { space: 0 }) });
await writeFile(tamperedImage.storedPath, Buffer.from("browser integrity tamper"));

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader"]
});
const errors = [];
const apiEvents = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => { if (response.url().includes("/api/editor-exports")) apiEvents.push(`${response.request().method()} ${response.status()} ${response.url()}`); });
await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.evaluate((value) => localStorage.setItem("codemotion.editor.autosave.v1", value), envelope);
await page.reload({ waitUntil: "networkidle" });
await page.locator(".recovery-bar .text-button").click();
await page.locator(".render-button").click();
await page.getByText("真实 exporter 已连接").waitFor();
await page.locator(".render-field input[type=number]").nth(2).fill("24");
await page.locator(".render-field input[type=number]").nth(3).fill("0.1");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exportFormat(label) {
  const formatIndex = { PNG: 0, GIF: 1, WEBM: 2, MP4: 3 }[label];
  await page.locator(".format-segment button").nth(formatIndex).click();
  const audioToggle = page.locator(".toggle-field input").nth(1);
  if (label === "WEBM" || label === "MP4") await audioToggle.check();
  const before = await page.locator(".task-row").count();
  await page.locator(".export-start").click();
  await page.waitForTimeout(700);
  if (await page.locator(".task-row").count() <= before) {
    const alert = await page.locator(".render-alert").count() ? await page.locator(".render-alert").textContent() : "none";
    const validation = await page.locator(".validation-list").count() ? await page.locator(".validation-list").textContent() : "none";
    throw new Error(`${label} task was not accepted; alert=${JSON.stringify(alert)} validation=${JSON.stringify(validation)} api=${JSON.stringify(apiEvents)}`);
  }
  await page.waitForFunction((count) => {
    const rows = document.querySelectorAll(".task-row");
    return rows.length > count && rows[0]?.textContent?.includes("完成");
  }, before, { timeout: 30_000 });
  const task = page.locator(".task-row").first();
  assert((await task.textContent())?.includes("100%"), `${label} did not report real 100% progress.`);
  const downloadLink = page.locator(".task-actions a");
  const downloadHref = await downloadLink.getAttribute("href");
  assert(downloadHref, `${label} download URL is missing.`);
  const downloadEvent = page.waitForEvent("download");
  await downloadLink.click();
  const download = await downloadEvent;
  const downloadResponse = await page.request.get(new URL(downloadHref, baseUrl).href);
  const expectedContentType = label === "PNG" ? "application/zip"
    : label === "GIF" ? "image/gif"
      : label === "WEBM" ? "video/webm" : "video/mp4";
  assert(downloadResponse.headers()["content-type"] === expectedContentType, `${label} content type was incorrect.`);
  assert(downloadResponse.headers()["content-disposition"]?.includes("filename*=UTF-8''"), `${label} UTF-8 filename was not encoded safely.`);
  const path = await download.path();
  assert(path, `${label} did not produce a download.`);
  const data = await readFile(path);
  assert(data.byteLength > 0, `${label} download is empty.`);
  if (label === "PNG") {
    assert(data.subarray(0, 4).toString("hex") === "504b0304", "PNG sequence download is not a ZIP.");
  } else {
    const probe = JSON.parse((await runProcess("ffprobe", ["-v", "error", "-show_streams", "-of", "json", path])).stdout.toString("utf8"));
    assert(probe.streams?.some((stream) => stream.codec_type === "video"), `${label} download has no video stream.`);
  }
}

for (const label of ["PNG", "GIF", "WEBM", "MP4"]) await exportFormat(label);
assert(await page.locator(".task-row").count() >= 4, "Render history did not retain completed tasks.");
assert((await page.locator(".task-logs").first().textContent())?.includes("真实编码"), "Task detail did not expose real encoder logs.");

const taskCountBeforeTamper = await page.locator(".task-row").count();
const tamperedProject = structuredClone(project);
tamperedProject.compositions[0].layers[0].source.assetId = tamperedImage.asset.id;
const integrityResponse = await page.evaluate(async ({ project, settings }) => {
  const response = await fetch("/api/editor-exports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ project, settings })
  });
  return { status: response.status, body: await response.json() };
}, {
  project: tamperedProject,
  settings: { format: "png-sequence", width: 32, height: 24, fps: 24, duration: 0.1, alpha: true, audio: false }
});
assert(integrityResponse.status === 400, "Tampered project media was accepted by the browser API.");
assert(integrityResponse.body.error === "工程媒体完整性校验失败。", "Browser integrity error was not sanitized.");
await page.waitForTimeout(700);
assert(await page.locator(".task-row").count() === taskCountBeforeTamper, "Tampered media created a browser task record.");
assert(await page.locator(".task-status.queued, .task-status.running").count() === 0, "Tampered media showed fake queue or progress state.");
await page.getByText("真实 exporter 已连接").waitFor();

assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Desktop render center has horizontal overflow.");
await page.screenshot({ path: resolve(screenshots, "render-center-desktop.png"), fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(100);
const mobileOverflow = await page.evaluate(() => ({
  viewport: innerWidth,
  page: document.documentElement.scrollWidth,
  elements: [...document.querySelectorAll("*")].map((element) => {
    const box = element.getBoundingClientRect();
    return { tag: element.tagName, className: element.className, left: box.left, right: box.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  }).filter((item) => item.right > innerWidth + 1 || item.left < -1 || item.scrollWidth > item.clientWidth + 1).slice(0, 12)
}));
assert(mobileOverflow.page <= mobileOverflow.viewport, `Mobile render center has horizontal overflow: ${JSON.stringify(mobileOverflow)}`);
const overlap = await page.evaluate(() => {
  const left = document.querySelector(".export-settings")?.getBoundingClientRect();
  const right = document.querySelector(".render-main")?.getBoundingClientRect();
  return Boolean(left && right && Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
    && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1);
});
assert(!overlap, "Mobile export settings and task center overlap.");
await page.screenshot({ path: resolve(screenshots, "render-center-mobile.png"), fullPage: true });
await browser.close();
const unexpectedErrors = errors.filter((message) =>
  !(message.includes("Failed to load resource") && apiEvents.some((event) => event.startsWith("POST 400 "))));
assert(unexpectedErrors.length === 0, `Browser console errors: ${unexpectedErrors.join(" | ")}`);
console.log(JSON.stringify({ formats: ["png-sequence", "gif", "webm", "mp4"], expectedValidationResponses: apiEvents.filter((event) => event.startsWith("POST 400 ")).length, unexpectedErrors, screenshots }, null, 2));
