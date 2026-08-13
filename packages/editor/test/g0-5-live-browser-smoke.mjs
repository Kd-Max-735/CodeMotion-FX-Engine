import { chromium } from "playwright-core";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";
import { runProcess } from "@codemotion/exporter";
import { OfflineMockProvider, VolcengineArkProvider } from "@codemotion/ai-planner";
import { AiPlanService } from "../dist/ai-plan-service.js";
import { createServerRuntime } from "../dist/server-runtime.js";

const arkAvailable = Boolean(process.env.ARK_API_KEY?.trim());
const useTestProvider = process.env.CMFX_TEST_PROVIDER === "offline";
if (!useTestProvider && !arkAvailable) throw new Error("ARK_API_KEY is required for the real Ark live smoke.");
const arkEnabled = !useTestProvider;
const scenario = process.env.CMFX_LIVE_SCENARIO?.trim() || "all";
if (!["text", "image-svg", "all"].includes(scenario)) throw new Error("CMFX_LIVE_SCENARIO must be text, image-svg, or all.");

const editorRoot = resolve(import.meta.dirname, "..");
const root = await mkdtemp(join(tmpdir(), `codemotion-g0-5-${arkEnabled ? "ark" : "offline"}-${scenario}-`));
const host = "127.0.0.1";
const port = 4174;
const origin = `http://${host}:${port}`;
const imagePath = resolve(root, "owner.png");
const videoPath = resolve(root, "owner.mp4");
const svgPath = resolve(root, "owner.svg");
const audioPath = resolve(root, "owner.wav");
const downloadPath = resolve(root, "browser-output.mp4");
const providerAudits = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0x20c997:s=320x180:d=0.2", "-frames:v", "1", imagePath]);
await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0xff5a3c:s=320x180:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:a", "pcm_s16le", audioPath]);
await writeFile(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#112233"/><text x="24" y="100" fill="white" font-size="36">CMFX</text></svg>', "utf8");

const env = {
  ...process.env,
  NODE_ENV: "development",
  CODEMOTION_DEV_AUTH: "1",
  CODEMOTION_DEV_TENANT_ID: "g0-5-live-tenant",
  CODEMOTION_DEV_USER_ID: "g0-5-live-user",
  CODEMOTION_DEV_SCOPES: "ai:plan assets:read assets:write project:preview export:create export:read"
};

let runtime;
let server;
let browser;
let context;
try {
  const provider = arkEnabled
    ? new VolcengineArkProvider({
      apiKey: process.env.ARK_API_KEY,
      audit(record) { providerAudits.push(record); }
    })
    : new OfflineMockProvider();
  runtime = await createServerRuntime({
    mode: "development", configureServer: true, listenHost: host, publicOrigin: origin,
    mediaRoot: resolve(root, "media"), uploadTempRoot: resolve(root, "upload"),
    exportRoot: resolve(root, "exports"), env,
    createAiPlans: (assets) => new AiPlanService(provider, assets)
  });
  server = await createServer({
    root: editorRoot, configFile: false, plugins: [react(), {
      name: "g0-5-live-runtime",
      configureServer(vite) { vite.middlewares.use(runtime.handle); }
    }],
    server: { host, port, strictPort: true }
  });
  await server.listen();
  browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=swiftshader"] });
  context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("401 (Unauthorized)")) browserErrors.push(message.text());
  });

  const automaticSession = page.waitForResponse((response) => response.url().endsWith("/auth/dev/auto-session"));
  await page.goto(origin, { waitUntil: "networkidle" });
  assert((await automaticSession).status() === 201, "Development session was not created automatically.");
  await page.locator(".ai-session").waitFor();
  assert(await page.getByText("绑定本地一次性 code").count() === 0, "Legacy code binding UI is still present.");

  const fileInput = page.locator('input[type="file"]');
  const upload = async (path, purpose) => {
    const count = await page.locator(".ai-asset-option").count();
    await page.getByLabel("上传用途").selectOption(purpose);
    await fileInput.setInputFiles(path);
    await page.waitForFunction((previous) => document.querySelectorAll(".ai-asset-option").length > previous, count);
  };
  if (scenario !== "text") {
    await upload(imagePath, "reference-image");
    await upload(svgPath, "logo");
  }
  if (scenario === "all") {
    await upload(videoPath, "reference-video");
    await upload(audioPath, "reference-audio");
  }
  const expectedAssetCount = scenario === "text" ? 0 : scenario === "image-svg" ? 2 : 4;
  assert(await page.locator(".ai-asset-option").count() === expectedAssetCount, "Browser did not list the expected owner media kinds.");
  await page.getByLabel("动画规划文本").fill("基于上传的图片、视频、SVG Logo 和音频生成两秒产品标题动画，文字为 CodeMotion FX，使用克制的绿色动效。");
  if (scenario === "text") {
    await page.locator("textarea").first().fill("Create a restrained two-second title animation. The visible text must be CodeMotion FX.");
  } else if (scenario === "image-svg") {
    await page.locator("textarea").first().fill("Create a restrained two-second title animation using the uploaded image and SVG logo. The visible text must be CodeMotion FX.");
  }
  await page.locator(".ai-submit").click();
  await Promise.race([
    page.locator(".ai-status.success").waitFor({ timeout: 300_000 }),
    page.locator(".ai-task-error").waitFor({ timeout: 300_000 }).then(async () => {
      const failed = await page.evaluate(async () => (await (await fetch("/api/ai-plans")).json()).tasks[0]);
      const safeDiagnostics = providerAudits
        .filter((record) => record.endpoint === "responses.create" && (record.reason || record.errorCode))
        .map((record) => ({ reason: record.reason, attempt: record.attempt, errorCode: record.errorCode, requestFingerprint: record.requestFingerprint }));
      console.error(JSON.stringify({ result: "failed", scenario, browserError: failed?.error, safeDiagnostics, tempDirectory: root }));
      throw new Error(`Live AI task failed: ${await page.locator(".ai-task-error").textContent()}`);
    })
  ]);

  const completed = await page.evaluate(async () => (await (await fetch("/api/ai-plans")).json()).tasks[0]);
  assert(completed.result?.contract === "ai-plan-result/v2", "Browser did not receive ai-plan-result/v2.");
  assert(!("dsl" in completed.result), "Raw DSL leaked into the browser result.");
  assert(expectedAssetCount === 0 || JSON.stringify(completed.result).includes("cmfx-browser-asset://opaque"), "Safe asset projection was absent.");
  assert(!/provider|modelId|requestFingerprint|hash|storedPath|rasterProxyPath/i.test(JSON.stringify(completed.result)), "Internal AI or media authority leaked.");
  assert(completed.result.editableProject.project.assets.length === expectedAssetCount, "AI result did not retain the expected opaque owner assets.");

  await page.locator(".enter-editor").click();
  await page.locator(".backend-status.ok").waitFor({ timeout: 30_000 });
  const canvas = await page.locator('canvas[aria-label="WebGL 合成预览"]').evaluate((element) => {
    const context = element.getContext("2d");
    const pixels = context?.getImageData(0, 0, element.width, element.height).data;
    return { width: element.width, height: element.height, alpha: pixels ? [...pixels].some((_, index) => index % 4 === 3 && pixels[index] > 0) : false };
  });
  assert(canvas.width === 240 && canvas.height === 135 && canvas.alpha, "Server 240x135 RGBA preview was blank or incorrectly sized.");

  await page.locator(".render-button").click();
  const numbers = page.locator('.export-settings input[type="number"]');
  await numbers.nth(0).fill("64");
  await numbers.nth(1).fill("36");
  await numbers.nth(2).fill("12");
  await numbers.nth(3).fill("0.25");
  if (scenario === "all") await page.getByLabel("包含音轨").check();
  else await page.getByLabel("包含音轨").uncheck();
  await page.locator(".export-start").click();
  await page.locator(".task-row").first().waitFor();
  await page.waitForFunction(() => document.querySelector(".task-row span")?.textContent === "completed", undefined, { timeout: 120_000 });
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "认证下载" }).click();
  const download = await downloadEvent;
  await download.saveAs(downloadPath);
  assert((await stat(downloadPath)).size > 0, "Authenticated browser download was empty.");
  const probe = JSON.parse((await runProcess("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", downloadPath])).stdout);
  assert(probe.streams.some((stream) => stream.codec_name === "h264"), "Downloaded output did not contain H.264 video.");
  assert(scenario !== "all" || probe.streams.some((stream) => stream.codec_name === "aac"), "Downloaded output did not contain AAC audio.");
  await runProcess("ffmpeg", ["-v", "error", "-i", downloadPath, "-f", "null", "-"]);

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await page.locator(".backend-status.ok").waitFor({ timeout: 30_000 });
  await page.locator(".render-button").click();
  await page.locator(".task-row").first().waitFor();
  assert((await page.locator(".task-row").first().textContent()).includes("completed"), "Reload did not recover export history.");
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
  const generationAttempts = [...new Set(providerAudits
    .filter((record) => record.endpoint === "responses.create" && record.attempt !== undefined)
    .map((record) => record.attempt))].sort();
  console.log(JSON.stringify({
    result: "pass",
    provider: arkEnabled ? "volcengine-ark" : "test-only-offline",
    scenario,
    generationAttempts,
    safeReasons: providerAudits.filter((record) => record.reason).map((record) => ({ reason: record.reason, attempt: record.attempt })),
    contract: completed.result.contract,
    assets: completed.result.editableProject.project.assets.map((asset) => asset.type).sort(),
    preview: canvas,
    downloadBytes: (await stat(downloadPath)).size,
    streams: probe.streams.map((stream) => ({ codec_name: stream.codec_name, codec_type: stream.codec_type, width: stream.width, height: stream.height })),
    format: probe.format.format_name,
    duration: probe.format.duration,
    tempDirectory: root
  }));
} finally {
  const cleanup = await Promise.allSettled([
    context?.close(),
    browser?.close(),
    server?.close(),
    runtime?.close()
  ].filter(Boolean));
  const failures = cleanup.filter((result) => result.status === "rejected");
  if (failures.length > 0) throw new AggregateError(failures.map((result) => result.reason), "Live smoke cleanup failed.");
}
