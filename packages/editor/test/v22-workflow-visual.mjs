import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { chromium } from "playwright-core";
import { runProcess } from "@codemotion/exporter";
import { V22_SAMPLE_EFFECT_CARD_BY_ID, V22_SAMPLE_EFFECT_CARDS } from "@codemotion/effects-2d";

const origin = process.env.CMFX_EDITOR_URL ?? "http://127.0.0.1:4174";
const output = resolve(import.meta.dirname, "../../../tmp/v22-workflow");
const butterflyPath = resolve(import.meta.dirname, "../public/sample-cards/butterfly.png");
const phoenixPath = resolve(import.meta.dirname, "../public/sample-cards/phoenix.png");
const thirdImagePath = resolve(output, "v22-third.png");
const videoPath = resolve(output, "v22-source-audio.mp4");
const audioPath = resolve(output, "v22-background-music.wav");
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const requestedEffectId = process.env.CMFX_V22_EFFECT ?? process.argv[2];

const flows = [
  { prompt: "让整张图片淡入", effectId: "fx.motion.fade", assets: ["butterfly.png"] },
  { prompt: "让整张图片从左侧滑入", effectId: "fx.motion.slide", assets: ["butterfly.png"] },
  { prompt: "添加标题‘笔唯思’，以打字机方式出现", effectId: "fx.text.typewriter", assets: ["butterfly.png"], text: "笔唯思" },
  { prompt: "添加标题‘笔唯思’，以手写方式出现", effectId: "fx.draw.handwriting", assets: ["butterfly.png"], text: "笔唯思" },
  { prompt: "让整张图片呈现霓虹发光效果", effectId: "fx.light.neonGlow", assets: ["butterfly.png"] },
  { prompt: "让整张图片逐渐变得柔和朦胧", effectId: "fx.post.gaussianBlur", assets: ["butterfly.png"] },
  { prompt: "从蝴蝶线性擦除切换到凤凰", effectId: "fx.transition.wipe", assets: ["butterfly.png", "phoenix.png"] },
  { prompt: "使用遮罩让凤凰画面显现", effectId: "fx.composite.maskReveal", assets: ["butterfly.png", "phoenix.png"] }
];
const audioOnly = requestedEffectId === "audio";
const activeFlows = requestedEffectId === undefined ? flows
  : audioOnly ? [] : flows.filter((flow) => flow.effectId === requestedEffectId);
if (!audioOnly && activeFlows.length === 0) throw new Error(`Unknown CMFX_V22_EFFECT: ${requestedEffectId}`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function createFixtures() {
  await mkdir(output, { recursive: true });
  await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x294653:s=320x180", "-frames:v", "1", thirdImagePath]);
  await runProcess("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=0x18323d:s=320x180:r=24:d=2",
    "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=2",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", videoPath
  ]);
  await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=2", "-c:a", "pcm_s16le", audioPath]);
}

async function upload(page, path, purpose) {
  await page.getByLabel("上传用途").selectOption(purpose);
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/media-assets")
    && response.request().method() === "POST");
  await page.locator(".ai-upload-row input[type=file]").setInputFiles(path);
  const response = await responsePromise;
  assert(response.status() === 201, `Upload failed with HTTP ${response.status()}.`);
  const body = await response.json();
  assert(typeof body.asset?.assetId === "string", "Upload response did not contain an asset ID.");
  await page.getByLabel(`选择 ${body.asset.displayName}`).waitFor();
  return body.asset.assetId;
}

async function selectAssets(page, displayNames) {
  const wanted = new Set(displayNames);
  const options = page.locator(".ai-asset-option");
  for (let index = 0; index < await options.count(); index += 1) {
    const option = options.nth(index);
    const checkbox = option.locator("input[type=checkbox]");
    const displayName = await option.locator("b").textContent();
    const shouldSelect = wanted.has(displayName);
    if (await checkbox.isChecked() !== shouldSelect) await checkbox.click();
  }
  assert(await page.locator(".ai-asset-option input[type=checkbox]:checked").count() === wanted.size,
    `Expected ${wanted.size} selected assets.`);
}

