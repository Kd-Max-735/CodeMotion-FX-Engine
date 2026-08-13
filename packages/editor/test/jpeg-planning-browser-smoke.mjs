import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { runProcess } from "@codemotion/exporter";

const origin = process.env.CMFX_EDITOR_URL ?? "http://127.0.0.1:4174";
const output = resolve(import.meta.dirname, "../../../tmp/jpeg-planning-browser");
const imagePath = resolve(output, "portrait-yuvj444p.jpg");
const downloadPath = resolve(output, "slide-in.mp4");
const screenshotPath = resolve(output, "editor-preview.png");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function taskIds(page, endpoint) {
  return new Set(await page.evaluate(async (url) => {
    const response = await fetch(url);
    const body = await response.json();
    return body.tasks.map((task) => task.id);
  }, endpoint));
}

async function terminalTask(page, endpoint, previous, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await page.evaluate(async ({ url, oldIds }) => {
      const response = await fetch(url);
      const body = await response.json();
      return body.tasks.find((candidate) => !oldIds.includes(candidate.id));
    }, { url: endpoint, oldIds: [...previous] });
    if (task && ["completed", "failed", "cancelled"].includes(task.status)) return task;
    await page.waitForTimeout(500);
  }
  throw new Error(`${endpoint} did not reach a terminal state.`);
}

await mkdir(output, { recursive: true });
await runProcess("ffmpeg", [
  "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1242x2208:rate=1",
  "-frames:v", "1", "-vf", "format=yuvj444p", "-q:v", "2", imagePath
]);

const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=swiftshader"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("401 (Unauthorized)")) {
    browserErrors.push(message.text());
  }
});

