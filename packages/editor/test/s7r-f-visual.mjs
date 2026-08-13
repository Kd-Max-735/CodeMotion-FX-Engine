import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { createServerRuntime } from "../dist/server-runtime.js";

const editorRoot = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(editorRoot, "../..");
const outputDir = resolve(editorRoot, "tmp/stage-7r-f");
const host = "127.0.0.1";
const port = 4174;
const origin = `http://${host}:${port}`;
const execFile = promisify(execFileCallback);
await mkdir(outputDir, { recursive: true });

process.env.NODE_ENV = "development";
process.env.CODEMOTION_DEV_AUTH = "1";
process.env.CODEMOTION_DEV_TENANT_ID = "qa-tenant";
process.env.CODEMOTION_DEV_USER_ID = "qa-user";
process.env.CODEMOTION_DEV_SCOPES = "ai:plan assets:read assets:write project:preview export:create export:read";

const mediaRoot = resolve(workspaceRoot, "tmp/stage-7r-f-media");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function task(status = "running") {
  return {
    id: "task_server_owned",
    status,
    phase: status === "cancelled" ? "cleanup" : "accepted",
    events: [],
    createdAt: "2026-07-31T08:00:00.000Z",
    updatedAt: "2026-07-31T08:00:01.000Z",
    modalities: ["text", "image"],
    ...(status === "cancelled" ? { error: { code: "cancelled", message: "分析已取消。", retryable: false } } : {})
  };
}

async function assertLayout(page, label) {
  const report = await page.evaluate(() => ({
    documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    clipped: [...document.querySelectorAll("button")]
      .filter((node) => node.getClientRects().length > 0 && node.scrollWidth > node.clientWidth + 2)
      .map((node) => node.getAttribute("aria-label") ?? node.textContent?.trim())
  }));
  assert(!report.documentOverflow, `${label} has horizontal document overflow.`);
  assert(report.clipped.length === 0, `${label} has clipped buttons: ${report.clipped.join(", ")}`);
}

async function authenticate(page) {
  const automaticSession = page.waitForResponse((response) => response.url().endsWith("/auth/dev/auto-session"));
  await page.goto(origin, { waitUntil: "networkidle" });
  assert((await automaticSession).status() === 201, "Development session was not created automatically.");
  const openPlanner = page.getByRole("button", { name: "打开 AI 规划" });
  if (await openPlanner.count()) await openPlanner.click();
  await page.locator(".ai-session").waitFor();
  assert(await page.getByText("绑定本地一次性 code").count() === 0, "Legacy code binding UI is still present.");
}

async function installAiRoute(page, evidence) {
  let currentTasks = [];
  await page.route("**/api/ai-plans**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/ai-plans") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true, tasks: currentTasks }) });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/api/ai-plans") {
      evidence.create = { body: request.postDataJSON(), headers: request.headers() };
      currentTasks = [task()];
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ task: currentTasks[0] }) });
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/cancel")) {
      evidence.cancel = { headers: request.headers() };
      currentTasks = [task("cancelled")];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ task: currentTasks[0] }) });
      return;
    }
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

const configuredExecutablePath = process.env.CMFX_PLAYWRIGHT_EXECUTABLE_PATH?.trim() || undefined;
const configuredChannel = process.env.CMFX_PLAYWRIGHT_CHANNEL?.trim() || "msedge";
const browserSelection = configuredExecutablePath
  ? { executablePath: configuredExecutablePath }
  : { channel: configuredChannel };

async function launchBrowser() {
  try {
    return await chromium.launch({
      ...browserSelection,
      headless: true,
      args: ["--use-angle=swiftshader"]
    });
  } catch {
    throw new Error(
      "Playwright could not launch the selected browser. Install the configured channel or set CMFX_PLAYWRIGHT_EXECUTABLE_PATH to an executable browser."
    );
  }
}

async function createBrowserContext(browser) {
  if (process.env.CMFX_PLAYWRIGHT_TEST_NEW_CONTEXT_FAILURE === "1") {
    throw new Error("Synthetic browser context creation failure.");
  }
  return browser.newContext({ viewport: { width: 1440, height: 1000 } });
}