async function selectCard(page, effectId, selected) {
  const button = page.locator(`[data-effect-id="${effectId}"] .sample-card-add`);
  if ((await button.getAttribute("aria-pressed")) === String(selected)) return;
  await button.click();
  assert((await button.getAttribute("aria-pressed")) === String(selected), `${effectId} card selection did not change.`);
}

async function assertDisabled(page, expectedReason) {
  const button = page.getByRole("button", { name: "生成视频" });
  assert(await button.isDisabled(), `Generate button is enabled despite: ${expectedReason}`);
  assert((await button.getAttribute("title"))?.includes(expectedReason), `Missing disabled reason: ${expectedReason}`);
  assert((await page.locator(".ai-input-guidance").textContent())?.includes(expectedReason), `Missing inline reason: ${expectedReason}`);
}

async function taskIds(page, endpoint) {
  return new Set(await page.evaluate(async (url) => (await (await fetch(url)).json()).tasks.map((task) => task.id), endpoint));
}

async function generatedTask(page, previous) {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const task = await page.evaluate(async () => (await (await fetch("/api/ai-plans")).json()).tasks[0]);
    if (task && !previous.has(task.id) && ["completed", "failed", "cancelled"].includes(task.status)) return task;
    await page.waitForTimeout(500);
  }
  throw new Error("AI generation did not reach a terminal state.");
}

function tonePower(pcm, frequency, sampleRate = 48_000) {
  const samples = Math.floor(pcm.length / 2);
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < samples; index += 1) {
    const value = pcm.readInt16LE(index * 2) / 32_768;
    const phase = 2 * Math.PI * frequency * index / sampleRate;
    real += value * Math.cos(phase);
    imaginary -= value * Math.sin(phase);
  }
  return (real * real + imaginary * imaginary) / Math.max(1, samples * samples);
}

async function exportProject(page, format, name, duration) {
  const previous = await taskIds(page, "/api/editor-exports");
  if (await page.locator(".render-center").count() === 0) {
    await page.locator(".render-button").click();
    await page.locator(".render-center").waitFor();
  }
  await page.locator(".format-segment button").filter({ hasText: format }).click();
  await page.getByLabel("宽度").fill("320");
  await page.getByLabel("高度").fill("180");
  await page.getByLabel("帧率").fill("12");
  const durationField = page.getByLabel("导出时长（跟随工程）");
  assert(await durationField.isEditable() === false
    && Math.abs(Number(await durationField.inputValue()) - duration) < 1e-6,
  `${format} export duration is not following the authoritative project duration.`);
  const audio = page.getByLabel("包含音轨");
  assert(await audio.isEnabled(), `${format} audio control is disabled despite an audio track.`);
  await audio.check();
  const validationIssues = await page.locator(".validation-list").allTextContents();
  assert(validationIssues.length === 0, `${format} settings failed project validation: ${validationIssues.join(" | ")}`);
  await page.locator(".export-start").click();
  const deadline = Date.now() + 180_000;
  let task;
  while (Date.now() < deadline) {
    const tasks = await page.evaluate(async () => (await (await fetch("/api/editor-exports")).json()).tasks);
    task = tasks.find((item) => !previous.has(item.id));
    if (task && ["completed", "failed", "cancelled"].includes(task.status)) break;
    await page.waitForTimeout(500);
  }
  assert(task?.status === "completed", `${format} export failed with ${task?.failure?.code ?? task?.status ?? "timeout"}.`);
  const download = page.waitForEvent("download");
  await page.locator(".task-actions button.primary-command").click();
  const target = resolve(output, `${name}.${format}`);
  await (await download).saveAs(target);
  assert((await stat(target)).size > 0, `${format} output is empty.`);
  const probe = JSON.parse((await runProcess("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", target])).stdout.toString("utf8"));
  assert(probe.streams.some((stream) => stream.codec_type === "video"), `${format} has no video stream.`);
  assert(probe.streams.some((stream) => stream.codec_type === "audio"), `${format} has no audio stream.`);
  const pcm = (await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", target, "-map", "0:a:0", "-f", "s16le", "-ac", "1", "-ar", "48000", "pipe:1"])).stdout;
  assert(pcm.some((byte) => byte !== 0), `${format} audio stream is silent.`);
  const reference = tonePower(pcm, 1_100);
  assert(tonePower(pcm, 330) > reference * 8, `${format} is missing the 330 Hz background-music tone.`);
  assert(tonePower(pcm, 660) > reference * 8, `${format} is missing the 660 Hz source-video tone.`);
  const frame = resolve(output, `${name}-${format}-frame.png`);
  await runProcess("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", target, "-frames:v", "1", frame]);
  assert((await stat(frame)).size > 0, `${format} decoded frame is empty.`);
  return { task, target, frame, probe };
}

