import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import { runProcess } from "@codemotion/exporter";

const origin = "http://127.0.0.1:4174";
const root = resolve(import.meta.dirname, "../../../tmp/acceptance-fixes-20260813");
const source = resolve(import.meta.dirname, "../../../tmp/ai-stability-live/real-input.jpg");
const primary = resolve(root, "acceptance-primary-20260813.jpg");
const removable = resolve(root, "acceptance-removable-20260813.jpg");
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForTask(page, endpoint, predicate, timeout = 900_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const tasks = await page.evaluate(async (url) => (await (await fetch(url)).json()).tasks, endpoint);
    const task = tasks.find(predicate);
    if (task) return task;
    await page.waitForTimeout(500);
  }
  throw new Error(`Timed out waiting for ${endpoint}.`);
}

async function upload(page, path) {
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/media-assets")
    && response.request().method() === "POST");
  await page.locator(".ai-upload-row input[type=file]").setInputFiles(path);
  const response = await responsePromise;
  assert(response.status() === 201, `Upload failed: ${response.status()}`);
  return (await response.json()).asset;
}

async function openCreator(page) {
  if (await page.locator(".creator-workspace").count()) return;
  if (await page.locator(".ai-auth-panel").count()) await page.getByRole("button", { name: "重试" }).click();
  if (await page.locator(".editor-shell").count()) await page.getByLabel("AI 动画规划").click();
  else if (await page.getByRole("button", { name: "打开 AI 规划" }).count()) await page.getByRole("button", { name: "打开 AI 规划" }).click();
  try {
    await page.locator(".creator-workspace").waitFor({ timeout: 5_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(async () => ({
      body: document.body.innerText.slice(0, 1_000),
      sessionStatus: (await fetch("/api/session")).status,
      sessionBody: await (await fetch("/api/session")).text()
    }));
    throw new Error(`Creator did not open: ${JSON.stringify({ ...diagnostic, browserErrors })}`, { cause: error });
  }
}

async function selectOnly(page, displayName) {
  const options = page.locator(".ai-asset-option");
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    const selected = await option.locator("input[type=checkbox]").isChecked();
    const wanted = (await option.locator("b").textContent()) === displayName;
    if (selected !== wanted) await option.locator("input[type=checkbox]").click();
  }
}

async function deleteRequest(page, path) {
  return page.evaluate(async (url) => {
    const csrfCookie = document.cookie.split(";").map((item) => item.trim())
      .find((item) => item.startsWith("cmfx_dev_csrf=") || item.startsWith("__Host-cmfx_csrf="));
    const csrf = csrfCookie?.slice(csrfCookie.indexOf("=") + 1) ?? "";
    const response = await fetch(url, { method: "DELETE", headers: { "x-cmfx-csrf": decodeURIComponent(csrf) } });
    return { status: response.status, body: await response.text() };
  }, path);
}

async function postJson(page, path, body) {
  return page.evaluate(async ({ url, value }) => {
    const csrfCookie = document.cookie.split(";").map((item) => item.trim())
      .find((item) => item.startsWith("cmfx_dev_csrf=") || item.startsWith("__Host-cmfx_csrf="));
    const csrf = csrfCookie?.slice(csrfCookie.indexOf("=") + 1) ?? "";
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cmfx-csrf": decodeURIComponent(csrf) },
      body: JSON.stringify(value)
    });
    return { status: response.status, body: await response.json() };
  }, { url: path, value: body });
}

async function postEmpty(page, path) {
  return page.evaluate(async (url) => {
    const csrfCookie = document.cookie.split(";").map((item) => item.trim())
      .find((item) => item.startsWith("cmfx_dev_csrf=") || item.startsWith("__Host-cmfx_csrf="));
    const csrf = csrfCookie?.slice(csrfCookie.indexOf("=") + 1) ?? "";
    const response = await fetch(url, { method: "POST", headers: { "x-cmfx-csrf": decodeURIComponent(csrf) } });
    return { status: response.status, body: await response.text() };
  }, path);
}

async function canvasHash(page) {
  return page.locator(".canvas-frame canvas").evaluate((canvas) => {
    const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  });
}

