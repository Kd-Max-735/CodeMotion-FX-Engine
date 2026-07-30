import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";
import { importMedia, runProcess } from "@codemotion/exporter";
import { saveProject } from "@codemotion/schema";
import { createStarterProject } from "../dist/index.js";
import { P0_EDITOR_EFFECTS, effectParameterFields } from "../dist/effect-catalog.js";

const baseUrl = process.env.CMFX_EDITOR_URL ?? "http://127.0.0.1:4174";
const formalOnly = process.env.CMFX_S5R_FORMAL_ONLY === "1";
const evidenceDirectory = resolve(import.meta.dirname, "../../../tmp/stage-5r-editor");
const evidencePath = resolve(evidenceDirectory, "s5r-browser-evidence.json");
const inputDirectory = resolve(evidenceDirectory, "input");
const mediaDirectory = resolve(import.meta.dirname, "../../../tmp/stage-6-media");
await mkdir(evidenceDirectory, { recursive: true });
await mkdir(inputDirectory, { recursive: true });

const imagePath = resolve(inputDirectory, "s5r-alpha.png");
const videoPath = resolve(inputDirectory, "s5r-motion.mp4");
await runProcess("ffmpeg", [
  "-hide_banner", "-y", "-f", "lavfi", "-i",
  "color=c=black@0:s=64x36:d=1,format=rgba,drawbox=x=8:y=6:w=48:h=24:color=0x28d7b2@0.78:t=fill",
  "-frames:v", "1", "-pix_fmt", "rgba", imagePath
]);
await runProcess("ffmpeg", [
  "-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x36:r=12:d=8.1",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath
]);
const image = await importMedia({
  sourcePath: imagePath,
  claimedMime: "image/png",
  allowedRoots: [inputDirectory],
  storageDirectory: mediaDirectory
});
const video = await importMedia({
  sourcePath: videoPath,
  claimedMime: "video/mp4",
  allowedRoots: [inputDirectory],
  storageDirectory: mediaDirectory
});

function constant(value) {
  return { mode: "constant", value };
}

function qaProject() {
  const project = createStarterProject("S5R browser matrix", 160, 90, 24);
  project.assets.push(image.asset, video.asset);
  const accent = project.compositions[0].layers.find((layer) => layer.id === "layer.accent");
  assert(accent, "Starter project has no shape layer.");
  const mediaTransform = {
    anchorPoint: constant({ x: 0, y: 0, z: 0 }),
    position: constant({ x: 0, y: 0, z: 0 }),
    scale: constant({ x: 100, y: 100, z: 100 }),
    rotation: constant({ x: 0, y: 0, z: 0 })
  };
  const maskData = Array.from({ length: 16 * 16 }, (_, index) => {
    const x = index % 16;
    return Math.round(Math.max(0, Math.min(1, (x - 2) / 11)) * 255);
  });
  const imageLayer = {
    ...structuredClone(accent),
    id: "layer.qa.image",
    name: "QA Masked Image",
    type: "image",
    zIndex: 3,
    transform: mediaTransform,
    opacity: constant(1),
    blendMode: "normal",
    source: { assetId: image.asset.id },
    masks: [{
      id: "mask.qa.coverage",
      name: "QA real alpha coverage",
      enabled: true,
      mode: "add",
      inverted: false,
      path: constant({ width: 16, height: 16, data: maskData, rowOrder: "top-to-bottom" }),
      opacity: constant(0.92),
      feather: constant({ x: 0, y: 0 })
    }],
    properties: { fit: "fill" }
  };
  const svgLayer = {
    ...structuredClone(accent),
    id: "layer.qa.svg",
    name: "QA SVG Path",
    type: "svg",
    zIndex: 4,
    transform: mediaTransform,
    opacity: constant(1),
    blendMode: "normal",
    properties: {
      svg: '<svg viewBox="0 0 160 90"><path d="M20 70 C45 10 108 10 140 68 L98 80 Z" fill="#36d6b0" stroke="#ffffff" stroke-width="2"/></svg>'
    }
  };
  const videoLayer = {
    ...structuredClone(accent),
    id: "layer.qa.video",
    name: "QA Video Input",
    type: "video",
    zIndex: 5,
    transform: mediaTransform,
    opacity: constant(1),
    blendMode: "normal",
    source: { assetId: video.asset.id },
    masks: [],
    properties: { loop: false, muted: true }
  };
  project.compositions[0].layers.push(imageLayer, svgLayer, videoLayer);
  return project;
}