async function canvasHash(page) {
  return page.locator(".canvas-frame canvas").evaluate((canvas) => {
    const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels) return { hash: 0, colored: 0 };
    let hash = 2166136261;
    let colored = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] > 0 && pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 12) colored += 1;
      hash = Math.imul(hash ^ pixels[offset], 16777619);
      hash = Math.imul(hash ^ pixels[offset + 1], 16777619);
      hash = Math.imul(hash ^ pixels[offset + 2], 16777619);
      hash = Math.imul(hash ^ pixels[offset + 3], 16777619);
    }
    return { hash: hash >>> 0, colored };
  });
}

async function editGeneratedProject(page, flow, project) {
  await page.locator(".editor-shell").waitFor({ timeout: 30_000 });
  await page.locator(".backend-status.ok").waitFor({ timeout: 30_000 });
  const time = Math.min(project.duration * 0.5, project.duration - 1 / project.fps);
  await page.getByLabel("时间轴播放头").fill(String(time));
  await page.waitForTimeout(500);
  const before = await canvasHash(page);
  assert(before.colored > 100, `${flow.effectId} editor preview is blank.`);
  await page.locator(".canvas-frame").click({ position: { x: 2, y: 2 } });
  await page.locator(".canvas-frame canvas").screenshot({
    path: resolve(output, `${flow.effectId.replaceAll(".", "-")}-editor.png`)
  });

  const effectLayer = project.compositions.flatMap((composition) => composition.layers)
    .find((layer) => layer.effects.some((effect) => effect.effectId === flow.effectId));
  assert(effectLayer, `${flow.effectId} target layer is missing.`);
  await page.locator(".layer-row", { hasText: effectLayer.name }).click();
  const labelBounds = await page.locator(".selection-box label").evaluate((label) => {
    const labelRect = label.getBoundingClientRect();
    const frameRect = label.closest(".canvas-frame").getBoundingClientRect();
    return { left: labelRect.left, right: labelRect.right, frameLeft: frameRect.left, frameRight: frameRect.right };
  });
  assert(labelBounds.left >= labelBounds.frameLeft - 1 && labelBounds.right <= labelBounds.frameRight + 1,
    `${flow.effectId} selection label overflows the canvas.`);
  await page.locator(".stack-row").first().click();
  const parameter = page.locator(".effect-inspector input[type=number]").first();
  if (await parameter.count()) {
    const value = await parameter.inputValue();
    const limits = await parameter.evaluate((input) => ({
      minimum: input.min === "" ? Number.NEGATIVE_INFINITY : Number(input.min),
      maximum: input.max === "" ? Number.POSITIVE_INFINITY : Number(input.max),
      step: input.step === "" || input.step === "any" ? 0.01 : Number(input.step)
    }));
    const current = Number(value);
    const base = Number.isFinite(limits.minimum) ? limits.minimum : current;
    const precision = Math.max(0, String(limits.step).split(".")[1]?.length ?? 0) + 2;
    const next = Number((base + limits.step <= limits.maximum ? base + limits.step : limits.maximum - limits.step).toFixed(precision));
    assert(next >= limits.minimum && next <= limits.maximum && next !== current, `${flow.effectId} has no legal editable parameter step.`);
    await parameter.fill(String(next));
    await page.waitForTimeout(150);
    const actual = Number(await parameter.inputValue());
    assert(Math.abs(actual - next) < 1e-9 && actual !== current,
      `${flow.effectId} editable parameter did not change: before=${current}, expected=${next}, actual=${actual}; browserErrors=${browserErrors.join(" | ")}.`);
  }

  if (flow.text) {
    const textField = page.locator(".right-panel label.schema-field")
      .filter({ has: page.locator("span", { hasText: "文字" }) }).locator("input[type=text]").first();
    await textField.waitFor();
    assert(await textField.inputValue() === flow.text, `${flow.effectId} text field lost the exact Chinese title.`);
    await textField.fill("笔唯思新版");
    assert(await textField.inputValue() === "笔唯思新版", `${flow.effectId} generated text is not editable.`);
    const deadline = Date.now() + 10_000;
    let after = before;
    while (after.hash === before.hash && Date.now() < deadline) {
      await page.waitForTimeout(250);
      after = await canvasHash(page);
    }
    assert(after.hash !== before.hash, `${flow.effectId} preview did not regenerate after the text edit.`);
  }
}

