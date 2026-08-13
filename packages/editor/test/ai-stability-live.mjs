import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { runProcess } from "@codemotion/exporter";

const origin = process.env.CMFX_EDITOR_URL ?? "http://127.0.0.1:4174";
const output = resolve(import.meta.dirname, "../../../tmp/ai-stability-live");
const runId = Date.now().toString(36);
const jpegPath = resolve(output, `real-input-${runId}.jpg`);
const previewPath = resolve(output, "gaussian-editor-preview.png");
const exportPath = resolve(output, "gaussian-export.mp4");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function taskIds(page, endpoint) {
  return new Set(await page.evaluate(async (url) =>
    (await (await fetch(url)).json()).tasks.map((task) => task.id), endpoint));
}

async function terminalTask(page, endpoint, previous, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await page.evaluate(async ({ url, oldIds }) => {
      const body = await (await fetch(url)).json();
      return body.tasks.find((candidate) => !oldIds.includes(candidate.id));
    }, { url: endpoint, oldIds: [...previous] });
    if (task && ["completed", "failed", "cancelled"].includes(task.status)) return task;
    await page.waitForTimeout(500);
  }
  throw new Error(`${endpoint} did not reach a terminal state.`);
}

async function openCreator(page) {
  if (await page.locator(".render-center").count()) {
    await page.getByLabel("返回编辑器").click();
    await page.locator(".editor-shell").waitFor();
  }
  if (await page.locator(".editor-shell").count()) {
    await page.getByLabel("AI 动画规划").click();
  }
  await page.locator(".creator-workspace").waitFor();
  await page.locator(".ai-submit").waitFor();
}

async function selectOnlyAsset(page, displayName) {
  const target = page.getByLabel(`选择 ${displayName}`).first();
  await target.waitFor({ timeout: 30_000 });
  const checked = page.locator('.ai-asset-option input[type="checkbox"]:checked');
  const selectedLabels = await checked.evaluateAll((items) =>
    items.map((item) => item.getAttribute("aria-label")).filter(Boolean));
  for (const label of selectedLabels) {
    if (label !== `选择 ${displayName}`) await page.getByLabel(label).click();
  }
  const refreshedTarget = page.getByLabel(`选择 ${displayName}`).first();
  await refreshedTarget.waitFor({ timeout: 30_000 });
  if (!await refreshedTarget.isChecked()) await refreshedTarget.click();
  assert(await page.locator('.ai-asset-option input[type="checkbox"]:checked').count() === 1,
    "Exactly one JPEG must be selected.");
}

async function clearCardSelection(page) {
  const cancel = page.getByLabel("取消选择特效");
  if (await cancel.count()) await cancel.click();
  assert(await page.locator(".selected-effect").count() === 0, "A sample card is still selected.");
  assert(await page.locator('.sample-card-add[aria-pressed="true"]').count() === 0,
    "A sample card button is still pressed.");
}

async function generate(page, displayName, prompt, expectedEffectId) {
  await openCreator(page);
  await selectOnlyAsset(page, displayName);
  await clearCardSelection(page);
  await page.getByLabel("描述视频内容").fill(prompt);
  const submit = page.locator(".ai-submit");
  assert(await submit.isEnabled(), `Generate is disabled: ${await submit.getAttribute("title")}`);
  const previous = await taskIds(page, "/api/ai-plans");
  await submit.click();
  const task = await terminalTask(page, "/api/ai-plans", previous, 300_000);
  assert(task.status === "completed", `AI task ${task.id} failed: ${JSON.stringify(task.error)}`);
  const effects = task.result?.storyboard?.shots?.flatMap((shot) => shot.effects) ?? [];
  assert(effects.length === 1 && effects[0].effectId === expectedEffectId,
    `AI task ${task.id} selected ${effects.map((effect) => effect.effectId).join(",")}.`);
  return task;
}

async function canvasEvidence(page) {
  return page.locator('.canvas-frame canvas[aria-label="WebGL 合成预览"]').evaluate((canvas) => {
    const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    let visiblePixels = 0;
    let brightPixels = 0;
    const sums = [0, 0, 0];
    if (pixels) for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] > 0) visiblePixels += 1;
      const brightness = pixels[offset] + pixels[offset + 1] + pixels[offset + 2];
      if (brightness > 60) brightPixels += 1;
      sums[0] += pixels[offset];
      sums[1] += pixels[offset + 1];
      sums[2] += pixels[offset + 2];
      hash = Math.imul(hash ^ pixels[offset], 16777619);
      hash = Math.imul(hash ^ pixels[offset + 1], 16777619);
      hash = Math.imul(hash ^ pixels[offset + 2], 16777619);
      hash = Math.imul(hash ^ pixels[offset + 3], 16777619);
    }
    const count = Math.max(1, canvas.width * canvas.height);
    return {
      width: canvas.width,
      height: canvas.height,
      hash: hash >>> 0,
      visiblePixels,
      brightPixels,
      meanRgb: sums.map((sum) => sum / count)
    };
  });
}

