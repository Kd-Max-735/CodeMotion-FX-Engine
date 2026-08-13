import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { P0_EFFECT_CARDS } from "@codemotion/effects-2d";

const origin = process.env.CMFX_EDITOR_URL ?? "http://127.0.0.1:4174";
const outputDir = resolve(import.meta.dirname, "../../../tmp/v22-card-visual");
const effectIds = P0_EFFECT_CARDS.map((card) => card.effectId);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function safeName(effectId) {
  return effectId.replaceAll(".", "-");
}

async function authenticate(page) {
  const automaticSession = page.waitForResponse((response) => response.url().endsWith("/auth/dev/auto-session"));
  await page.goto(origin, { waitUntil: "networkidle" });
  assert((await automaticSession).status() === 201, "Development session was not created automatically.");
  await page.locator(".creator-user").waitFor();
  assert(await page.getByText("绑定本地一次性 code").count() === 0, "Legacy code binding UI is still present.");
  assert(await page.getByLabel("终端一次性 code").count() === 0, "Legacy code input is still present.");
}

async function canvasEvidence(card) {
  return card.locator("canvas").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    if (!context) return { nonBlank: false, hash: 0, width: 0, height: 0 };
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    let hash = 2166136261;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] > 0 && (pixels[offset] + pixels[offset + 1] + pixels[offset + 2]) > 0) colored += 1;
      if (offset % 388 === 0) hash = Math.imul(hash ^ pixels[offset] ^ pixels[offset + 3], 16777619);
    }
    return { nonBlank: colored > 24, hash: hash >>> 0, width: canvas.width, height: canvas.height };
  });
}

async function waitProgress(page, effectId, minimum, maximum) {
  await page.waitForFunction(({ effectId: id, minimum: min, maximum: max }) => {
    const canvas = document.querySelector(`[data-effect-id="${id}"] canvas`);
    const progress = Number(canvas?.dataset.previewProgress);
    return Number.isFinite(progress) && progress >= min && progress <= max;
  }, { effectId, minimum, maximum }, { timeout: 15_000 });
}

async function assertLayout(page, label) {
  const report = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".sample-effect-card")];
    return {
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      cardOverflow: cards.filter((card) => card.scrollWidth > card.clientWidth + 1).map((card) => card.dataset.effectId),
      clippedText: [...document.querySelectorAll(".sample-effect-card button, .sample-effect-card b, .sample-effect-card p")]
        .filter((node) => node.getClientRects().length > 0 && node.scrollWidth > node.clientWidth + 3)
        .map((node) => node.closest(".sample-effect-card")?.dataset.effectId)
    };
  });
  assert(!report.overflow, `${label} has document horizontal overflow.`);
  assert(report.cardOverflow.length === 0, `${label} card overflow: ${report.cardOverflow.join(", ")}`);
  assert(report.clippedText.length === 0, `${label} clipped card text: ${report.clippedText.join(", ")}`);
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader"]
});

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  const active = new Set();
  const originalRequest = window.requestAnimationFrame.bind(window);
  const originalCancel = window.cancelAnimationFrame.bind(window);
  window.__cmfxRafActive = active;
  window.requestAnimationFrame = (callback) => {
    let id = 0;
    id = originalRequest((time) => { active.delete(id); callback(time); });
    active.add(id);
    return id;
  };
  window.cancelAnimationFrame = (id) => { active.delete(id); originalCancel(id); };
});
const page = await context.newPage();
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
page.on("pageerror", (error) => errors.push(error.message));