async function openCreator(page) {
  if (await page.locator(".render-center").count()) {
    await page.locator(".render-header .icon-button").click();
    await page.locator(".editor-shell").waitFor();
  }
  if (await page.locator(".editor-shell").count()) {
    await page.getByLabel("AI 动画规划").click();
  }
  await page.locator(".creator-workspace").waitFor();
  await page.locator(".ai-asset-option").first().waitFor();
}

async function runFlow(page, flow) {
  await openCreator(page);
  await selectAssets(page, flow.assets);
  await page.getByLabel("描述视频内容").fill(flow.prompt);
  const generate = page.getByRole("button", { name: "生成视频" });
  await generate.waitFor({ state: "visible" });
  const diagnostic = await page.evaluate(() => ({
    title: document.querySelector(".ai-submit")?.getAttribute("title"),
    guidance: document.querySelector(".ai-input-guidance")?.textContent ?? "none",
    selected: document.querySelectorAll(".ai-asset-option input[type=checkbox]:checked").length,
    duration: document.querySelector("input[aria-label='视频时长']")?.value
  }));
  assert(await generate.isEnabled(), `Generate video is disabled for ${flow.effectId}: ${JSON.stringify(diagnostic)}`);
  let previous = await taskIds(page, "/api/ai-plans");
  await generate.click();
  let task = await generatedTask(page, previous);
  for (let retryAttempt = 0; retryAttempt < 2 && task.status === "failed"
    && task.error?.retryable === true; retryAttempt += 1) {
    assert(await page.getByLabel("描述视频内容").inputValue() === flow.prompt, "Original prompt was not preserved after generation failure.");
    previous = await taskIds(page, "/api/ai-plans");
    const retry = page.locator(".creation-failure button", { hasText: "重试" });
    await retry.waitFor({ state: "visible" });
    const retryDeadline = Date.now() + 180_000;
    while (!await retry.isEnabled() && Date.now() < retryDeadline) await page.waitForTimeout(1_000);
    assert(await retry.isEnabled(), "Generation retry control remained disabled after bounded backoff.");
    await retry.click();
    task = await generatedTask(page, previous);
  }
  if (task.status !== "completed") throw new Error(`${flow.effectId} AI generation failed (${task.error?.problemCode ?? task.error?.code ?? task.status}): ${task.error?.message ?? "no message"}`);
  const project = task.result.editableProject.project;
  assert(project.name === "AI 生成动画", `${flow.effectId} generated project name is not localized.`);
  const layers = project.compositions.flatMap((composition) => composition.layers);
  const effects = layers.flatMap((layer) => layer.effects);
  assert(effects.length === 1, `Expected one effect, received ${effects.map((effect) => effect.effectId).join(", ")}.`);
  const selected = effects[0];
  assert(selected.effectId === flow.effectId, `Expected ${flow.effectId}, received ${selected.effectId}.`);
  const card = V22_SAMPLE_EFFECT_CARD_BY_ID.get(flow.effectId);
  assert(card && isDeepStrictEqual(selected.params, card.defaultParams), `${flow.effectId} params differ from the authoritative preset.`);
  const expectedDuration = flow.effectId === "fx.motion.fade" || flow.effectId === "fx.motion.slide" ? 1.2
    : flow.effectId === "fx.transition.wipe" || flow.effectId === "fx.composite.maskReveal" ? 1 : project.duration;
  assert(Math.abs((selected.endTime - selected.startTime) - expectedDuration) < 1e-6, `${flow.effectId} has the wrong formal effect duration.`);
  assert(project.duration === 5, `${flow.effectId} image project did not default to five seconds.`);
  assert(project.assets.filter((asset) => asset.type === "image").length === flow.assets.length, `${flow.effectId} bound the wrong visual count.`);
  const targetLayer = layers.find((layer) => layer.effects.includes(selected));
  assert(targetLayer && (flow.text ? targetLayer.type === "text" : targetLayer.type === "image"), `${flow.effectId} targeted the wrong layer type.`);
  if (flow.text) {
    const textLayers = layers.filter((layer) => layer.type === "text");
    assert(textLayers.some((layer) => layer.properties.text === flow.text), `${flow.effectId} did not preserve the exact title.`);
  }
  const serialized = JSON.stringify(project);
  assert(!serialized.includes("/sample-cards/") && !serialized.includes("AI FUTURE") && !serialized.includes("biweisi"), `${flow.effectId} leaked card-only demo content.`);
  await page.getByRole("button", { name: "进入编辑器", exact: true }).click();
  await editGeneratedProject(page, flow, project);
  return { effectId: flow.effectId, taskId: task.id, duration: project.duration, targetType: targetLayer.type };
}