await mkdir(root, { recursive: true });
await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vf", "scale=720:-2", "-q:v", "2", primary]);
await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", source, "-vf", "hflip,scale=704:-2", "-q:v", "2", removable]);

const browser = await chromium.launch({ executablePath: edge, headless: true, args: ["--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const browserErrors = [];
let previewRequests = 0;
let previewActive = 0;
let maxPreviewActive = 0;
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("request", (request) => {
  if (request.url().endsWith("/api/editor-preview")) {
    previewRequests += 1;
    previewActive += 1;
    maxPreviewActive = Math.max(maxPreviewActive, previewActive);
  }
});
const previewDone = (request) => { if (request.url().endsWith("/api/editor-preview")) previewActive -= 1; };
page.on("requestfinished", previewDone);
page.on("requestfailed", previewDone);
page.on("dialog", (dialog) => dialog.accept());

try {
  await page.goto(origin, { waitUntil: "networkidle" });
  const initialSession = await page.evaluate(async () => (await fetch("/api/session")).status);
  if (initialSession === 401) {
    const auto = await page.evaluate(async () => (await fetch("/auth/dev/auto-session", { method: "POST" })).status);
    assert(auto === 201, `Local automatic session failed: ${auto}.`);
    await page.reload({ waitUntil: "networkidle" });
  }
  assert(await page.evaluate(async () => (await fetch("/api/session")).status) === 200, "Local session is not authenticated.");
  await openCreator(page);
  const staleActive = await page.evaluate(async () => (await (await fetch("/api/editor-exports")).json()).tasks
    .filter((task) => ["queued", "running", "cancelling"].includes(task.status)).map((task) => task.id));
  for (const taskId of staleActive) {
    const cancelled = await postEmpty(page, `/api/editor-exports/${taskId}/cancel`);
    assert(cancelled.status === 200, `Could not cancel stale export ${taskId}: ${cancelled.status}.`);
  }

  const first = await upload(page, primary);
  const second = await upload(page, removable);
  await page.getByLabel(`选择 ${first.displayName}`).check();
  await page.getByLabel(`选择 ${second.displayName}`).check();
  await page.getByRole("button", { name: "取消全选" }).click();
  assert(await page.locator(".ai-asset-option input[type=checkbox]:checked").count() === 0, "取消全选 did not clear selection.");
  assert(await page.getByLabel(`选择 ${first.displayName}`).count() === 1 && await page.getByLabel(`选择 ${second.displayName}`).count() === 1,
    "取消全选 removed an uploaded asset.");

  const deleteResponse = page.waitForResponse((response) => response.url().endsWith(`/api/media-assets/${second.assetId}`)
    && response.request().method() === "DELETE");
  await page.getByLabel(`删除 ${second.displayName}`).click();
  assert((await deleteResponse).status() === 204, "Single asset delete did not return 204.");
  await page.reload({ waitUntil: "networkidle" });
  await openCreator(page);
  assert(await page.getByLabel(`选择 ${second.displayName}`).count() === 0, "Deleted asset reappeared after refresh.");
  assert(await page.getByLabel(`选择 ${first.displayName}`).count() === 1, "Neighbor asset disappeared after single delete.");

  await selectOnly(page, first.displayName);
  await page.getByLabel("视频时长").fill("5");
  const prompt = "在我提供的图片上使用打字机特效打出‘迅猛’两个字，输出视频时长为6秒。";
  await page.getByLabel("描述视频内容").fill(prompt);
  await page.locator('[data-effect-id="fx.text.typewriter"] .sample-card-add').click();
  await page.locator(".ai-duration-source").waitFor();
  assert((await page.locator(".ai-duration-source").textContent())?.includes("6 秒（来自描述）"), "Duration source is not visible.");
  assert(await page.getByLabel("视频时长").inputValue() === "6" && await page.getByLabel("视频时长").isEditable() === false,
    "Prompt duration did not override the five-second fallback.");

  const expectedRatios = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };
  const ratioEvidence = [];
  for (const [ratio, size] of Object.entries(expectedRatios)) {
    const button = page.locator(".creator-input-panel .format-segment button", { hasText: ratio });
    await button.click();
    const width = Number(await page.getByLabel("画布宽度").inputValue());
    const height = Number(await page.getByLabel("画布高度").inputValue());
    const pressed = await button.getAttribute("aria-pressed");
    assert(width === size[0] && height === size[1] && pressed === "true" && await button.evaluate((node) => node.classList.contains("active")),
      `${ratio} did not update dimensions and selection feedback.`);
    ratioEvidence.push({ ratio, width, height, pressed });
  }
  await page.locator(".creator-input-panel .format-segment button", { hasText: "16:9" }).click();

  const oldPlans = new Set(await page.evaluate(async () => (await (await fetch("/api/ai-plans")).json()).tasks.map((task) => task.id)));
  await page.getByRole("button", { name: "生成视频" }).click();
  let plan = await waitForTask(page, "/api/ai-plans", (task) => !oldPlans.has(task.id) && ["completed", "failed", "cancelled"].includes(task.status), 300_000);
  for (let retry = 0; retry < 2 && plan.status === "failed" && plan.error?.retryable; retry += 1) {
    const prior = new Set(await page.evaluate(async () => (await (await fetch("/api/ai-plans")).json()).tasks.map((task) => task.id)));
    const retryButton = page.locator(".creation-failure button", { hasText: "重试" });
    await retryButton.waitFor();
    while (!await retryButton.isEnabled()) await page.waitForTimeout(1_000);
    await retryButton.click();
    plan = await waitForTask(page, "/api/ai-plans", (task) => !prior.has(task.id) && ["completed", "failed", "cancelled"].includes(task.status), 300_000);
  }
  assert(plan.status === "completed", `Ark plan failed: ${plan.error?.problemCode ?? plan.error?.code ?? plan.status}`);
  const project = plan.result.editableProject.project;
  assert(project.duration === 6 && project.width === 1920 && project.height === 1080 && project.fps === 30, "Generated project authority is inconsistent.");
  assert(project.compositions.flatMap((composition) => composition.layers)
    .some((layer) => layer.type === "text" && layer.properties.text === "迅猛" && layer.effects.some((effect) => effect.effectId === "fx.text.typewriter")),
  "Generated project lost the exact text or typewriter effect.");

  await page.locator(".editor-shell").waitFor({ timeout: 30_000 });
  await page.locator(".backend-status.ok").waitFor({ timeout: 30_000 });
  await page.getByLabel("时间轴播放头").fill("0");
  await page.waitForTimeout(600);
  await page.locator(".canvas-frame").screenshot({ path: resolve(root, "typewriter-t0-editor.png") });
  const hash0 = await canvasHash(page);
  const requestStart = previewRequests;
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForTimeout(1_100);
  const playedTime = Number(await page.getByLabel("时间轴播放头").inputValue());
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const paused = Number(await page.getByLabel("时间轴播放头").inputValue());
  await page.waitForTimeout(1_000);
  const hashPlayed = await canvasHash(page);
  assert(playedTime > 0.65 && hashPlayed !== hash0, `Playback did not advance visibly: ${playedTime}.`);
  await page.waitForTimeout(500);
  assert(Math.abs(Number(await page.getByLabel("时间轴播放头").inputValue()) - paused) < 0.001, "Paused time continued to move.");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const resumed = Number(await page.getByLabel("时间轴播放头").inputValue());
  assert(resumed > paused + 0.35, "Playback did not resume from the paused position.");
  assert(maxPreviewActive <= 1, `Preview concurrency exceeded one: ${maxPreviewActive}.`);
  assert(previewRequests - requestStart < 35, `Preview request count was not coalesced: ${previewRequests - requestStart}.`);

  await page.getByLabel("时间轴播放头").focus();
  await page.getByLabel("时间轴播放头").press("End");
  await page.getByLabel("时间轴播放头").press("ArrowLeft");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForTimeout(600);
  assert(await page.getByRole("button", { name: "播放", exact: true }).count() === 1, "Playback did not enter stopped state at the end.");
  assert(Number(await page.getByLabel("时间轴播放头").inputValue()) === 6, "Playback did not stop at the exact project end.");

  const textLayer = page.locator(".layer-row", { hasText: "文字：迅猛" });
  await textLayer.locator(".layer-name").click();
  const scaleEvidence = [];
  for (const scale of [50, 100, 150, 200]) {
    await page.getByRole("spinbutton", { name: /^缩放 X/ }).fill(String(scale));
    await page.getByRole("spinbutton", { name: /^缩放 Y/ }).fill(String(scale));
    await page.waitForTimeout(350);
    const bounds = await page.locator(".selection-box").evaluate((box) => {
      const rect = box.getBoundingClientRect();
      const label = box.querySelector("label").getBoundingClientRect();
      const frame = box.closest(".canvas-frame").getBoundingClientRect();
      return {
        box: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        label: { left: label.left, top: label.top, right: label.right, bottom: label.bottom, text: box.querySelector("label").textContent },
        frame: { left: frame.left, top: frame.top, right: frame.right, bottom: frame.bottom }
      };
    });
    assert(bounds.label.text === "文字：迅猛" && (bounds.label.bottom <= bounds.box.top + 1 || bounds.label.top >= bounds.box.bottom - 1),
      `Selection label overlapped text bounds at ${scale}%.`);
    assert(bounds.box.left >= bounds.frame.left - 1 && bounds.box.top >= bounds.frame.top - 1
      && bounds.box.right <= bounds.frame.right + 1 && bounds.box.bottom <= bounds.frame.bottom + 1,
    `Text selection bounds were clipped at ${scale}%.`);
    await page.locator(".canvas-frame").screenshot({ path: resolve(root, `text-scale-${scale}.png`) });
    scaleEvidence.push({ scale, ...bounds });
  }

  const inUse = await deleteRequest(page, `/api/media-assets/${first.assetId}`);
  assert(inUse.status === 409 && inUse.body.includes("ASSET_IN_USE"), `Current-project asset delete was not rejected: ${inUse.status}.`);

  await page.locator(".render-button").click();
  await page.locator(".render-center").waitFor();
  assert(await page.getByLabel("导出时长（跟随工程）").inputValue() === "6"
    && await page.getByLabel("导出时长（跟随工程）").isEditable() === false, "Render center did not follow six-second project duration.");
  assert(await page.getByLabel("宽度").inputValue() === "1920" && await page.getByLabel("高度").inputValue() === "1080", "Render dimensions did not follow selected aspect.");
  const beforeExports = new Set(await page.evaluate(async () => (await (await fetch("/api/editor-exports")).json()).tasks.map((task) => task.id)));
  const exportStartedAt = Date.now();
  await page.locator(".export-start").click();
  const exportActive = await waitForTask(page, "/api/editor-exports", (task) => !beforeExports.has(task.id));
  const activeDelete = await deleteRequest(page, `/api/editor-exports/${exportActive.id}`);
  assert(activeDelete.status === 409 && activeDelete.body.includes("EXPORT_TASK_ACTIVE"), "Active export history was clearable.");
  assert(await page.locator(".task-actions button", { hasText: "清除记录" }).count() === 0, "Active task exposed a clear button.");
  const exported = await waitForTask(page, "/api/editor-exports", (task) => task.id === exportActive.id && ["completed", "failed", "cancelled"].includes(task.status));
  assert(exported.status === "completed" && exported.frameCount === 180 && exported.completedFrames === 180 && exported.settings.duration === 6,
    `Six-second export failed or planned wrong frames: ${exported.status}/${exported.completedFrames}/${exported.frameCount}.`);
  const exportElapsedMs = Date.now() - exportStartedAt;
  const exportPath = resolve(import.meta.dirname, `../../../tmp/exports/${exported.id}/output.mp4`);
  assert((await stat(exportPath)).size > 0, "Six-second export output is empty.");
  const exportProbe = JSON.parse((await runProcess("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", exportPath])).stdout.toString("utf8"));
  await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", exportPath, "-frames:v", "1", resolve(root, "export-frame-t1.png")]);

  const beforeCancel = new Set(await page.evaluate(async () => (await (await fetch("/api/editor-exports")).json()).tasks.map((task) => task.id)));
  await page.locator(".export-start").click();
  const cancelTask = await waitForTask(page, "/api/editor-exports", (task) => !beforeCancel.has(task.id));
  const cancelDelete = await deleteRequest(page, `/api/editor-exports/${cancelTask.id}`);
  assert(cancelDelete.status === 409, "Second active export history was clearable.");
  await page.locator(".task-actions button", { hasText: "取消" }).click();
  await waitForTask(page, "/api/editor-exports", (task) => task.id === cancelTask.id && ["cancelled", "failed"].includes(task.status));
  await page.locator(".task-actions button", { hasText: "清除记录" }).waitFor({ timeout: 30_000 });
  const clearResponse = page.waitForResponse((response) => response.url().endsWith(`/api/editor-exports/${cancelTask.id}`)
    && response.request().method() === "DELETE");
  await page.locator(".task-actions button", { hasText: "清除记录" }).click();
  assert((await clearResponse).status() === 204, "Terminal task clear did not return 204.");
  assert(!(await page.evaluate(async (id) => (await (await fetch("/api/editor-exports")).json()).tasks.some((task) => task.id === id), cancelTask.id)),
    "Cleared terminal task reappeared in the authoritative list.");

  const benchmarkProject = structuredClone(project);
  benchmarkProject.id = `${project.id}.benchmark`;
  benchmarkProject.name = "Acceptance 1080 square benchmark";
  benchmarkProject.width = 1080;
  benchmarkProject.height = 1080;
  benchmarkProject.duration = 3;
  for (const composition of benchmarkProject.compositions) {
    composition.width = 1080;
    composition.height = 1080;
    composition.duration = 3;
    for (const layer of composition.layers) {
      layer.endTime = Math.min(layer.endTime, 3);
      layer.outPoint = Math.min(layer.outPoint, 3);
      if (layer.type === "text") {
        layer.transform.anchorPoint = { mode: "constant", value: { x: 540, y: 540, z: 0 } };
        layer.transform.position = { mode: "constant", value: { x: 540, y: 540, z: 0 } };
        layer.transform.scale = { mode: "constant", value: { x: 100, y: 100, z: 100 } };
      }
      for (const effect of layer.effects) effect.endTime = Math.min(effect.endTime, 3);
    }
  }
  const benchmarkEnvelope = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(benchmarkProject, plan.result.editableProject.constraints);
  assert(benchmarkEnvelope.valid, `Benchmark project sanitization failed: ${benchmarkEnvelope.error?.code ?? "unknown"}.`);
  const benchmarkStartedAt = Date.now();
  const benchmarkCreate = await postJson(page, "/api/editor-exports", {
    contract: "export-request/v1",
    editableProject: benchmarkEnvelope.value,
    settings: { format: "mp4", width: 1080, height: 1080, fps: 30, duration: 3, alpha: false, audio: false }
  });
  assert(benchmarkCreate.status === 202, `Benchmark create failed: ${benchmarkCreate.status}.`);
  const benchmarkTask = await waitForTask(page, "/api/editor-exports", (task) => task.id === benchmarkCreate.body.task.id && ["completed", "failed", "cancelled"].includes(task.status));
  assert(benchmarkTask.status === "completed" && benchmarkTask.frameCount === 90 && benchmarkTask.completedFrames === 90,
    `Benchmark export failed: ${benchmarkTask.status}/${benchmarkTask.completedFrames}/${benchmarkTask.frameCount}.`);
  const benchmarkElapsedMs = Date.now() - benchmarkStartedAt;
  const benchmarkPath = resolve(import.meta.dirname, `../../../tmp/exports/${benchmarkTask.id}/output.mp4`);
  assert((await stat(benchmarkPath)).size > 0, "Benchmark output is empty.");
  const benchmarkProbe = JSON.parse((await runProcess("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", benchmarkPath])).stdout.toString("utf8"));

  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
  console.log(JSON.stringify({
    assets: { retained: first, deleted: second, inUseStatus: inUse.status },
    plan: { taskId: plan.id, duration: project.duration, width: project.width, height: project.height, fps: project.fps },
    ratioEvidence,
    playback: { playedTime, paused, resumed, previewRequests: previewRequests - requestStart, maxPreviewActive },
    scaleEvidence,
    export: { taskId: exported.id, path: exportPath, elapsedMs: exportElapsedMs, probe: exportProbe },
    clearedTaskId: cancelTask.id,
    benchmark: { taskId: benchmarkTask.id, path: benchmarkPath, elapsedMs: benchmarkElapsedMs, probe: benchmarkProbe },
    screenshots: root
  }));
} finally {
  await browser.close();
}