async function editGaussianAndExport(page, task) {
  await page.locator(".editor-shell").waitFor({ timeout: 30_000 });
  await page.locator(".backend-status.ok").waitFor({ timeout: 30_000 });
  await page.getByLabel("时间轴播放头").fill("2");
  await page.waitForTimeout(800);
  const before = await canvasEvidence(page);
  assert(before.visiblePixels > 100 && before.brightPixels > 100,
    `Editor preview does not show the real JPEG: ${JSON.stringify(before)}`);
  const project = task.result.editableProject.project;
  const layer = project.compositions.flatMap((composition) => composition.layers)
    .find((candidate) => candidate.effects.some((effect) => effect.effectId === "fx.post.gaussianBlur"));
  assert(layer, "Gaussian target layer is missing.");
  const layerRow = page.locator(".layer-row", { hasText: layer.name });
  await layerRow.locator(".layer-name").click();
  assert(await layerRow.getByLabel("隐藏图层", { exact: true }).count() === 1,
    "Selecting the Gaussian layer unexpectedly hid it.");
  await page.locator(".stack-row").first().click();
  const parameter = page.locator('.effect-inspector input[type="number"]').first();
  await parameter.waitFor();
  const parameterBefore = Number(await parameter.inputValue());
  const bounds = await parameter.evaluate((input) => ({
    min: input.min === "" ? 0 : Number(input.min),
    max: input.max === "" ? 100 : Number(input.max),
    step: input.step === "" || input.step === "any" ? 1 : Number(input.step)
  }));
  const precision = Math.max(0, String(bounds.step).split(".")[1]?.length ?? 0) + 2;
  const firstStep = Number((bounds.min + bounds.step).toFixed(precision));
  const parameterAfter = firstStep !== parameterBefore
    ? firstStep
    : Number((bounds.min + bounds.step * 2).toFixed(precision));
  await parameter.fill(String(parameterAfter));
  await page.waitForFunction(({ expected }) => {
    const input = document.querySelector('.effect-inspector input[type="number"]');
    return input && Math.abs(Number(input.value) - expected) < 1e-9;
  }, { expected: parameterAfter });
  const actualParameter = Number(await parameter.inputValue());
  assert(Math.abs(actualParameter - parameterAfter) < 1e-9 && parameterAfter !== parameterBefore,
    `Gaussian parameter did not remain editable: ${parameterBefore} -> ${actualParameter}.`);
  assert(await layerRow.getByLabel("隐藏图层", { exact: true }).count() === 1,
    "Editing the Gaussian parameter unexpectedly hid its target layer.");
  await page.waitForTimeout(800);
  const after = await canvasEvidence(page);
  await page.locator(".canvas-frame canvas").screenshot({ path: previewPath });

  const previousExports = await taskIds(page, "/api/editor-exports");
  let exportRequest;
  const captureExportRequest = (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/editor-exports") {
      exportRequest = request.postDataJSON();
    }
  };
  page.on("request", captureExportRequest);
  await page.locator(".render-button").click();
  await page.locator(".render-center").waitFor();
  await page.locator(".format-segment button").filter({ hasText: "MP4" }).click();
  await page.getByLabel("宽度").fill("160");
  await page.getByLabel("高度").fill("90");
  await page.getByLabel("帧率").fill("12");
  await page.getByLabel("时长").fill(String(project.duration));
  const audio = page.getByLabel("包含音轨");
  if (await audio.isChecked()) await audio.uncheck();
  await page.locator(".export-start").click();
  await page.waitForFunction(() => performance.getEntriesByType("resource")
    .some((entry) => new URL(entry.name).pathname === "/api/editor-exports"));
  page.off("request", captureExportRequest);
  assert(exportRequest?.editableProject, "The UI export request body was not captured.");
  const directPreview = await page.evaluate(async (editableProject) => {
    const csrf = document.cookie.split("; ").find((entry) => entry.startsWith("cmfx_dev_csrf="))?.split("=")[1]
      ?? document.cookie.split("; ").find((entry) => entry.startsWith("__Host-cmfx_csrf="))?.split("=")[1];
    const response = await fetch("/api/editor-preview", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmfx-csrf": decodeURIComponent(csrf ?? "") },
      body: JSON.stringify({
        contract: "preview-request/v1",
        editableProject,
        frame: { width: 160, height: 90, time: 2, quality: "preview" }
      })
    });
    const pixels = new Uint8Array(await response.arrayBuffer());
    let brightPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 60) brightPixels += 1;
    }
    return { status: response.status, bytes: pixels.byteLength, brightPixels };
  }, exportRequest.editableProject);
  const summarizeProject = (editableProject) => ({
    duration: editableProject.project.duration,
    assets: editableProject.project.assets,
    layers: editableProject.project.compositions.flatMap((composition) => composition.layers).map((candidate) => ({
      id: candidate.id,
      type: candidate.type,
      visible: candidate.visible,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      source: candidate.source,
      transform: candidate.transform,
      opacity: candidate.opacity,
      effects: candidate.effects
    }))
  });
  assert(directPreview.status === 200 && directPreview.brightPixels > 100,
    `The exact UI export envelope does not preview the real JPEG: ${JSON.stringify({
      directPreview,
      original: summarizeProject(task.result.editableProject),
      edited: summarizeProject(exportRequest.editableProject)
    })}`);
  const exported = await terminalTask(page, "/api/editor-exports", previousExports, 180_000);
  assert(exported.status === "completed", `Export failed: ${JSON.stringify(exported.failure)}`);
  const download = page.waitForEvent("download");
  await page.locator(".task-actions .primary-command").click();
  await (await download).saveAs(exportPath);
  assert((await stat(exportPath)).size > 0, "Exported MP4 is empty.");
  const probe = JSON.parse((await runProcess("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", exportPath
  ])).stdout.toString("utf8"));
  assert(probe.streams.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264"),
    "Exported MP4 is missing H.264 video.");
  await runProcess("ffmpeg", ["-v", "error", "-i", exportPath, "-f", "null", "-"]);
  const raw = (await runProcess("ffmpeg", [
    "-v", "error", "-ss", "2", "-i", exportPath,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
  ])).stdout;
  let exportBrightPixels = 0;
  for (let offset = 0; offset < raw.length; offset += 4) {
    if (raw[offset] + raw[offset + 1] + raw[offset + 2] > 60) exportBrightPixels += 1;
  }
  assert(exportBrightPixels > 100, `Exported MP4 does not show the real JPEG (${exportBrightPixels} bright pixels).`);
  return {
    preview: { before, after, screenshot: previewPath },
    parameter: { before: parameterBefore, after: parameterAfter },
    export: {
      taskId: exported.id,
      bytes: (await stat(exportPath)).size,
      path: exportPath,
      brightPixels: exportBrightPixels,
      requestPreview: directPreview
    }
  };
}

