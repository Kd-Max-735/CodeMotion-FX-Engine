import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { addAssetToProject, importMedia, runProcess } from "@codemotion/exporter";
import { createStarterProject } from "@codemotion/editor";
import { GROUP_2_P0_BY_ID } from "@codemotion/effects-2d";
import { loadProject, saveProject } from "@codemotion/schema";

const baseUrl = process.env.CMFX_EDITOR_URL ?? "http://127.0.0.1:4174";
const root = resolve(import.meta.dirname, "../../../tmp/stage-7-browser");
const input = resolve(root, "input");
const media = resolve(import.meta.dirname, "../../../tmp/stage-6-media");
const screenshots = resolve(root, "screenshots");
const finalVideo = resolve(root, "ai-generated-final.mp4");
const evidencePath = resolve(root, "final-video-evidence.json");
await mkdir(input, { recursive: true });
await mkdir(screenshots, { recursive: true });

const imagePath = resolve(input, "planner.png");
const audioPath = resolve(input, "planner.wav");
const videoPath = resolve(input, "planner.mp4");
await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0x21c58b:s=64x36:d=0.5", "-frames:v", "1", imagePath]);
await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.8", "-c:a", "pcm_s16le", audioPath]);
await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x36:r=24:d=0.8", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
const image = await importMedia({ sourcePath: imagePath, claimedMime: "image/png", allowedRoots: [input], storageDirectory: media });
const audio = await importMedia({ sourcePath: audioPath, claimedMime: "audio/wav", allowedRoots: [input], storageDirectory: media });
const video = await importMedia({ sourcePath: videoPath, claimedMime: "video/mp4", allowedRoots: [input], storageDirectory: media });
let project = createStarterProject("Stage 7 Browser", 640, 360, 24);
project = addAssetToProject(addAssetToProject(addAssetToProject(project, image), audio), video);
const envelope = JSON.stringify({ savedAt: Date.now(), projectJson: saveProject(project, { space: 0 }) });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function fingerprint(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function rate(value) {
  const [numerator, denominator = "1"] = String(value).split("/").map(Number);
  return numerator / denominator;
}

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleErrors = [];
const requestBodies = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => consoleErrors.push(error.message));
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().endsWith("/api/ai-plans")) requestBodies.push(request.postData() ?? "");
});

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.evaluate((value) => localStorage.setItem("codemotion.editor.autosave.v1", value), envelope);
await page.reload({ waitUntil: "networkidle" });
await page.locator(".recovery-bar .text-button").click();
await page.locator(".brand-button").click();
await page.locator(".ai-draft-bar button").click();
await page.getByText("服务端 Provider 已连接").waitFor();
await page.getByLabel("动画规划文本").fill("结合参考画面、语音节奏和视频镜头，生成克制的六秒产品标题动画；保留素材事实，不补造事件。");
for (const checkbox of await page.locator(".ai-asset-option input").all()) await checkbox.check();
assert(await page.locator(".ai-asset-option input:checked").count() === 3, "All three verified media modalities were not selected.");
await page.locator(".ai-submit").click();
await Promise.race([
  page.locator(".ai-status.success").waitFor({ timeout: 300_000 }),
  page.locator(".ai-task-error").waitFor({ timeout: 300_000 }).then(async () => {
    throw new Error(`Live AI task failed: ${await page.locator(".ai-task-error").textContent()}`);
  })
]);

const completed = await page.evaluate(async () => {
  const response = await fetch("/api/ai-plans");
  return (await response.json()).tasks[0];
});
assert(completed.status === "completed", `Live task status was ${completed.status}.`);
assert(completed.result?.trace?.provider === "volcengine-ark", "Result did not come from the real server Provider.");
assert(completed.result?.trace?.modelId === "doubao-seed-2-0-lite-260428", "Unexpected model returned.");
assert(completed.result.understanding.images.length === 1, "Image understanding was not returned.");
assert(completed.result.understanding.audio.length === 1, "Audio understanding was not returned.");
assert(completed.result.understanding.video.length === 1, "Video understanding was not returned.");
assert(completed.result.storyboard.shots.length > 0, "Storyboard was empty.");
assert(completed.result.dsl.compositions[0].layers.length > 0, "DSL layers were empty.");
assert(completed.result.preview.frameHashes.length > 0, "Draft preview budget was empty.");
const generatedProject = loadProject(JSON.stringify(completed.result.dsl));
const generatedLayerIds = generatedProject.compositions.flatMap((composition) => composition.layers.map((layer) => layer.id));
const generatedEffectIds = [...new Set(generatedProject.compositions.flatMap((composition) =>
  composition.layers.flatMap((layer) => layer.effects.map((effect) => effect.effectId))))];
