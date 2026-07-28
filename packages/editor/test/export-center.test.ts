import { mkdir, stat, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { addAssetToProject, createProjectFrameProducer, importMedia, runProcess, type ImportedMedia } from "@codemotion/exporter";
import type { LayerDefinition, MotionProject } from "@codemotion/core";
import { createStarterProject } from "../src/model.js";
import { estimateExportBytes, projectMedia, validateExportSettings, type ExportSettings } from "../src/export-center.js";
import { ExportTaskService } from "../src/export-task-service.js";

const root = resolve("tmp/stage-6-editor-test");
const input = resolve(root, "input");
const media = resolve(root, "media");
const output = resolve(root, "output");
const imagePath = resolve(input, "editor.png");
const audioPath = resolve(input, "editor.wav");
const videoPath = resolve(input, "editor.mp4");
let project: MotionProject;
let image: ImportedMedia;
let audio: ImportedMedia;
let video: ImportedMedia;

beforeAll(async () => {
  await mkdir(input, { recursive: true });
  await mkdir(output, { recursive: true });
  await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0x20c997:s=32x24:d=0.4", "-frames:v", "1", imagePath]);
  await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=0.4", "-c:a", "pcm_s16le", audioPath]);
  await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=s=32x24:r=24:d=0.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
  image = await importMedia({ sourcePath: imagePath, claimedMime: "image/png", allowedRoots: [input], storageDirectory: media });
  audio = await importMedia({ sourcePath: audioPath, claimedMime: "audio/wav", allowedRoots: [input], storageDirectory: media });
  video = await importMedia({ sourcePath: videoPath, claimedMime: "video/mp4", allowedRoots: [input], storageDirectory: media });
  project = withMediaReferences(
    addAssetToProject(addAssetToProject(addAssetToProject(createStarterProject("Stage 6"), image), audio), video),
    image,
    audio
  );
}, 30_000);

function withMediaReferences(base: MotionProject, visual: ImportedMedia, soundtrack: ImportedMedia): MotionProject {
  const referenced = structuredClone(base);
  const template = referenced.compositions[0]!.layers[0]!;
  const common = {
    ...template,
    id: `layer.media.${visual.asset.id}`,
    name: "Referenced project media",
    source: { assetId: visual.asset.id }
  };
  const visualLayer: LayerDefinition = visual.asset.type === "video"
    ? { ...common, type: "video", properties: { loop: false, muted: true } }
    : { ...common, type: "image", properties: { fit: "fill" } };
  referenced.compositions[0]!.layers = [visualLayer];
  referenced.audioTracks = [{
    id: `track.${soundtrack.asset.id}`,
    assetId: soundtrack.asset.id,
    startTime: 0,
    endTime: referenced.duration,
    volume: { mode: "constant", value: 1 }
  }];
  return referenced;
}

function settings(format: ExportSettings["format"]): ExportSettings {
  return {
    format, width: 32, height: 24, fps: 24, duration: 0.1,
    alpha: format === "png-sequence" || format === "webm",
    audio: format === "webm" || format === "mp4"
  };
}

async function waitFor(service: ExportTaskService, id: string, status: "completed" | "failed") {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const task = service.list().find((entry) => entry.id === id);
    if (task?.status === status) return task;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Task ${id} did not reach ${status}.`);
}

async function integrityFixture(label: string) {
  const storage = resolve(root, `integrity-${label}-${randomUUID()}`);
  const fixtureImage = await importMedia({
    sourcePath: imagePath, claimedMime: "image/png", allowedRoots: [input], storageDirectory: storage
  });
  const fixtureAudio = await importMedia({
    sourcePath: audioPath, claimedMime: "audio/wav", allowedRoots: [input], storageDirectory: storage
  });
  const fixtureProject = withMediaReferences(addAssetToProject(
    addAssetToProject(createStarterProject(`Integrity ${label}`, 32, 24, 24), fixtureImage),
    fixtureAudio
  ), fixtureImage, fixtureAudio);
  return { storage, fixtureImage, fixtureAudio, fixtureProject };
}

async function expectRejectedBeforeQueue(
  service: ExportTaskService,
  outputDirectory: string,
  creation: Promise<unknown>,
  expectedMessage: string,
  sensitivePaths: readonly string[]
) {
  let message = "";
  try {
    await creation;
    throw new Error("Expected task creation to fail.");
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message).toBe(expectedMessage);
  for (const path of [...sensitivePaths, outputDirectory]) expect(message).not.toContain(path);
  expect(service.list()).toHaveLength(0);
  await expect(stat(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("render center contracts", () => {
  it("filters verified project media and exposes only redacted metadata", () => {
    const views = projectMedia(project);
    expect(views).toHaveLength(3);
    expect(views.every((asset) => asset.valid)).toBe(true);
    expect(JSON.stringify(views)).not.toContain(input);
    expect(JSON.stringify(views)).not.toContain(media);
    expect(views.map((asset) => asset.shortHash)).toEqual(expect.arrayContaining([
      image.asset.hash!.slice(7, 19), audio.asset.hash!.slice(7, 19), video.asset.hash!.slice(7, 19)
    ]));
  });

  it("renders referenced project layers and evaluates a P0 effect at fixed project time", async () => {
    const animated = structuredClone(project);
    animated.compositions[0]!.layers[0]!.effects = [{
      id: "effect.stage6.fade",
      effectId: "fx.motion.fade",
      version: "1.0.0",
      enabled: true,
      startTime: 0,
      endTime: 1,
      mix: { mode: "constant", value: 1 },
      params: {
        from: { mode: "constant", value: 0 },
        to: { mode: "constant", value: 1 },
        duration: { mode: "constant", value: 1 }
      }
    }];
    const producer = createProjectFrameProducer(animated, new Map([[image.asset.id, image]]));
    const frameAt = async (frame: number) => producer({
      frame,
      time: frame / 24,
      deltaTime: 1 / 24,
      fps: 24,
      width: 32,
      height: 24
    });
    const start = await frameAt(0);
    const middle = await frameAt(12);
    expect(createHash("sha256").update(start).digest("hex"))
      .not.toBe(createHash("sha256").update(middle).digest("hex"));
  }, 30_000);

  it("reports format, duration, missing, and unverified resource errors", () => {
    expect(validateExportSettings(project, { ...settings("mp4"), alpha: true })).toContain("MP4 不支持透明通道。");
    expect(validateExportSettings(project, { ...settings("gif"), audio: true })).toContain("GIF不支持音轨。");
    const missing = structuredClone(project);
    missing.compositions[0]!.layers[0]!.source = { assetId: "missing" };
    expect(validateExportSettings(missing, settings("mp4"))).toContain("工程图层引用了缺失的图片或视频资源。");
    const videoProject = withMediaReferences(project, video, audio);
    const durationIssues = validateExportSettings(videoProject, { ...settings("mp4"), duration: 0.5 });
    expect(durationIssues.some((issue) => issue.startsWith("视频仅") && issue.endsWith("短于导出时长。"))).toBe(true);
    const unverified = structuredClone(project);
    unverified.assets.find((asset) => asset.id === image.asset.id)!.metadata.decodeVerified = false;
    expect(validateExportSettings(unverified, settings("png-sequence"))).toContain("工程图层引用了未通过解码验证的视觉资源。");
    expect(validateExportSettings(project, { ...settings("mp4"), width: 8192, height: 8192 }))
      .toContain("导出尺寸超过本地渲染预算。");
    expect(estimateExportBytes(settings("mp4"))).toBeGreaterThan(0);
  });

  it("rejects a missing visual resource before queue insertion without exposing paths", async () => {
    const fixture = await integrityFixture("missing");
    fixture.fixtureProject.assets[0]!.uri = `media://${"f".repeat(64)}.png`;
    fixture.fixtureProject.assets[0]!.hash = `sha256:${"f".repeat(64)}`;
    const outputDirectory = resolve(output, `missing-${randomUUID()}`);
    const service = new ExportTaskService(fixture.storage, outputDirectory);
    await expectRejectedBeforeQueue(
      service,
      outputDirectory,
      service.create(fixture.fixtureProject, settings("png-sequence")),
      "工程媒体完整性校验失败。",
      [fixture.storage, fixture.fixtureImage.storedPath]
    );
  });

  it("rejects a visual URI hash that disagrees with asset.hash before queue insertion", async () => {
    const fixture = await integrityFixture("uri-hash");
    fixture.fixtureProject.assets[0]!.hash = `sha256:${"e".repeat(64)}`;
    const outputDirectory = resolve(output, `uri-hash-${randomUUID()}`);
    const service = new ExportTaskService(fixture.storage, outputDirectory);
    await expectRejectedBeforeQueue(
      service,
      outputDirectory,
      service.create(fixture.fixtureProject, settings("png-sequence")),
      "工程媒体完整性校验失败。",
      [fixture.storage, fixture.fixtureImage.storedPath]
    );
  });

  it("rejects replaced visual bytes before queue insertion", async () => {
    const fixture = await integrityFixture("visual-replacement");
    await writeFile(fixture.fixtureImage.storedPath, Buffer.from("tampered after import"));
    const outputDirectory = resolve(output, `visual-replacement-${randomUUID()}`);
    const service = new ExportTaskService(fixture.storage, outputDirectory);
    await expectRejectedBeforeQueue(
      service,
      outputDirectory,
      service.create(fixture.fixtureProject, settings("png-sequence")),
      "工程媒体完整性校验失败。",
      [fixture.storage, fixture.fixtureImage.storedPath]
    );
  });

  it("rejects truncated audio bytes before queue insertion", async () => {
    const fixture = await integrityFixture("audio-truncation");
    await writeFile(fixture.fixtureAudio.storedPath, Buffer.alloc(1));
    const outputDirectory = resolve(output, `audio-truncation-${randomUUID()}`);
    const service = new ExportTaskService(fixture.storage, outputDirectory);
    const audioSettings: ExportSettings = settings("webm");
    await expectRejectedBeforeQueue(
      service,
      outputDirectory,
      service.create(fixture.fixtureProject, audioSettings),
      "工程媒体完整性校验失败。",
      [fixture.storage, fixture.fixtureAudio.storedPath]
    );
  });

  it.each(["png-sequence", "gif", "webm", "mp4"] as const)("runs a real %s task with progress, logs, history and download", async (format) => {
    const service = new ExportTaskService(media, resolve(output, format));
    const created = await service.create(project, settings(format));
    expect(["queued", "running"]).toContain(created.status);
    const completed = await waitFor(service, created.id, "completed");
    expect(completed.progress).toBe(1);
    expect(completed.completedFrames).toBe(completed.frameCount);
    expect(completed.outputBytes).toBeGreaterThan(0);
    expect(completed.logs.at(-1)).toContain("真实编码");
    expect(completed.video.codec).not.toBe("");
    const download = service.download(created.id);
    expect((await stat(download.path)).size).toBe(download.bytes);
    expect(service.list().some((task) => task.id === created.id)).toBe(true);
  }, 30_000);

  it.each([
    ["png-sequence", 1],
    ["mp4", 0]
  ] as const)("uses real frame failure recovery for %s from frame %i", async (format, expectedRestart) => {
    let fail = true;
    const frames: number[] = [];
    const service = new ExportTaskService(media, resolve(output, `retry-${format}`), (sourceProject, sources) => {
      const real = createProjectFrameProducer(sourceProject, sources);
      return async (request, signal) => {
        frames.push(request.frame);
        if (request.frame === 1 && fail) {
          fail = false;
          throw new Error("intentional one-shot frame failure");
        }
        return real(request, signal);
      };
    });
    const created = await service.create(project, { ...settings(format), audio: false, ...(format === "mp4" ? { alpha: false } : {}) });
    const failed = await waitFor(service, created.id, "failed");
    expect(failed.failure).toMatchObject({ stage: "render", frame: 1, recoverFromFrame: expectedRestart });
    const retried = await service.retry(created.id);
    expect(["queued", "running"]).toContain(retried.status);
    const completed = await waitFor(service, created.id, "completed");
    expect(completed.logs.some((line) => line.includes(`第 ${expectedRestart} 帧恢复`))).toBe(true);
    expect(frames.slice(0, 2)).toEqual([0, 1]);
    expect(frames[2]).toBe(expectedRestart);
  }, 30_000);
});