async function runQa(context) {
  const errors = [];
  const desktop = await context.newPage();
  desktop.on("pageerror", (error) => errors.push(error.message));
  desktop.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await authenticate(desktop);
  errors.length = 0;
  const pngPath = resolve(outputDir, "qa-reference.png");
  await execFile("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x12:d=0.1", "-frames:v", "1", "-y", pngPath]);
  const png = await readFile(pngPath);
  const uploadResponse = desktop.waitForResponse((response) => response.url().endsWith("/api/media-assets") && response.request().method() === "POST");
  await desktop.locator("input[type=file]").setInputFiles({ name: "qa-reference.png", mimeType: "image/png", buffer: png });
  const uploadResult = await uploadResponse;
  const uploadError = uploadResult.status() === 201 ? undefined : await uploadResult.json().catch(() => ({}));
  assert(uploadResult.status() === 201, `Authenticated multipart upload failed: HTTP ${uploadResult.status()} ${uploadError?.error?.code ?? "UNKNOWN"}.`);
  await desktop.locator(".ai-asset-option", { hasText: "qa-reference.png" }).waitFor();
  assert(await desktop.locator(".ai-asset-option input[type=checkbox]").first().isChecked(), "Uploaded opaque asset was not selected.");

  const evidence = {};
  await installAiRoute(desktop, evidence);
  await desktop.waitForFunction(() => document.querySelector(".ai-provider-state")?.textContent?.includes("Provider 已连接"));
  await desktop.getByLabel("动画规划文本").fill("制作品牌片头");
  await desktop.getByLabel("画布宽度").fill("1080");
  await desktop.getByLabel("画布高度").fill("1920");
  await desktop.getByLabel("风格").fill("极简, 动态排版");
  await desktop.getByLabel("品牌语气").fill("专业, 克制");
  await desktop.getByLabel("必须出现的文字").fill("CodeMotion\nFX");
  await desktop.getByLabel("禁止内容").fill("水印\n竞品");
  await desktop.getByRole("button", { name: "创建规划任务" }).click();
  await desktop.getByRole("button", { name: "取消" }).waitFor();
  assert(evidence.create.body.contract === "ai-task/v1", "Planner did not submit ai-task/v1.");
  assert(Object.keys(evidence.create.body).join(",") === "contract,prompt,assets,canvas,durationSeconds,style,brand", "Planner submitted extra top-level fields.");
  assert(evidence.create.body.assets.length === 1 && /^asset_[a-f0-9]{24}$/.test(evidence.create.body.assets[0].assetId), "Planner did not submit the opaque server asset ID.");
  assert(evidence.create.body.brand.requiredText.join("|") === "CodeMotion|FX", "requiredText did not remain structured.");
  assert(evidence.create.body.brand.forbiddenContent.join("|") === "水印|竞品", "forbiddenContent did not remain structured.");
  assert(Boolean(evidence.create.headers["x-cmfx-csrf"]), "Create omitted CSRF.");
  await desktop.getByRole("button", { name: "取消" }).click();
  await desktop.locator(".ai-task-list button").first().getByText("cancelled", { exact: true }).waitFor();
  assert(Boolean(evidence.cancel.headers["x-cmfx-csrf"]), "Cancel omitted CSRF.");
  await assertLayout(desktop, "desktop planner");
  await desktop.screenshot({ path: resolve(outputDir, "planner-desktop.png"), fullPage: true });

  await desktop.getByRole("button", { name: "返回工作台" }).click();
  await desktop.locator(".project-tile.featured").click();
  await desktop.locator(".backend-status.ok").waitFor({ timeout: 15_000 });
  await desktop.evaluate(() => window.scrollTo(0, 0));
  const grid = desktop.getByRole("button", { name: "网格" });
  await grid.click();
  assert(await grid.getAttribute("aria-pressed") === "true" && await desktop.locator(".canvas-grid").count() === 1, "Grid state did not control the overlay.");
  const frameTool = desktop.getByRole("button", { name: "框选工具" });
  await frameTool.click();
  await frameTool.waitFor();
  assert(await frameTool.getAttribute("aria-pressed") === "true", "Frame-select tool did not activate.");
  const frame = desktop.locator(".canvas-frame");
  await frame.scrollIntoViewIfNeeded();
  const box = await frame.boundingBox();
  assert(box && box.x >= 0 && box.y >= 0, "Canvas frame is unavailable or outside the viewport.");
  await desktop.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await desktop.mouse.down();
  await desktop.locator(".marquee-box").waitFor();
  await desktop.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.75, { steps: 5 });
  assert(await desktop.locator(".marquee-box").count() === 1, "Frame-select marquee was not rendered during drag.");
  await desktop.mouse.up();
  await desktop.locator(".selection-box label", { hasText: "CodeMotion FX" }).waitFor();
  await desktop.getByRole("button", { name: "选择工具" }).click();
  const scaleBefore = Number(await desktop.locator(".schema-field").filter({ hasText: "Scale X" }).locator("input").inputValue());
  const handle = desktop.getByRole("button", { name: "右下缩放控制柄" });
  const handleBox = await handle.boundingBox();
  assert(handleBox, "Selection handle is unavailable.");
  await desktop.mouse.move(handleBox.x + 5, handleBox.y + 5);
  await desktop.mouse.down();
  await handle.dispatchEvent("pointercancel", { pointerId: 1 });
  await desktop.mouse.up();
  const handleBoxAfterCancel = await handle.boundingBox();
  await desktop.mouse.move(handleBoxAfterCancel.x + 5, handleBoxAfterCancel.y + 5);
  await desktop.mouse.down();
  await desktop.mouse.move(handleBoxAfterCancel.x + 45, handleBoxAfterCancel.y + 35, { steps: 4 });
  await desktop.mouse.up();
  const scaleAfter = Number(await desktop.locator(".schema-field").filter({ hasText: "Scale X" }).locator("input").inputValue());
  assert(scaleAfter > scaleBefore, "Handle drag did not update formal transform scale.");
  await assertLayout(desktop, "desktop editor");
  await desktop.screenshot({ path: resolve(outputDir, "editor-desktop.png"), fullPage: true });

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  mobile.on("pageerror", (error) => errors.push(error.message));
  mobile.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await installAiRoute(mobile, {});
  await mobile.goto(origin, { waitUntil: "networkidle" });
  await mobile.getByRole("button", { name: "打开 AI 规划" }).click();
  await mobile.locator(".ai-session").waitFor();
  await assertLayout(mobile, "mobile planner");
  await mobile.screenshot({ path: resolve(outputDir, "planner-mobile.png"), fullPage: true });
  await mobile.close();
  assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);
  return { screenshots: outputDir, upload: "201", create: "ai-task/v1", cancel: "ok", canvas: "ok" };
}