async function validateInputRules(page) {
  await selectAssets(page, []);
  await page.getByLabel("描述视频内容").fill("让整张图片淡入");
  await assertDisabled(page, "请至少选择一张图片或一个视频；音频不能代替视觉素材。");

  await selectAssets(page, ["v22-background-music.wav"]);
  await assertDisabled(page, "请至少选择一张图片或一个视频；音频不能代替视觉素材。");

  await selectAssets(page, ["butterfly.png", "phoenix.png", "v22-third.png"]);
  await assertDisabled(page, "首轮最多使用两个视觉素材，请取消多余的图片或视频。");

  await selectAssets(page, ["butterfly.png"]);
  await page.getByLabel("描述视频内容").fill("让整张图片淡入并从左侧滑入");
  await assertDisabled(page, "当前版本一次只能使用一个特效");

  await page.getByLabel("描述视频内容").fill("让整张图片淡入");
  await selectCard(page, "fx.transition.wipe", true);
  await assertDisabled(page, "所选特效与自然语言要求冲突，请修改描述或取消卡片选择。");
  await page.getByLabel("描述视频内容").fill("从蝴蝶线性擦除切换到凤凰");
  await assertDisabled(page, "该特效需要且只能选择两个图片或视频。");
  await selectCard(page, "fx.transition.wipe", false);
}