assert(generatedEffectIds.length > 0, "Generated DSL did not contain a model-selected effect.");
assert(generatedEffectIds.every((effectId) => GROUP_2_P0_BY_ID.has(effectId)), "Generated DSL contained a non-P0 effect.");
assert(generatedProject.assets.some((asset) => asset.type === "image"), "Generated DSL did not retain the image input.");
assert(generatedProject.assets.some((asset) => asset.type === "video"), "Generated DSL did not retain the video input.");
assert(completed.events.some((event) => event.phase === "validate"), "Real validation progress was not recorded.");
assert(completed.events.some((event) => event.phase === "upload" && event.loaded > 0 && event.total > 0), "Real byte upload progress was not recorded.");
assert(completed.events.some((event) => event.phase === "process"), "Provider processing progress was not recorded.");
assert(completed.events.some((event) => event.phase === "infer"), "Inference progress was not recorded.");
assert(completed.events.some((event) => event.phase === "cleanup"), "Remote cleanup progress was not recorded.");
loadProject(JSON.stringify(completed.result.dsl));
assert(!JSON.stringify(completed).toLowerCase().includes("offline-mock"), "Mock result entered the browser task.");
assert(requestBodies.length === 1 && !requestBodies[0].includes("ARK_API_KEY") && !requestBodies[0].includes("apiKey"), "Browser request contained a key field.");

