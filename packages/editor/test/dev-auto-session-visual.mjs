import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const origin = "http://127.0.0.1:4174";
const npmCli = process.env.npm_execpath;
const authEnvironmentNames = [
  "NODE_ENV", "CODEMOTION_DEV_AUTH", "CODEMOTION_DEV_TENANT_ID", "CODEMOTION_DEV_USER_ID",
  "CODEMOTION_DEV_SCOPES", "CODEMOTION_DEV_LOGIN_CODE_FILE"
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cleanEnvironment() {
  const env = { ...process.env };
  for (const name of authEnvironmentNames) delete env[name];
  return env;
}

function startDev() {
  if (!npmCli) throw new Error("npm_execpath is unavailable.");
  const child = spawn(process.execPath, [npmCli, "run", "dev"], {
    cwd: workspaceRoot,
    env: cleanEnvironment(),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  return { child, output: () => output };
}

async function waitForServer(developmentProcess, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (developmentProcess.child.exitCode !== null) throw new Error(`Development server exited early.\n${developmentProcess.output()}`);
    try {
      const response = await fetch(origin);
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Development server did not become ready.\n${developmentProcess.output()}`);
}

async function stopDev(developmentProcess) {
  if (developmentProcess.child.exitCode === null && process.platform === "win32") {
    await new Promise((resolveStop) => {
      const killer = spawn("taskkill", ["/pid", String(developmentProcess.child.pid), "/t", "/f"], { windowsHide: true });
      killer.once("exit", resolveStop);
      killer.once("error", resolveStop);
    });
  } else if (developmentProcess.child.exitCode === null) {
    developmentProcess.child.kill("SIGTERM");
  }
  if (process.platform === "win32") {
    await new Promise((resolveStop) => {
      const listener = spawn("powershell.exe", [
        "-NoProfile", "-Command",
        "Get-NetTCPConnection -LocalPort 4174 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }"
      ], { windowsHide: true });
      listener.once("exit", resolveStop);
      listener.once("error", resolveStop);
    });
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { await fetch(origin); }
    catch { return; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("Development server still owns port 4174 after shutdown.");
}

async function expectStrictPortFailure() {
  const second = startDev();
  await Promise.race([
    new Promise((resolveExit) => second.child.once("exit", resolveExit)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Second dev server did not fail on occupied port 4174.")), 15_000))
  ]);
  const output = second.output();
  assert(second.child.exitCode !== 0, "Second dev server unexpectedly succeeded.");
  assert(/4174.*already in use|Port 4174 is already in use/iu.test(output), `Strict-port failure was unclear.\n${output}`);
  assert(!output.includes("4175"), "Vite silently selected port 4175.");
}

let development = startDev();
let browser;
try {
  await waitForServer(development);
  await expectStrictPortFailure();
  browser = await chromium.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true,
    args: ["--use-angle=swiftshader"]
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const browserErrors = [];
  let automaticSessions = 0;
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("401 (Unauthorized)")
      && !text.includes("ERR_CONNECTION_REFUSED")) browserErrors.push(text);
  });
  page.on("response", (response) => {
    if (response.url().endsWith("/auth/dev/auto-session") && response.status() === 201) automaticSessions += 1;
  });

  await page.goto(origin, { waitUntil: "networkidle" });
  await page.locator(".creator-workspace").waitFor();
  assert(automaticSessions === 1, "A fresh browser did not create exactly one automatic session.");
  const expectedScopes = ["ai:plan", "assets:read", "assets:write", "project:preview", "export:create", "export:read"];
  const session = await page.evaluate(async () => (await fetch("/api/session")).json());
  assert(session.principal.tenantId === "local-tenant" && session.principal.userId === "local-user", "Default local identity is incorrect.");
  assert(JSON.stringify(session.principal.scopes) === JSON.stringify(expectedScopes), "Default local scopes are incorrect.");
  const cookies = await context.cookies(origin);
  const sessionCookie = cookies.find((cookie) => cookie.name === "cmfx_dev_session");
  const csrfCookie = cookies.find((cookie) => cookie.name === "cmfx_dev_csrf");
  assert(sessionCookie?.httpOnly === true && sessionCookie.sameSite === "Strict", "Development session cookie flags regressed.");
  assert(csrfCookie?.httpOnly === false && csrfCookie.sameSite === "Strict", "Development CSRF cookie flags regressed.");
  assert(await page.evaluate(() => !Object.values(localStorage).some((value) => /local-(tenant|user)|ai:plan/.test(value))), "Principal data leaked to localStorage.");

  await page.locator(".creator-user[title='退出登录']").waitFor();
  assert(await page.getByText("绑定本地一次性 code").count() === 0, "Legacy code binding button is present.");
  assert(await page.getByLabel("终端一次性 code").count() === 0, "Legacy code input is present.");
  const apiStatuses = await page.evaluate(async () => ({
    assets: (await fetch("/api/media-assets?limit=1")).status,
    ai: (await fetch("/api/ai-plans")).status
  }));
  assert(apiStatuses.assets === 200 && apiStatuses.ai === 200, "Authorized asset or AI API was unavailable.");

  await page.reload({ waitUntil: "networkidle" });
  assert(automaticSessions === 1, "Refresh replaced a still-valid server session.");

  await stopDev(development);
  development = startDev();
  await waitForServer(development);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".creator-workspace").waitFor();
  assert(automaticSessions === 2, "Service restart did not create a replacement session automatically.");
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
  console.log(JSON.stringify({
    zeroEnvironmentStart: true,
    strictPort: true,
    freshSession: true,
    refreshSession: true,
    restartSession: true,
    scopes: expectedScopes,
    legacyCodeUi: false
  }));
} finally {
  await browser?.close();
  await stopDev(development);
}