const projectEnvelope = JSON.stringify({
  savedAt: Date.now(),
  projectJson: saveProject(qaProject(), { space: 0 })
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const browser = await chromium.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: true,
  args: ["--use-angle=swiftshader"]
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => consoleErrors.push(error.message));

let soloLayerName;
async function toggleSolo(name) {
  const row = page.locator(".layer-row").filter({ hasText: name });
  const rendered = page.waitForResponse((response) => response.url().endsWith("/api/editor-preview"));
  await row.getByLabel(soloLayerName === name ? "取消独奏" : "独奏图层").click();
  const response = await rendered;
  assert(response.status() === 200, `${name} solo render failed.`);
}

async function selectLayer(name, solo = true) {
  await page.getByRole("button", { name: "图层", exact: true }).click();
  if (soloLayerName && soloLayerName !== name) {
    await toggleSolo(soloLayerName);
    soloLayerName = undefined;
  }
  const row = page.locator(".layer-row").filter({ hasText: name });
  await row.click();
  const show = row.getByLabel("显示图层", { exact: true });
  if (await show.count()) {
    const rendered = page.waitForResponse((response) => response.url().endsWith("/api/editor-preview"));
    await show.click();
    assert((await rendered).status() === 200, `${name} show-layer render failed.`);
  }
  if (solo && soloLayerName !== name) {
    await toggleSolo(name);
    soloLayerName = name;
  } else if (!solo && soloLayerName === name) {
    await toggleSolo(name);
    soloLayerName = undefined;
  }
}

function targetLayer(effect) {
  if (effect.sourceId.startsWith("T")) return { name: "CodeMotion FX", solo: true, input: "text-glyph" };
  if (effect.sourceId.startsWith("V") || effect.sourceId.startsWith("D")) {
    const svg = Number(effect.sourceId.slice(1)) % 2 === 1;
    return { name: svg ? "QA SVG Path" : "强调图形", solo: true, input: svg ? "svg-path" : "shape-path" };
  }
  if (effect.sourceId.startsWith("L") || effect.sourceId.startsWith("P")) {
    const imageInput = Number(effect.sourceId.slice(1)) % 2 === 1;
    return { name: imageInput ? "QA Masked Image" : "QA Video Input", solo: true, input: imageInput ? "image-alpha-mask" : "video-rgba" };
  }
  if (effect.sourceId.startsWith("C") || effect.sourceId.startsWith("H")) {
    return { name: "QA Video Input", solo: false, input: "video-plus-independent-secondary" };
  }
  return { name: "强调图形", solo: true, input: "shape-raster" };
}

async function openEffect(effect) {
  await page.getByRole("button", { name: "特效", exact: true }).click();
  await page.locator(".search-box input").fill(effect.sourceId);
  const item = page.locator(".effect-catalog .effect-item").filter({ hasText: effect.sourceId });
  assert(await item.count() === 1, `${effect.sourceId} is missing from the editor catalog.`);
  const rendered = page.waitForResponse((response) =>
    response.url().endsWith("/api/editor-preview")
  );
  await item.click();
  const response = await rendered;
  const status = response.status();
  const failure = status === 200 ? "" : await response.text().catch(() => "response body unavailable");
  assert(status === 200, `${effect.sourceId} add render failed: ${failure}`);
  await page.locator(".stack-row.selected").filter({ hasText: effect.displayName }).waitFor();
}

async function renderAt(projectPercent) {
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/editor-preview") && response.status() === 200
  );
  await page.locator("input[aria-label='时间轴播放头']").evaluate((input, percent) => {
    input.value = String(Number(input.max) * percent / 100);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, projectPercent);
  const response = await responsePromise;
  assert(response.status() === 200, `Live preview failed at ${projectPercent}%.`);
  const requestBody = JSON.parse(response.request().postData());
  const previewResponse = await page.request.post(`${baseUrl}/api/editor-preview`, {
    data: { ...requestBody, quality: "preview" }
  });
  assert(previewResponse.ok(), `Shared preview render failed at ${projectPercent}%: ${await previewResponse.text()}`);
  const previewBytes = await previewResponse.body();
  const finalResponse = await page.request.post(`${baseUrl}/api/editor-preview`, {
    data: { ...requestBody, quality: "final" }
  });
  assert(finalResponse.ok(), `Final-quality shared render failed at ${projectPercent}%: ${await finalResponse.text()}`);
  const finalBytes = await finalResponse.body();
  return {
    requestedPercent: projectPercent,
    previewTime: Number(previewResponse.headers()["x-cmfx-time"]),
    finalTime: Number(finalResponse.headers()["x-cmfx-time"]),
    timeContract: previewResponse.headers()["x-cmfx-time-contract"],
    finalTimeContract: finalResponse.headers()["x-cmfx-time-contract"],
    renderer: previewResponse.headers()["x-cmfx-renderer"],
    finalRenderer: finalResponse.headers()["x-cmfx-renderer"],
    previewQuality: previewResponse.headers()["x-cmfx-quality"],
    finalQuality: finalResponse.headers()["x-cmfx-quality"],
    previewSha256: digest(previewBytes),
    exportSha256: digest(finalBytes),
    previewNonEmpty: previewBytes.some((byte) => byte !== 0),
    exportNonEmpty: finalBytes.some((byte) => byte !== 0),
    previewBytes: previewBytes.length,
    exportBytes: finalBytes.length
  };
}

async function perturbFirstField() {
  const numeric = page.locator(".effect-field input[type='number']").first();
  const input = await numeric.count() > 0 ? numeric : page.locator(".effect-field input, .effect-field select").first();
  if (await input.count() === 0) return "no-control";
  const tag = await input.evaluate((element) => element.tagName);
  const type = await input.getAttribute("type");
  if (tag === "SELECT") {
    const options = await input.locator("option").allTextContents();
    if (options.length > 1) await input.selectOption({ index: 1 });
    return `select:${options.length}`;
  }
  if (type === "checkbox") {
    await input.click();
    return "toggle";
  }
  if (type === "number") {
    const minimum = Number(await input.getAttribute("min"));
    const maximum = Number(await input.getAttribute("max"));
    const current = Number(await input.inputValue());
    const candidate = Number.isFinite(maximum) && current !== maximum ? maximum
      : Number.isFinite(minimum) && current !== minimum ? minimum : current + 1;
    await input.fill(String(candidate));
    return `number:${candidate}`;
  }
  const current = await input.inputValue();
  const candidate = type === "color" ? (current.toLowerCase() === "#ff00ff" ? "#00ffff" : "#ff00ff") : `${current}x`;
  await input.fill(candidate);
  return `${type ?? "text"}:${candidate}`;
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate((value) => localStorage.setItem("codemotion.editor.autosave.v1", value), projectEnvelope);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".recovery-bar .text-button").click();
  await page.locator(".backend-status.ok").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "特效", exact: true }).click();
  assert(await page.locator(".effect-catalog .effect-item").count() === 40, "The browser catalog is not 40/40.");

  const rows = [];
  for (const effect of formalOnly ? [] : P0_EDITOR_EFFECTS) {
    console.log(`EDGE-S5R ${effect.sourceId} ${effect.effectId}`);
    const target = targetLayer(effect);
    await selectLayer(target.name, target.solo);
    await openEffect(effect);

    const schema = effectParameterFields(effect);
    assert(await page.locator(".effect-field").count() === schema.length, `${effect.sourceId} browser Schema field count differs.`);
    const presetButtons = page.locator(".preset-buttons button");
    assert(await presetButtons.count() === 3, `${effect.sourceId} does not expose three presets.`);
    for (let index = 0; index < 3; index += 1) {
      const response = page.waitForResponse((candidate) =>
        candidate.url().endsWith("/api/editor-preview") && candidate.status() === 200
      );
      await presetButtons.nth(index).click();
      await response;
    }

    const keyframeField = schema.find((field) => field.keyframeable);
    assert(keyframeField, `${effect.sourceId} has no keyframeable Schema field.`);
    const keyframeResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/editor-preview")
    );
    await page.getByLabel(new RegExp(`添加 ${keyframeField.label} 关键帧$`)).click();
    assert((await keyframeResponse).status() === 200, `${effect.sourceId} keyframe render failed.`);

    const perturbed = page.waitForResponse((response) =>
      response.url().endsWith("/api/editor-preview")
    );
    const perturbation = await perturbFirstField();
    const perturbedResponse = await perturbed;
    const perturbationStatus = perturbedResponse.status();
    const perturbationFailure = perturbationStatus === 200
      ? "" : await perturbedResponse.text().catch(() => "response body unavailable");
    assert(perturbationStatus === 200, `${effect.sourceId} parameter perturbation failed: ${perturbationFailure}`);

    const frames = [];
    for (const percent of [0, 25, 50, 75, 100]) frames.push(await renderAt(percent));
    for (const frame of frames) {
      assert(frame.timeContract === "1.1.0", `${effect.sourceId} missed time contract 1.1.0.`);
      assert(frame.finalTimeContract === "1.1.0", `${effect.sourceId} final render missed time contract 1.1.0.`);
      assert(frame.renderer === "g5-createProjectFrameProducer", `${effect.sourceId} did not use the G5 shared renderer.`);
      assert(frame.finalRenderer === "g5-createProjectFrameProducer", `${effect.sourceId} final render did not use the G5 shared renderer.`);
      assert(frame.previewQuality === "preview" && frame.finalQuality === "final", `${effect.sourceId} quality tiers were not explicit.`);
      assert(frame.previewTime === frame.finalTime, `${effect.sourceId} preview/final logical times differ.`);
      assert(frame.previewNonEmpty && frame.exportNonEmpty, `${effect.sourceId} rendered an empty frame.`);
    }

    const zoom = page.locator("input[aria-label='画布缩放']");
    await zoom.fill("150");
    const zoomValue = await page.locator(".zoom-control b").textContent();
    assert(zoomValue === "150%", `${effect.sourceId} canvas zoom did not reach 150%.`);

    const toggle = page.locator(".stack-row.selected button").first();
    const disabledFrame = page.waitForResponse((response) =>
      response.url().endsWith("/api/editor-preview") && response.status() === 200
    );
    await toggle.click();
    await disabledFrame;
    const enabledFrame = page.waitForResponse((response) =>
      response.url().endsWith("/api/editor-preview") && response.status() === 200
    );
    await toggle.click();
    await enabledFrame;
    assert((await toggle.getAttribute("class"))?.includes("active"), `${effect.sourceId} did not re-enable.`);

    rows.push({
      slot: P0_EDITOR_EFFECTS.indexOf(effect) + 1,
      sourceId: effect.sourceId,
      effectId: effect.effectId,
      input: target.input,
      schemaFields: schema.length,
      schema: schema.map((field) => ({
        name: field.name,
        control: field.control,
        type: field.type,
        minimum: field.minimum ?? null,
        maximum: field.maximum ?? null,
        options: field.options ?? null,
        keyframeable: field.keyframeable
      })),
      keyframeAdded: keyframeField.name,
      presets: effect.presets.map((preset) => preset.presetId),
      perturbation,
      zoom: zoomValue,
      frames
    });

    const deletion = page.waitForResponse((response) =>
      response.url().endsWith("/api/editor-preview") && response.status() === 200
    );
    await page.locator(".stack-row.selected button").last().click();
    await deletion;
  }

  const t08 = P0_EDITOR_EFFECTS.find((effect) => effect.sourceId === "T08");
  const t07 = P0_EDITOR_EFFECTS.find((effect) => effect.sourceId === "T07");
  assert(t08 && t07, "T07/T08 are missing from the editor catalog.");
  await selectLayer("CodeMotion FX", true);
  await openEffect(t08);
  await openEffect(t07);
  const reorderResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/editor-preview") && response.status() === 200
  );
  await page.locator(".stack-row.selected").getByLabel("效果上移").click();
  await reorderResponse;
  assert((await page.locator(".stack-row").first().textContent())?.includes(t07.displayName), "Browser effect sorting did not update the stack.");
  const companionDeletion = page.waitForResponse((response) =>
    response.url().endsWith("/api/editor-preview") && response.status() === 200
  );
  await page.locator(".stack-row.selected").getByLabel("删除效果").click();
  await companionDeletion;
  await page.locator(".stack-row").filter({ hasText: t08.displayName }).click();

  await page.locator(".render-button").click();
  await page.getByText("真实 exporter 已连接").waitFor();
  await page.locator(".format-segment button").nth(0).click();
  await page.locator(".render-field input[type=number]").nth(2).fill("1");
  await page.locator(".render-field input[type=number]").nth(3).fill("0.1");
  const existingTaskIds = new Set((await page.evaluate(async () =>
    (await (await fetch("/api/editor-exports")).json()).tasks)).map((task) => task.id));
  const exportRequestPromise = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().endsWith("/api/editor-exports")
  );
  await page.locator(".export-start").click();
  const exportRequest = await exportRequestPromise;
  const submittedProject = JSON.parse(exportRequest.postData()).project;
  const submittedLayers = submittedProject.compositions[0].layers;
  for (const required of ["layer.backdrop", "layer.accent", "layer.title", "layer.qa.svg"]) {
    assert(submittedLayers.find((layer) => layer.id === required)?.properties?.rasterSource,
      `Formal export request omitted browser Raster for ${required}.`);
  }
  const submittedTitle = submittedLayers.find((layer) => layer.id === "layer.title");
  assert(submittedTitle.visible
    && submittedTitle.effects.some((effect) => effect.effectId === t08.effectId),
  "Formal export request did not contain a visible T08 text layer.");
  let formalTask;
  const formalDeadline = Date.now() + 60_000;
  while (Date.now() < formalDeadline) {
    const tasks = await page.evaluate(async () =>
      (await (await fetch("/api/editor-exports")).json()).tasks);
    formalTask = tasks.find((task) => !existingTaskIds.has(task.id));
    if (formalTask?.status === "completed" || formalTask?.status === "failed") break;
    await page.waitForTimeout(250);
  }
  assert(formalTask, "T08 formal export did not create a product task.");
  if (formalTask.status === "failed") {
    const failure = formalTask.failure ?? {};
    throw new Error(`T08 formal export failed at ${failure.stage ?? "unknown"} frame ${failure.frame ?? "unknown"}: ${failure.message ?? "unknown"}`);
  }
  assert(formalTask.status === "completed" && formalTask.progress === 1, "T08 formal export did not reach real 100% progress.");
  const downloadHref = `/api/editor-exports/${formalTask.id}/download`;
  const downloadResponse = await page.request.get(new URL(downloadHref, baseUrl).href);
  const downloadBytes = await downloadResponse.body();
  assert(downloadResponse.ok() && downloadBytes.subarray(0, 4).toString("hex") === "504b0304", "T08 formal PNG export is not a downloadable ZIP.");
  const formalExport = {
    effectId: t08.effectId,
    status: formalTask.status,
    progress: formalTask.progress,
    format: formalTask.format,
    frameCount: formalTask.frameCount,
    outputBytes: formalTask.outputBytes,
    rendererLog: formalTask.logs.find((line) => line.includes("真实编码")) ?? null,
    downloadBytes: downloadBytes.length,
    sortedInBrowser: true
  };

  assert(consoleErrors.length === 0, `Browser console/page errors: ${consoleErrors.join(" | ")}`);
  if (formalOnly) {
    console.log(JSON.stringify({ formalExport, consoleErrors }));
  } else {
    const inputKinds = [...new Set(rows.map((row) => row.input))];
    const evidence = {
      generatedAt: new Date().toISOString(),
      browser: await browser.version(),
      catalogCount: P0_EDITOR_EFFECTS.length,
      schemaComplete: rows.every((row) =>
        row.schemaFields === row.schema.length
        && row.schemaFields > 0
        && row.presets.length === 3
        && typeof row.keyframeAdded === "string"),
      matrix: "40x5",
      frameCount: rows.reduce((sum, row) => sum + row.frames.length, 0),
      inputKinds,
      formalExport,
      consoleErrors,
      rows
    };
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify({
      effects: rows.length,
      frames: evidence.frameCount,
      schemaComplete: evidence.schemaComplete,
      consoleErrors: consoleErrors.length,
      evidencePath
    }));
  }
} finally {
  await browser.close();
}