for (const heading of ["结构化摘要", "素材理解", "镜头与效果", "时间轴草案", "预算与实际调用"]) {
  await page.getByRole("heading", { name: heading }).waitFor();
}
assert(await page.getByText("doubao-seed-2-0-lite-260428").count() > 0, "Actual model trace was not displayed.");
assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Desktop AI planner has horizontal overflow.");
await page.screenshot({ path: resolve(screenshots, "ai-planner-desktop.png"), fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(100);
assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile AI planner has horizontal overflow.");
await page.screenshot({ path: resolve(screenshots, "ai-planner-mobile.png"), fullPage: true });
await page.setViewportSize({ width: 1440, height: 900 });

await page.getByRole("button", { name: "进入编辑器继续手工编辑" }).click();
await page.locator(".editor-shell").waitFor();
const propertyInput = page.locator(".schema-field input[type=number]").first();
const beforeEdit = await propertyInput.inputValue();
await propertyInput.press("ArrowUp");
assert(await propertyInput.inputValue() !== beforeEdit, "Generated DSL did not remain manually editable.");
await page.locator(".save-indicator.saved").waitFor({ timeout: 5_000 });
const autosavedProject = loadProject(await page.evaluate(() => {
  const envelope = JSON.parse(localStorage.getItem("codemotion.editor.autosave.v1") ?? "{}");
  if (typeof envelope.projectJson !== "string") throw new Error("Edited AI project was not autosaved.");
  return envelope.projectJson;
}));
const autosavedLayerIds = new Set(autosavedProject.compositions.flatMap((composition) => composition.layers.map((layer) => layer.id)));
const autosavedEffectIds = new Set(autosavedProject.compositions.flatMap((composition) =>
  composition.layers.flatMap((layer) => layer.effects.map((effect) => effect.effectId))));
assert(autosavedProject.id === generatedProject.id, "Editor replaced the model-generated project.");
assert(generatedLayerIds.every((id) => autosavedLayerIds.has(id)), "Manual editing removed a model-generated layer.");
assert(generatedEffectIds.every((id) => autosavedEffectIds.has(id)), "Manual editing removed a model-selected P0 effect.");

const existingExportIds = new Set((await page.evaluate(async () => (await (await fetch("/api/editor-exports")).json()).tasks))
  .map((task) => task.id));
await page.locator(".render-button").click();
await page.getByText("真实 exporter 已连接").waitFor();
await page.locator(".format-segment button").nth(3).click();
await page.locator(".render-field input[type=number]").nth(3).fill("0.5");
const hasGeneratedAudio = generatedProject.audioTracks.length > 0;
const audioToggle = page.locator(".toggle-field input").nth(1);
if (hasGeneratedAudio) await audioToggle.check();
else await audioToggle.uncheck();
assert(await page.locator(".validation-list").count() === 0, "Generated DSL was not accepted by the render center settings.");
await page.locator(".export-start").click();

let exportedTask;
const exportDeadline = Date.now() + 120_000;
while (Date.now() < exportDeadline) {
  const tasks = await page.evaluate(async () => (await (await fetch("/api/editor-exports")).json()).tasks);
  exportedTask = tasks.find((task) => !existingExportIds.has(task.id));
  if (exportedTask?.status === "completed" || exportedTask?.status === "failed") break;
  await page.waitForTimeout(500);
}
assert(exportedTask, "Render center did not create a product export task.");
if (exportedTask.status === "failed") {
  const failure = exportedTask.failure ?? {};
  throw new Error(`Stage 6 export failed at ${failure.stage ?? "unknown"} frame ${failure.frame ?? "unknown"} time ${failure.time ?? "unknown"} recover ${failure.recoverFromFrame ?? "unknown"}: ${failure.message ?? "unknown"}`);
}
assert(exportedTask.status === "completed", `Stage 6 export did not complete; status=${exportedTask.status}.`);
assert(exportedTask.progress === 1 && exportedTask.completedFrames === exportedTask.frameCount, "Export task reported false completion progress.");
assert(exportedTask.settings.format === "mp4", "Product task did not retain the selected MP4 format.");
assert(exportedTask.settings.audio === hasGeneratedAudio, "Product task audio setting did not match the generated DSL.");
assert(exportedTask.logs.some((line) => line.includes("真实编码")), "Product task did not report fixed-frame encoding.");
const renderedP0EffectIds = [...new Set(generatedProject.compositions.flatMap((composition) =>
  composition.layers.flatMap((layer) => layer.effects
    .filter((effect) => effect.enabled
      && (effect.startTime ?? layer.startTime) < exportedTask.settings.duration
      && (effect.endTime ?? layer.endTime) > 0)
    .map((effect) => effect.effectId))))];
assert(renderedP0EffectIds.length > 0, "No model-selected P0 effect overlapped the Stage 6 export range.");
assert(renderedP0EffectIds.every((effectId) => GROUP_2_P0_BY_ID.has(effectId)), "Stage 6 export range contained an unregistered effect.");

const downloadLink = page.locator(`a[href="/api/editor-exports/${exportedTask.id}/download"]`);
await downloadLink.waitFor();
const downloadEvent = page.waitForEvent("download");
await downloadLink.click();
const download = await downloadEvent;
await download.saveAs(finalVideo);
assert((await stat(finalVideo)).size > 0, "Downloaded final video is empty.");

const probe = JSON.parse((await runProcess("ffprobe", [
  "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", finalVideo
])).stdout.toString("utf8"));
const videoStream = probe.streams.find((stream) => stream.codec_type === "video");
const audioStream = probe.streams.find((stream) => stream.codec_type === "audio");
assert(videoStream?.codec_name === "h264", "Final MP4 does not contain the expected H.264 video stream.");
assert(videoStream.width === exportedTask.settings.width && videoStream.height === exportedTask.settings.height, "Final video dimensions differ from the product task.");
assert(Math.abs(rate(videoStream.avg_frame_rate) - exportedTask.settings.fps) < 0.01, "Final video FPS differs from the product task.");
assert(Number(videoStream.nb_read_frames) === exportedTask.frameCount, "FFprobe frame count differs from the fixed-frame task.");
assert(Number(probe.format.duration) > 0 && Math.abs(Number(probe.format.duration) - exportedTask.settings.duration) < 0.08, "Final video duration differs from the product task.");
assert(Boolean(audioStream) === hasGeneratedAudio, "Final audio stream presence does not match the generated DSL.");
if (hasGeneratedAudio) {
  assert(Number(audioStream.duration ?? probe.format.duration) >= exportedTask.settings.duration - 0.08, "Final audio stream is shorter than the video timeline.");
  assert(Number(audioStream.start_time ?? 0) <= 0.08, "Final audio stream does not begin with the generated timeline.");
}

const decoded = (await runProcess("ffmpeg", [
  "-hide_banner", "-v", "error", "-i", finalVideo, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
])).stdout;
const frameBytes = exportedTask.settings.width * exportedTask.settings.height * 4;
assert(decoded.byteLength === frameBytes * exportedTask.frameCount, "Decoded byte count does not match the fixed-frame output.");
const frameHashes = [];
for (let offset = 0; offset < decoded.byteLength; offset += frameBytes) {
  const frame = decoded.subarray(offset, offset + frameBytes);
  let visible = false;
  for (let pixel = 0; pixel < frame.length; pixel += 4) {
    if (frame[pixel + 3] > 0 && (frame[pixel] > 3 || frame[pixel + 1] > 3 || frame[pixel + 2] > 3)) {
      visible = true;
      break;
    }
  }
  assert(visible, `Decoded frame ${offset / frameBytes} is fully black or transparent.`);
  frameHashes.push(fingerprint(frame));
}
assert(new Set(frameHashes).size > 1, "Decoded video has no pixel change across animation time.");

const playback = await page.evaluate(async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Video fetch failed with HTTP ${response.status}.`);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(await response.blob());
  document.body.append(video);
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error("Edge playback readiness timed out.")), 15_000);
    video.addEventListener("canplay", () => { clearTimeout(timer); resolveReady(); }, { once: true });
    video.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Edge could not decode the final video.")); }, { once: true });
  });
  const start = video.currentTime;
  await video.play();
  await new Promise((resolveAdvance, reject) => {
    const timer = setTimeout(() => reject(new Error("Edge playback time did not advance.")), 5_000);
    const poll = setInterval(() => {
      if (video.currentTime > start + 0.05) {
        clearInterval(poll);
        clearTimeout(timer);
        resolveAdvance();
      }
    }, 25);
  });
  const result = {
    readyState: video.readyState,
    duration: video.duration,
    width: video.videoWidth,
    height: video.videoHeight,
    advancedTo: video.currentTime
  };
  video.pause();
  URL.revokeObjectURL(video.src);
  video.remove();
  return result;
}, `/api/editor-exports/${exportedTask.id}/download`);
assert(playback.readyState >= 3 && playback.duration > 0 && playback.advancedTo > 0.05, "Edge did not reach a playable, advancing state.");
assert(playback.width === exportedTask.settings.width && playback.height === exportedTask.settings.height, "Edge decoded unexpected video dimensions.");

const requestFingerprint = completed.result.trace.requestFingerprint;
assert(/^request-sha256:[a-f0-9]{32}$/.test(requestFingerprint), "Provider request evidence was not fingerprinted.");
const evidence = {
  requestFingerprint,
  provider: completed.result.trace.provider,
  modelId: completed.result.trace.modelId,
  modalities: completed.modalities,
  storyboardShots: completed.result.storyboard.shots.length,
  generatedLayerCount: generatedLayerIds.length,
  generatedP0EffectIds: generatedEffectIds,
  renderedP0EffectIds,
  manuallyEditedAndAutosaved: true,
  export: {
    format: exportedTask.settings.format,
    width: videoStream.width,
    height: videoStream.height,
    fps: rate(videoStream.avg_frame_rate),
    duration: Number(probe.format.duration),
    frames: Number(videoStream.nb_read_frames),
    bytes: (await stat(finalVideo)).size,
    videoCodec: videoStream.codec_name,
    audioDeclaredByDsl: hasGeneratedAudio,
    audioCodec: audioStream?.codec_name ?? null,
    uniqueDecodedFrameHashes: new Set(frameHashes).size
  },
  edgePlayback: playback,
  draftPreviewFrameHashes: completed.result.preview.frameHashes.length
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
assert(!JSON.stringify(evidence).includes(media) && !JSON.stringify(evidence).includes(input), "Evidence leaked an absolute media path.");

await page.getByLabel("返回编辑器").click();
await page.getByLabel("AI 动画规划").click();
await page.getByLabel("动画规划文本").fill("创建一个待取消的文本动画规划。");
await page.locator(".ai-submit").click();
await page.locator(".ai-task-bar .danger").click();
await page.locator(".ai-task-error").filter({ hasText: "分析已取消" }).waitFor({ timeout: 30_000 });

await page.getByLabel("动画规划文本").fill("创建一个用于验证超时处理的复杂标题动画，并返回严格结构化规划。");
for (const checkbox of await page.locator(".ai-asset-option input").all()) await checkbox.check();
await page.locator(".ai-number-grid input").nth(1).fill("10");
await page.locator(".ai-submit").click();
await page.locator(".ai-task-error").filter({ hasText: "分析超过设定时限" }).waitFor({ timeout: 60_000 });

await browser.close();
const expectedHttpErrors = consoleErrors.filter((message) => message.includes("Failed to load resource"));
const unexpectedErrors = consoleErrors.filter((message) => !message.includes("Failed to load resource"));
assert(unexpectedErrors.length === 0, `Browser errors: ${unexpectedErrors.join(" | ")}`);
console.log(JSON.stringify({
  provider: completed.result.trace.provider,
  modelId: completed.result.trace.modelId,
  phases: [...new Set(completed.events.map((event) => event.phase))],
  modalities: completed.modalities,
  shots: completed.result.storyboard.shots.length,
  layers: completed.result.dsl.compositions[0].layers.length,
  export: evidence.export,
  requestFingerprint,
  evidencePath,
  expectedHttpErrors: expectedHttpErrors.length,
  screenshots
}, null, 2));