try {
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.locator(".creator-workspace").waitFor({ timeout: 30_000 });
  const service = await page.evaluate(async () => (await (await fetch("/api/ai-plans")).json()));
  assert(service.configured === true, "The server-side Ark Provider is not configured.");

  const uploadResponse = page.waitForResponse((response) => response.url().endsWith("/api/media-assets")
    && response.request().method() === "POST");
  await page.locator('.ai-upload-row input[type="file"]').setInputFiles(imagePath);
  const uploaded = await uploadResponse;
  assert(uploaded.status() === 201, `JPEG upload failed with HTTP ${uploaded.status()}.`);
  const uploadBody = await uploaded.json();
  assert(uploadBody.asset?.kind === "image", "Uploaded JPEG was not registered as an image.");
  assert(uploadBody.asset?.codec === "mjpeg", "Uploaded JPEG did not retain the MJPEG codec.");
  assert(uploadBody.asset?.width === 1242 && uploadBody.asset?.height === 2208,
    "Uploaded JPEG dimensions were not preserved.");

  const wanted = page.getByLabel(`选择 ${uploadBody.asset.displayName}`);
  await wanted.waitFor();
  const options = page.locator('.ai-asset-option input[type="checkbox"]');
  for (let index = 0; index < await options.count(); index += 1) {
    const checkbox = options.nth(index);
    const shouldSelect = await checkbox.getAttribute("aria-label") === `选择 ${uploadBody.asset.displayName}`;
    if (await checkbox.isChecked() !== shouldSelect) await checkbox.click();
  }
  const slideCard = page.locator('[data-effect-id="fx.motion.slide"] .sample-card-add');
  if (await slideCard.getAttribute("aria-pressed") !== "true") await slideCard.click();
  await page.getByLabel("描述视频内容").fill("图片实现划入效果");
  const generate = page.locator(".ai-submit");
  await generate.waitFor();
  assert(!(await generate.isDisabled()), `Generate is disabled: ${await generate.getAttribute("title")}`);

  const previousPlans = await taskIds(page, "/api/ai-plans");
  await generate.click();
  const plan = await terminalTask(page, "/api/ai-plans", previousPlans, 300_000);
  assert(plan.status === "completed", `AI planning failed: ${JSON.stringify(plan.error)}`);
  assert(plan.phase === "plan", `AI planning ended in unexpected phase ${plan.phase}.`);
  assert(plan.events.some((event) => event.phase === "infer"), "Ark inference progress was not observed.");
  assert(plan.result?.preview?.width === 160 && plan.result?.preview?.height === 90,
    "AI low-resolution preview dimensions are invalid.");
  assert(plan.result?.storyboard?.shots?.flatMap((shot) => shot.effects)
    .some((effect) => effect.effectId === "fx.motion.slide"), "The model plan did not use fx.motion.slide.");
  assert(plan.result?.editableProject?.project?.audioTracks?.length === 0,
    "The image-only request unexpectedly created an audio track.");

  await page.getByRole("button", { name: "进入编辑器", exact: true }).click();
  await page.locator(".editor-shell").waitFor({ timeout: 30_000 });
  await page.locator(".backend-status.ok").waitFor({ timeout: 30_000 });
  await page.getByLabel("时间轴播放头").fill("0.6");
  await page.waitForTimeout(1_000);
  const canvas = await page.locator('canvas[aria-label="WebGL 合成预览"]').evaluate((element) => {
    const pixels = element.getContext("2d")?.getImageData(0, 0, element.width, element.height).data;
    return {
      width: element.width,
      height: element.height,
      visiblePixels: pixels ? [...pixels].filter((value, index) => index % 4 === 3 && value > 0).length : 0
    };
  });
  assert(canvas.width === 240 && canvas.height === 135 && canvas.visiblePixels > 100,
    `Editor preview is blank or incorrectly sized: ${JSON.stringify(canvas)}`);
  await page.locator(".canvas-frame canvas").screenshot({ path: screenshotPath });

  const previousExports = await taskIds(page, "/api/editor-exports");
  await page.locator(".render-button").click();
  await page.locator(".format-segment button").filter({ hasText: "MP4" }).click();
  const numbers = page.locator('.export-settings input[type="number"]');
  await numbers.nth(0).fill("160");
  await numbers.nth(1).fill("90");
  await numbers.nth(2).fill("12");
  assert(await numbers.nth(3).isEditable() === false && await numbers.nth(3).inputValue() === "5",
    "Export duration is not following the authoritative five-second project duration.");
  const audio = page.locator('.export-settings input[type="checkbox"]').last();
  if (await audio.isChecked()) await audio.uncheck();
  await page.locator(".export-start").click();
  const exported = await terminalTask(page, "/api/editor-exports", previousExports, 180_000);
  assert(exported.status === "completed", `Export failed: ${JSON.stringify(exported.failure)}`);
  const download = page.waitForEvent("download");
  await page.locator(".task-actions .primary-command").click();
  await (await download).saveAs(downloadPath);
  assert((await stat(downloadPath)).size > 0, "Downloaded MP4 is empty.");
  const probe = JSON.parse((await runProcess("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", downloadPath
  ])).stdout.toString("utf8"));
  assert(probe.streams.some((stream) => stream.codec_type === "video" && stream.codec_name === "h264"),
    "Exported MP4 does not contain H.264 video.");
  await runProcess("ffmpeg", ["-v", "error", "-i", downloadPath, "-f", "null", "-"]);
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);

  console.log(JSON.stringify({
    result: "pass",
    provider: "volcengine-ark",
    model: "doubao-seed-2-0-lite-260428",
    prompt: "图片实现划入效果",
    upload: {
      kind: uploadBody.asset.kind,
      codec: uploadBody.asset.codec,
      width: uploadBody.asset.width,
      height: uploadBody.asset.height
    },
    task: { status: plan.status, phase: plan.phase, effectId: "fx.motion.slide" },
    preview: canvas,
    export: {
      status: exported.status,
      bytes: (await stat(downloadPath)).size,
      format: probe.format.format_name,
      streams: probe.streams.map((stream) => ({ type: stream.codec_type, codec: stream.codec_name }))
    },
    screenshotPath,
    downloadPath
  }));
} finally {
  await context.close();
  await browser.close();
}