async function closeResource(name, resource, close, states, failures) {
  if (!resource) return;
  try {
    await close();
    states[name] = "closed";
  } catch (error) {
    states[name] = "close-failed";
    failures.push({ name, error });
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Visual QA failed.";
}

async function main() {
  let runtime;
  let server;
  let browser;
  let context;
  let qaResult;
  let primaryError;
  const cleanupFailures = [];
  const resources = {
    runtime: "not-acquired",
    server: "not-acquired",
    browser: "not-acquired",
    context: "not-acquired"
  };

  try {
    runtime = await createServerRuntime({
      mode: "development",
      configureServer: true,
      listenHost: host,
      publicOrigin: origin,
      mediaRoot,
      uploadTempRoot: resolve(workspaceRoot, "tmp/stage-7r-f-upload")
    });
    resources.runtime = "acquired";

    server = await createServer({
      root: editorRoot,
      configFile: false,
      plugins: [react(), {
        name: "s7r-f-runtime",
        configureServer(vite) {
          vite.middlewares.use(runtime.handle);
        }
      }],
      server: { host, port, strictPort: true }
    });
    resources.server = "acquired";
    await server.listen();

    browser = await launchBrowser();
    resources.browser = "acquired";
    context = await createBrowserContext(browser);
    resources.context = "acquired";
    qaResult = await runQa(context);
  } catch (error) {
    primaryError = error;
  } finally {
    await closeResource("context", context, () => context.close(), resources, cleanupFailures);
    await closeResource("browser", browser, () => browser.close(), resources, cleanupFailures);
    await closeResource("server", server, () => server.close(), resources, cleanupFailures);
    await closeResource("runtime", runtime, () => runtime.close(), resources, cleanupFailures);
  }

  const cleanupFailureNames = cleanupFailures.map(({ name }) => name);
  if (primaryError) {
    console.error(JSON.stringify({ qa: "failed", resources, cleanupFailures: cleanupFailureNames }));
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [primaryError, ...cleanupFailures.map(({ error }) => error)],
        `${errorMessage(primaryError)} Cleanup also failed for: ${cleanupFailureNames.join(", ")}.`
      );
    }
    throw primaryError;
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures.map(({ error }) => error),
      `Visual QA cleanup failed for: ${cleanupFailureNames.join(", ")}.`
    );
  }

  console.log(JSON.stringify({ ...qaResult, resources }));
}

try {
  await main();
} catch (error) {
  console.error(errorMessage(error));
  process.exitCode = 1;
}