try {
  await authenticate(page);
  errors.length = 0;
  await page.getByLabel("描述视频内容").waitFor();
  const cards = page.locator(".creator-card-grid .sample-effect-card");
  await cards.first().waitFor();
  assert(await cards.count() === 40, `Expected 40 effect cards, found ${await cards.count()}.`);
  assert(await page.locator(".sample-effect-card canvas").count() === 40, "Each card must own exactly one Canvas.");
  const firstViewportCards = await cards.evaluateAll((items) => items.filter((item) => item.getBoundingClientRect().top < innerHeight).length);
  assert(firstViewportCards >= 4, `Only ${firstViewportCards} cards are visible in the 1440x900 first viewport.`);
  await assertLayout(page, "desktop");
  await page.screenshot({ path: resolve(outputDir, "desktop-1440x900.png"), fullPage: true });

  const baselineRaf = await page.evaluate(() => window.__cmfxRafActive.size);
  for (const effectId of effectIds) {
    const card = page.locator(`[data-effect-id="${effectId}"]`);
    await card.scrollIntoViewIfNeeded();
    const still = await canvasEvidence(card);
    assert(still.nonBlank && still.width === 160 && still.height === 90, `${effectId} representative frame is blank or mis-sized.`);
    await card.hover();
    await page.waitForFunction((id) => document.querySelector(`[data-effect-id="${id}"]`)?.dataset.previewActive === "true", effectId);
    await waitProgress(page, effectId, 0, 0.14);
    const start = await canvasEvidence(card);
    await card.screenshot({ path: resolve(outputDir, `${safeName(effectId)}-start.png`) });
    await waitProgress(page, effectId, 0.43, 0.58);
    const middle = await canvasEvidence(card);
    await card.screenshot({ path: resolve(outputDir, `${safeName(effectId)}-middle.png`) });
    await waitProgress(page, effectId, 0.86, 0.999);
    const end = await canvasEvidence(card);
    await card.screenshot({ path: resolve(outputDir, `${safeName(effectId)}-end.png`) });
    assert(new Set([start.hash, middle.hash, end.hash]).size > 1, `${effectId} preview did not change with logical time.`);
    await page.locator(".gallery-heading").first().hover();
    await page.waitForFunction((id) => document.querySelector(`[data-effect-id="${id}"]`)?.dataset.previewActive === "false", effectId);
    assert(await page.locator(".sample-effect-card canvas").count() === 40, `${effectId} changed Canvas ownership.`);
  }
  await page.waitForTimeout(100);
  const settledRaf = await page.evaluate(() => window.__cmfxRafActive.size);
  assert(settledRaf <= baselineRaf + 1, `RAF cleanup regressed: baseline ${baselineRaf}, settled ${settledRaf}.`);

  const firstCard = page.locator(`[data-effect-id="${effectIds[0]}"]`);
  for (let index = 0; index < 4; index += 1) {
    await firstCard.hover();
    await page.waitForTimeout(60);
    await page.locator(".gallery-heading").first().hover();
  }
  await page.waitForTimeout(100);
  assert(await page.locator(".sample-effect-card canvas").count() === 40, "Repeated hover leaked Canvas elements.");
  assert(await page.evaluate(() => window.__cmfxRafActive.size) <= baselineRaf + 1, "Repeated hover leaked RAF callbacks.");

  await page.setViewportSize({ width: 1920, height: 1080 });
  await assertLayout(page, "wide desktop");
  const wideColumnCounts = await page.locator(".creator-card-grid").evaluateAll((grids) =>
    grids.map((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length)
  );
  assert(wideColumnCounts.length === 8, `Expected eight category grids, found ${wideColumnCounts.length}.`);
  assert(wideColumnCounts.every((count) => count === 4), `Wide desktop category columns: ${wideColumnCounts.join(", ")}.`);
  await page.screenshot({ path: resolve(outputDir, "desktop-1920x1080.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".gallery-heading").first().scrollIntoViewIfNeeded();
  await assertLayout(page, "mobile");
  await page.screenshot({ path: resolve(outputDir, "mobile-catalog.png"), fullPage: true });
  await firstCard.locator(".sample-card-preview").dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 7 });
  assert(await firstCard.getAttribute("data-preview-active") === "true", "Touch preview fallback did not start.");
  await firstCard.locator(".sample-card-preview").dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 8 });
  assert(await firstCard.getAttribute("data-preview-active") === "false", "Touch preview fallback did not stop.");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".recent-projects > button").click();
  await page.locator(".backend-status.ok").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "特效", exact: true }).click();
  assert(await page.locator(".left-panel .sample-effect-card").count() === 40, "Editor did not retain the same 40 effect cards.");
  assert(await page.locator(".effect-catalog .effect-item").count() === 40, "The complete 40-effect manual catalog regressed.");
  assert(errors.length === 0, `Browser errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ cards: 40, firstViewportCards, catalog: 40, evidenceFrames: 120, desktop1440: true, desktop1920: true, mobile: true, editor: true, rafBaseline: baselineRaf, rafSettled: settledRaf }));
} finally {
  await context.close();
  await browser.close();
}