async function runAudioFlow(page) {
  await openCreator(page);
  await selectAssets(page, ["v22-source-audio.mp4", "v22-background-music.wav"]);
  await page.getByLabel("描述视频内容").fill("让整段视频淡入");
  await selectCard(page, "fx.motion.fade", true);
  let previous = await taskIds(page, "/api/ai-plans");
  await page.getByRole("button", { name: "生成视频" }).click();
  let task = await generatedTask(page, previous);
  for (let attempt = 0; attempt < 2 && task.status === "failed" && task.error?.retryable === true; attempt += 1) {
    previous = await taskIds(page, "/api/ai-plans");
    const retry = page.locator(".creation-failure button", { hasText: "重试" });
    const deadline = Date.now() + 180_000;
    while (!await retry.isEnabled() && Date.now() < deadline) await page.waitForTimeout(1_000);
    assert(await retry.isEnabled(), "Audio generation retry remained disabled after bounded backoff.");
    await retry.click();
    task = await generatedTask(page, previous);
  }
  assert(task.status === "completed", `Audio generation failed (${task.error?.problemCode ?? task.error?.code ?? task.status}).`);
  const project = task.result.editableProject.project;
  assert(project.name === "AI 生成动画", "Audio project name is not localized.");
  assert(project.duration <= 2.05, "Video project silently extended beyond the source duration.");
  const source = project.audioTracks.find((track) => track.id === "audio_source_1");
  const bgm = project.audioTracks.find((track) => track.id === "audio_bgm_1");
  assert(source?.volume.value === 1 && bgm?.volume.value === 0.35, "Source/BGM defaults are incorrect.");
  await page.getByRole("button", { name: "进入编辑器", exact: true }).click();
  await page.locator(".editor-shell").waitFor({ timeout: 30_000 });
  const sourceVolume = page.getByLabel("audio_source_1 音量");
  const bgmVolume = page.getByLabel("audio_bgm_1 音量");
  await sourceVolume.fill("0.8");
  await bgmVolume.fill("0.3");
  assert(await sourceVolume.inputValue() === "0.8" && await bgmVolume.inputValue() === "0.3", "Audio tracks are not independently editable.");
  await page.getByLabel("静音视频原声").click();
  assert(await sourceVolume.inputValue() === "0" && await bgmVolume.inputValue() === "0.3", "Muting source audio also changed BGM.");
  await page.getByLabel("取消静音视频原声").click();
  assert(Number(await sourceVolume.inputValue()) > 0, "Source-audio unmute did not restore volume.");
  const mp4 = await exportProject(page, "mp4", "mixed-audio", project.duration);
  const webm = await exportProject(page, "webm", "mixed-audio", project.duration);
  const visibleText = await page.locator("body").innerText();
  const untranslated = ["AI planned animation", "opaque assetId"].filter((text) => visibleText.includes(text));
  assert(untranslated.length === 0,
    `Export center still contains untranslated product copy: ${untranslated.join(", ")}.`);
  return { taskId: task.id, mp4: mp4.target, webm: webm.target, frames: [mp4.frame, webm.frame] };
}

async function assertResponsive(page, label) {
  const result = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    zeroSizedButtons: [...document.querySelectorAll("button:not([disabled])")]
      .filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width < 20 || rect.height < 20;
      }).map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim())
  }));
  assert(!result.horizontalOverflow, `${label} has horizontal document overflow.`);
  assert(result.zeroSizedButtons.length === 0, `${label} has inaccessible controls: ${result.zeroSizedButtons.join(", ")}`);
}

await createFixtures();
const browser = await chromium.launch({ executablePath: edgePath, headless: true, args: ["--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const browserErrors = [];
page.on("pageerror", (error) => browserErrors.push(error.message));
page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) browserErrors.push(message.text()); });

try {
  const session = page.waitForResponse((response) => response.url().endsWith("/auth/dev/auto-session"));
  await page.goto(origin, { waitUntil: "networkidle" });
  assert((await session).status() === 201, "Automatic local session failed.");
  await upload(page, butterflyPath, "reference-image");
  await upload(page, phoenixPath, "reference-image");
  await upload(page, thirdImagePath, "reference-image");
  await upload(page, videoPath, "reference-video");
  await upload(page, audioPath, "reference-audio");
  if (requestedEffectId === undefined) await validateInputRules(page);
  const results = [];
  for (const flow of activeFlows) results.push(await runFlow(page, flow));
  const audio = requestedEffectId === undefined || audioOnly ? await runAudioFlow(page) : undefined;

  if (requestedEffectId === undefined || audioOnly) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await assertResponsive(page, "desktop editor");
    await page.screenshot({ path: resolve(output, "desktop-editor.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertResponsive(page, "mobile editor");
    await page.screenshot({ path: resolve(output, "mobile-editor.png"), fullPage: true });
  }
  assert(V22_SAMPLE_EFFECT_CARDS.every((card) => card.status === "verified" && card.acceptanceState === "pending-human"), "Sample-card acceptance state changed before human review.");
  assert(browserErrors.length === 0, `Browser errors: ${browserErrors.join(" | ")}`);
  console.log(JSON.stringify({
    effects: results,
    inputRules: requestedEffectId === undefined,
    audio,
    responsive: { desktop: requestedEffectId === undefined || audioOnly, mobile: requestedEffectId === undefined || audioOnly },
    cardsPendingHumanAcceptance: true
  }));
} finally {
  await browser.close();
}
