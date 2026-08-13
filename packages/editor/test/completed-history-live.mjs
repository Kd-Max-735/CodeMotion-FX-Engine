import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const origin = "http://127.0.0.1:4174";
const sourceRecord = JSON.parse(await readFile(resolve("tmp/exports/d117c1cb-1b62-4796-a350-81c187495ca7/task-record-v1.json"), "utf8"));
const envelope = structuredClone(sourceRecord.envelope);
envelope.project.name = "Completed history clear evidence";
envelope.project.width = 64;
envelope.project.height = 36;
envelope.project.fps = 30;
envelope.project.duration = 0.1;
for (const composition of envelope.project.compositions) {
  composition.width = 64;
  composition.height = 36;
  composition.fps = 30;
  composition.duration = 0.1;
  for (const layer of composition.layers) {
    layer.endTime = 0.1;
    layer.outPoint = 0.1;
    for (const effect of layer.effects) effect.endTime = 0.1;
  }
}
const settings = { format: "mp4", width: 64, height: 36, fps: 30, duration: 0.1, alpha: false, audio: false };

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(origin, { waitUntil: "networkidle" });
  if (await page.locator(".creator-user").count() === 0) {
    await page.reload({ waitUntil: "networkidle" });
  }
  const created = await page.evaluate(async ({ editableProject, exportSettings }) => {
    const listed = await (await fetch("/api/editor-exports", { credentials: "same-origin" })).json();
    const existing = listed.tasks.find((task) => task.projectName === "Completed history clear evidence");
    if (existing) return { status: 202, body: { task: existing } };
    const csrf = document.cookie.split("; ").find((entry) => entry.startsWith("cmfx_dev_csrf="))?.split("=")[1];
    const response = await fetch("/api/editor-exports", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CMFX-CSRF": decodeURIComponent(csrf ?? "") },
      body: JSON.stringify({ contract: "export-request/v1", editableProject, settings: exportSettings })
    });
    return { status: response.status, body: await response.json() };
  }, { editableProject: envelope, exportSettings: settings });
  if (created.status !== 202) throw new Error(`Create failed: ${created.status} ${JSON.stringify(created.body)}`);
  const taskId = created.body.task.id;
  await page.waitForFunction(async (id) => {
    const response = await fetch(`/api/editor-exports/${id}`);
    if (!response.ok) return false;
    return (await response.json()).task.status === "completed";
  }, taskId, { timeout: 30_000 });
  if (await page.locator(".creator-workspace").count()) await page.locator(".creator-nav button").nth(2).click();
  await page.locator(".project-tile.featured").click();
  await page.locator(".render-button").click();
  const row = page.locator(".task-row", { hasText: "Completed history clear evidence" });
  await row.waitFor();
  await row.click();
  page.once("dialog", (dialog) => dialog.accept());
  const deletion = page.waitForResponse((response) => response.url().endsWith(`/api/editor-exports/${taskId}`) && response.request().method() === "DELETE");
  await page.locator(".task-actions button", { hasText: "清除记录" }).click();
  const response = await deletion;
  if (response.status() !== 204) throw new Error(`Clear failed: ${response.status()}`);
  await page.reload({ waitUntil: "networkidle" });
  const remains = await page.evaluate(async (id) => (await (await fetch("/api/editor-exports")).json()).tasks.some((task) => task.id === id), taskId);
  if (remains) throw new Error("Cleared completed task reappeared after reload.");
  console.log(JSON.stringify({ taskId, completed: true, clearStatus: response.status(), absentAfterReload: true }));
} finally {
  await browser.close();
}