await mkdir(output, { recursive: true });
await runProcess("ffmpeg", [
  "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1242x2208:rate=1",
  "-frames:v", "1", "-vf", "format=yuvj444p", "-q:v", "2", jpegPath
]);

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
    browserErrors.push(message.text());
  }
});

try {
  const session = page.waitForResponse((response) => response.url().endsWith("/auth/dev/auto-session"));
  await page.goto(origin, { waitUntil: "networkidle" });
  assert((await session).status() === 201, "Local development session was not created.");
  const service = await page.evaluate(async () => await (await fetch("/api/ai-plans")).json());
  assert(service.configured === true, "Volcengine Ark is not configured.");
  const upload = page.waitForResponse((response) => response.url().endsWith("/api/media-assets")
    && response.request().method() === "POST");
  await page.locator('.ai-upload-row input[type="file"]').setInputFiles(jpegPath);
  const uploaded = await upload;
  assert(uploaded.status() === 201, `JPEG upload failed with HTTP ${uploaded.status()}.`);
  const uploadBody = await uploaded.json();
  assert(uploadBody.asset?.kind === "image" && uploadBody.asset?.codec === "mjpeg",
    "Uploaded JPEG was not verified as MJPEG image media.");
  const displayName = uploadBody.asset.displayName;
  await page.getByLabel(`选择 ${displayName}`).waitFor();

  const gaussian = [];
  let editorEvidence;
  for (let index = 0; index < 5; index += 1) {
    const task = await generate(page, displayName, "实现柔和朦胧的效果，视频时长4秒", "fx.post.gaussianBlur");
    gaussian.push({ taskId: task.id, status: task.status, effectId: "fx.post.gaussianBlur" });
    if (index === 0) editorEvidence = await editGaussianAndExport(page, task);
  }
  const slide = await generate(page, displayName, "图片实现划入效果", "fx.motion.slide");
  const typewriter = await generate(page, displayName, "实现笔唯思被打印机打出的效果", "fx.text.typewriter");
  const textLayers = typewriter.result.editableProject.project.compositions
    .flatMap((composition) => composition.layers).filter((layer) => layer.type === "text");
  assert(textLayers.some((layer) => layer.properties.text === "笔唯思"),
    "Typewriter project did not contain editable text 笔唯思.");
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
  console.log(JSON.stringify({
    provider: "volcengine-ark",
    model: "doubao-seed-2-0-lite-260428",
    upload: { assetId: uploadBody.asset.assetId, codec: uploadBody.asset.codec, path: jpegPath },
    gaussian,
    editorEvidence,
    slide: { taskId: slide.id, status: slide.status, effectId: "fx.motion.slide" },
    typewriter: { taskId: typewriter.id, status: typewriter.status, effectId: "fx.text.typewriter", text: "笔唯思" }
  }));
} finally {
  await context.close();
  await browser.close();
}
