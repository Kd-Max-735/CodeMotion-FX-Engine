import { mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import {
  TenantMediaStore,
  addAssetToProject,
  createProjectFrameProducer,
  runProcess,
  type ImportedMedia
} from "@codemotion/exporter";
import type { LayerDefinition, MotionProject } from "@codemotion/core";
import type { BrowserProjectEnvelopeV1 } from "@codemotion/schema";
import type { AuthenticatedSessionPrincipal } from "../src/auth-session-service.js";
import {
  estimateExportBytes,
  projectMedia,
  validateExportSettings,
  type ExportSettings
} from "../src/export-center.js";
import { ExportTaskService } from "../src/export-task-service.js";
import { EditorPreviewService } from "../src/preview-task-service.js";
import { createStarterProject } from "../src/model.js";

const root = resolve("tmp/stage-7r-g0-4-editor-export-test");
const input = resolve(root, "input");
const mediaRoot = resolve(root, "media");
const outputRoot = resolve(root, "output");
const imagePath = resolve(input, "editor.png");
const audioPath = resolve(input, "editor.wav");
const videoPath = resolve(input, "editor.mp4");
const svgPath = resolve(input, "editor.svg");
const owner = { tenantId: "tenant-export", userId: "user-export" };
const principal: AuthenticatedSessionPrincipal = {
  ...owner,
  scopes: ["export:create", "export:read"],
  issuer: "urn:test",
  audience: "test",
  issuedAt: 1,
  expiresAt: 2_000_000_000,
  sessionId: "export-session-id-012345678901234567890123456789",
  authSource: "local-dev-session"
};

let store: TenantMediaStore;
let image: ImportedMedia;
let audio: ImportedMedia;
let video: ImportedMedia;
let svg: ImportedMedia | undefined;
let envelope: BrowserProjectEnvelopeV1;
let authoritativeProject: MotionProject;

function shortExportProject(project: MotionProject, duration = 0.1): MotionProject {
  project.duration = duration;
  for (const composition of project.compositions) {
    composition.duration = duration;
    for (const layer of composition.layers) {
      layer.endTime = Math.min(layer.endTime, duration);
      layer.outPoint = Math.min(layer.outPoint, duration);
      for (const effect of layer.effects) effect.endTime = Math.min(effect.endTime ?? duration, duration);
    }
  }
  for (const track of project.audioTracks) track.endTime = Math.min(track.endTime, duration);
  return project;
}

function withMedia(base: MotionProject, visual: ImportedMedia, soundtrack: ImportedMedia): MotionProject {
  const project = shortExportProject(addAssetToProject(addAssetToProject(base, visual), soundtrack));
  const template = project.compositions[0]!.layers[0]!;
  const layer = {
    ...template,
    id: "layer.uploaded.image",
    name: "Uploaded image",
    type: visual.asset.type === "video" ? "video" : "image",
    source: { assetId: visual.asset.id },
    properties: visual.asset.type === "video" ? { loop: false, muted: true } : { fit: "fill" },
    effects: [],
    masks: []
  } as unknown as LayerDefinition;
  project.compositions[0]!.layers = [layer];
  project.audioTracks = [{
    id: "track.uploaded.audio",
    assetId: soundtrack.asset.id,
    startTime: 0,
    endTime: project.duration,
    volume: { mode: "constant", value: 1 }
  }];
  project.assets = project.assets.filter((asset) => asset.id === visual.asset.id || asset.id === soundtrack.asset.id);
  return project;
}

function visualEnvelope(visual: ImportedMedia): BrowserProjectEnvelopeV1 {
  const project = shortExportProject(addAssetToProject(createStarterProject(`Preview ${visual.asset.type}`, 32, 24, 24), visual));
  const template = project.compositions[0]!.layers[0]!;
  project.compositions[0]!.layers = [{
    ...template,
    id: `layer.preview.${visual.asset.type}`,
    name: `Uploaded ${visual.asset.type}`,
    type: visual.asset.type === "video" ? "video" : "image",
    source: { assetId: visual.asset.id },
    properties: visual.asset.type === "video" ? { loop: false, muted: true } : { fit: "fill" },
    effects: [], masks: []
  } as unknown as LayerDefinition];
  project.compositions[0]!.markers = [];
  project.assets = [visual.asset];
  project.audioTracks = [];
  project.fonts = [];
  const safe = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: [], brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!safe.valid) throw new Error(safe.error.code);
  return safe.value;
}

function audioEnvelope(soundtrack: ImportedMedia): BrowserProjectEnvelopeV1 {
  const project = shortExportProject(addAssetToProject(createStarterProject("Owner audio", 32, 24, 24), soundtrack));
  const template = project.compositions[0]!.layers[0]!;
  project.compositions[0]!.layers = [{
    ...template,
    id: "layer.owner.audio.shape",
    name: "Owner audio shape",
    type: "shape",
    properties: { shapes: [{ path: "M0 0 L32 0 L32 24 L0 24 Z", fill: "#20C997FF" }], fill: "#20C997FF" },
    effects: [], masks: []
  } as unknown as LayerDefinition];
  project.compositions[0]!.markers = [];
  project.assets = [soundtrack.asset];
  project.audioTracks = [{
    id: "track.owner.audio", assetId: soundtrack.asset.id, startTime: 0, endTime: project.duration,
    volume: { mode: "constant", value: 1 }
  }];
  project.fonts = [];
  const safe = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: [], brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!safe.valid) throw new Error(safe.error.code);
  return safe.value;
}

function mixedAudioEnvelope(sourceVideo: ImportedMedia, soundtrack: ImportedMedia): BrowserProjectEnvelopeV1 {
  const project = withMedia(createStarterProject("Mixed source and background audio", 32, 24, 24), sourceVideo, soundtrack);
  project.audioTracks = [
    {
      id: "audio_source_1",
      assetId: sourceVideo.asset.id,
      startTime: 0,
      endTime: Math.min(project.duration, Number(sourceVideo.asset.metadata.duration)),
      volume: { mode: "constant", value: 1 }
    },
    {
      id: "audio_bgm_1",
      assetId: soundtrack.asset.id,
      startTime: 0,
      endTime: Math.min(project.duration, Number(soundtrack.asset.metadata.duration)),
      volume: { mode: "constant", value: 0.35 }
    }
  ];
  const safe = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: [], brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!safe.valid) throw new Error(safe.error.code);
  return safe.value;
}

function tonePower(pcm: Buffer, frequency: number, sampleRate = 48_000): number {
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

beforeAll(async () => {
  // Let short isolated-process contract tests clear before starting real media subprocesses.
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 6_000));
  await mkdir(input, { recursive: true });
  await runProcess("ffmpeg", ["-hide_banner", "-y", "-threads", "1", "-f", "lavfi", "-i", "color=c=0x20c997:s=32x24:d=0.4", "-frames:v", "1", imagePath]);
  await runProcess("ffmpeg", ["-hide_banner", "-y", "-threads", "1", "-f", "lavfi", "-i", "sine=frequency=330:duration=0.4", "-c:a", "pcm_s16le", audioPath]);
  await runProcess("ffmpeg", [
    "-hide_banner", "-y", "-threads", "1",
    "-f", "lavfi", "-i", "testsrc2=s=32x24:r=24:d=0.4",
    "-f", "lavfi", "-i", "sine=frequency=660:duration=0.4",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", videoPath
  ]);
  await writeFile(svgPath, "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"24\" viewBox=\"0 0 32 24\"><rect width=\"32\" height=\"24\" fill=\"#20c997\"/></svg>");
  store = await new TenantMediaStore({ storageRoot: mediaRoot, allowedRoots: [input] }).initialize();
  image = await store.import(owner, { sourcePath: imagePath, claimedMime: "image/png", displayName: "editor.png" });
  audio = await store.import(owner, { sourcePath: audioPath, claimedMime: "audio/wav", displayName: "editor.wav" });
  video = await store.import(owner, { sourcePath: videoPath, claimedMime: "video/mp4", displayName: "editor.mp4" });
  const project = withMedia(createStarterProject("Stage 7R Export", 32, 24, 24), image, audio);
  authoritativeProject = addAssetToProject(project, video);
  const safe = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: [],
    brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!safe.valid) throw new Error(safe.error.code);
  envelope = safe.value;
}, 30_000);

function settings(format: ExportSettings["format"]): ExportSettings {
  return {
    format,
    width: 32,
    height: 24,
    fps: 24,
    duration: 0.1,
    alpha: format === "png-sequence" || format === "webm",
    audio: format === "webm" || format === "mp4"
  };
}

async function waitFor(
  service: ExportTaskService,
  id: string,
  taskPrincipal: AuthenticatedSessionPrincipal = principal
) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const task = (await service.list(taskPrincipal)).find((entry) => entry.id === id);
    if (task?.status === "completed" || task?.status === "failed") return task;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("Export did not settle.");
}

async function integrityFixture(label: string) {
  const fixtureRoot = resolve(root, `integrity-${label}-${randomUUID()}`);
  const fixtureStore = await new TenantMediaStore({
    storageRoot: resolve(fixtureRoot, "media"), allowedRoots: [input]
  }).initialize();
  const fixtureImage = await fixtureStore.import(owner, {
    sourcePath: imagePath, claimedMime: "image/png", displayName: "fixture.png"
  });
  const fixtureAudio = await fixtureStore.import(owner, {
    sourcePath: audioPath, claimedMime: "audio/wav", displayName: "fixture.wav"
  });
  const project = withMedia(createStarterProject(`Integrity ${label}`, 32, 24, 24), fixtureImage, fixtureAudio);
  const safe = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: [], brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!safe.valid) throw new Error(safe.error.code);
  const output = resolve(fixtureRoot, "output");
  const service = await new ExportTaskService({ resolver: fixtureStore, outputRoot: output }).initialize();
  return { fixtureStore, fixtureImage, fixtureAudio, envelope: safe.value, output, service };
}

async function expectRejectedBeforeQueue(
  service: ExportTaskService,
  output: string,
  creation: Promise<unknown>,
  code: string
): Promise<void> {
  await expect(creation).rejects.toMatchObject({ code });
  expect(await service.list(principal)).toHaveLength(0);
  expect(await readdir(output)).toEqual([]);
  await service.close();
}

describe("Stage 7R owner-aware export service", () => {
  it("keeps browser media state opaque and free of trusted metadata", () => {
    const views = projectMedia(envelope);
    expect(views).toHaveLength(2);
    expect(views.every((asset) => Object.keys(asset).sort().join(",") === "id,kind,label")).toBe(true);
    expect(JSON.stringify(views)).not.toContain(input);
    expect(JSON.stringify(views)).not.toContain(mediaRoot);
    expect(JSON.stringify(views)).not.toMatch(/hash|mime|codec|path|metadata/i);
  });

  it("renders referenced media and evaluates a real P0 effect at fixed project time", async () => {
    const animated = structuredClone(authoritativeProject);
    animated.compositions[0]!.layers[0]!.effects = [{
      id: "effect.stage7r.fade", effectId: "fx.motion.fade", version: "1.0.0", enabled: true,
      startTime: 0, endTime: 1, mix: { mode: "constant", value: 1 }, params: {
        from: { mode: "constant", value: 0 }, to: { mode: "constant", value: 1 },
        duration: { mode: "constant", value: 1 }
      }
    }];
    const producer = createProjectFrameProducer(animated, new Map([[image.asset.id, await store.resolve(owner, image.asset.id)]]));
    const frameAt = (frame: number) => producer({
      frame, time: frame / 24, deltaTime: frame === 0 ? 0 : 1 / 24, fps: 24, width: 32, height: 24
    });
    const start = await frameAt(0);
    const middle = await frameAt(1);
    expect(createHash("sha256").update(start).digest("hex"))
      .not.toBe(createHash("sha256").update(middle).digest("hex"));
  });

  it("validates export settings only through the safe browser envelope", () => {
    expect(validateExportSettings(envelope, { ...settings("mp4"), alpha: true })).toHaveLength(1);
    expect(validateExportSettings(envelope, { ...settings("gif"), audio: true })).toHaveLength(1);
    expect(validateExportSettings(envelope, { ...settings("mp4"), width: 8192, height: 8192 })).toHaveLength(1);
    expect(validateExportSettings(authoritativeProject, settings("mp4"))).toEqual(["Browser project envelope required."]);
    expect(validateExportSettings(envelope, { ...settings("mp4"), duration: envelope.project.duration / 2 }))
      .toEqual(["导出时长必须跟随当前工程时长。"]);
  });

  it.each([
    ["image", () => image], ["video", () => video]
  ] as const)("renders uploaded %s through the shared owner store and denies cross-owner resolution", async (_kind, media) => {
    const editableProject = visualEnvelope(media());
    const preview = new EditorPreviewService(store);
    const result = await preview.render(principal, {
      contract: "preview-request/v1", editableProject,
      frame: { time: 0.1, width: 32, height: 24, quality: "final" }
    });
    expect(result.pixels).toHaveLength(32 * 24 * 4);
    expect(result.pixels.some((value) => value !== 0)).toBe(true);
    await expect(preview.render({ ...principal, userId: "other-user" }, {
      contract: "preview-request/v1", editableProject,
      frame: { time: 0.1, width: 32, height: 24, quality: "final" }
    })).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await preview.close();
  });

  it("renders uploaded SVG proxy through the shared owner store and denies cross-owner resolution", async () => {
    svg ??= await store.import(owner, { sourcePath: svgPath, claimedMime: "image/svg+xml", displayName: "editor.svg" });
    const editableProject = visualEnvelope(svg);
    const preview = new EditorPreviewService(store);
    const result = await preview.render(principal, {
      contract: "preview-request/v1", editableProject,
      frame: { time: 0, width: 32, height: 24, quality: "final" }
    });
    expect(result.pixels).toHaveLength(32 * 24 * 4);
    await expect(preview.render({ ...principal, userId: "other-user" }, {
      contract: "preview-request/v1", editableProject,
      frame: { time: 0, width: 32, height: 24, quality: "final" }
    })).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await preview.close();
  }, 30_000);

  it.each(["mp4", "webm"] as const)("mixes independent video source audio and background music into real %s output", async (format) => {
    expect(video.asset.metadata.audioStreams).toBeGreaterThanOrEqual(1);
    const mixed = mixedAudioEnvelope(video, audio);
    expect(mixed.project.audioTracks.map((track) => [track.id, track.assetId, track.volume]))
      .toEqual([
        ["audio_source_1", video.asset.id, { mode: "constant", value: 1 }],
        ["audio_bgm_1", audio.asset.id, { mode: "constant", value: 0.35 }]
      ]);
    const service = await new ExportTaskService({
      resolver: store,
      outputRoot: resolve(outputRoot, `mixed-${format}`)
    }).initialize();
    const created = await service.create(principal, {
      contract: "export-request/v1",
      editableProject: mixed,
      settings: settings(format)
    });
    const completed = await waitFor(service, created.id);
    expect(completed.status).toBe("completed");
    const lease = await service.acquireDownload(principal, completed.id);
    const pcm = (await runProcess("ffmpeg", [
      "-v", "error", "-i", lease.path, "-map", "0:a:0", "-f", "s16le", "-ac", "1", "-ar", "48000", "pipe:1"
    ])).stdout;
    expect(tonePower(pcm, 330)).toBeGreaterThan(tonePower(pcm, 1_100) * 8);
    expect(tonePower(pcm, 660)).toBeGreaterThan(tonePower(pcm, 1_100) * 8);
    await lease.release();
    await service.close();
  }, 30_000);

  it("keeps Preview and Export pixels identical at the same dimensions and project time", async () => {
    const editableProject = visualEnvelope(image);
    const previewService = new EditorPreviewService(store);
    const resolveAsset = vi.spyOn(store, "resolve");
    let service: ExportTaskService | undefined;
    let lease: Awaited<ReturnType<ExportTaskService["acquireDownload"]>> | undefined;
    let framePath: string | undefined;
    let primaryFailure: unknown;
    const cleanupFailures: unknown[] = [];
    try {
      const preview = await previewService.render(principal, {
        contract: "preview-request/v1", editableProject,
        frame: { time: 0, width: 32, height: 24, quality: "final" }
      });
      service = await new ExportTaskService({
        resolver: store, outputRoot: resolve(outputRoot, `pixel-parity-${randomUUID()}`)
      }).initialize();
      const created = await service.create(principal, {
        contract: "export-request/v1", editableProject,
        settings: { ...settings("png-sequence"), audio: false }
      });
      const completed = await waitFor(service, created.id);
      expect(completed.status).toBe("completed");
      lease = await service.acquireDownload(principal, created.id);
      const archive = await readFile(lease.path);
      expect(archive.readUInt32LE(0)).toBe(0x04034b50);
      const size = archive.readUInt32LE(18);
      const offset = 30 + archive.readUInt16LE(26) + archive.readUInt16LE(28);
      const encodedFrame = archive.subarray(offset, offset + size);
      framePath = resolve(input, `pixel-parity-${created.id}.png`);
      await writeFile(framePath, encodedFrame);
      const decoded = await runProcess("ffmpeg", [
        "-v", "error", "-i", framePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
      ]);
      await unlink(framePath);
      framePath = undefined;
      const exportPixels = new Uint8Array(decoded.stdout);
      let firstDifferentByte = -1;
      for (let index = 0; index < Math.min(exportPixels.length, preview.pixels.length); index += 1) {
        if (exportPixels[index] !== preview.pixels[index]) { firstDifferentByte = index; break; }
      }
      if (firstDifferentByte < 0 && exportPixels.length !== preview.pixels.length) {
        firstDifferentByte = Math.min(exportPixels.length, preview.pixels.length);
      }
      const diagnostic = {
        previewLength: preview.pixels.length,
        previewSha256: createHash("sha256").update(preview.pixels).digest("hex"),
        exportLength: exportPixels.length,
        exportSha256: createHash("sha256").update(exportPixels).digest("hex"),
        firstDifferentByte,
        pixel: firstDifferentByte < 0 ? -1 : Math.floor(firstDifferentByte / 4),
        channel: firstDifferentByte < 0 ? -1 : firstDifferentByte % 4,
        previewValue: firstDifferentByte < 0 ? undefined : preview.pixels[firstDifferentByte],
        exportValue: firstDifferentByte < 0 ? undefined : exportPixels[firstDifferentByte],
        frame: { time: 0, width: 32, height: 24, quality: "final" },
        archivedPngLength: encodedFrame.length,
        archivedPngSha256: createHash("sha256").update(encodedFrame).digest("hex"),
        ffmpegExitCode: 0,
        ffmpegStderr: decoded.stderr.length === 0 ? "" : "[redacted]",
        sameEnvelope: editableProject.contract === "browser-project/v1"
      };
      expect(resolveAsset).toHaveBeenCalledTimes(2);
      for (const call of resolveAsset.mock.calls) {
        expect(call[0]).toEqual(owner);
        expect(call[1]).toBe(image.asset.id);
      }
      expect(exportPixels, JSON.stringify(diagnostic)).toEqual(preview.pixels);
    } catch (error) {
      primaryFailure = error;
    } finally {
      if (framePath !== undefined) {
        try { await unlink(framePath); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") cleanupFailures.push(error); }
      }
      if (lease !== undefined) {
        try { await lease.release(); }
        catch (error) { cleanupFailures.push(error); }
      }
      if (service !== undefined) {
        try { await service.close(); }
        catch (error) { cleanupFailures.push(error); }
      }
      try { await previewService.close(); }
      catch (error) { cleanupFailures.push(error); }
      try { resolveAsset.mockRestore(); }
      catch (error) { cleanupFailures.push(error); }
    }
    if (primaryFailure !== undefined) {
      if (cleanupFailures.length > 0) {
        throw new AggregateError([primaryFailure, ...cleanupFailures], "Pixel parity and cleanup both failed.");
      }
      throw primaryFailure;
    }
    if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, "Pixel parity cleanup failed.");
  }, 30_000);

  it("rejects a missing owner visual before queue insertion", async () => {
    const fixture = await integrityFixture("missing");
    const emptyStore = await new TenantMediaStore({
      storageRoot: resolve(root, `empty-${randomUUID()}`), allowedRoots: [input]
    }).initialize();
    const service = await new ExportTaskService({ resolver: emptyStore, outputRoot: fixture.output }).initialize();
    await fixture.service.close();
    await expectRejectedBeforeQueue(service, fixture.output, service.create(principal, {
      contract: "export-request/v1", editableProject: fixture.envelope, settings: settings("png-sequence")
    }), "NOT_FOUND");
  });

  it("rejects forged browser URI/hash fields before owner resolution and queue insertion", async () => {
    const fixture = await integrityFixture("forged-address");
    const resolveAsset = vi.spyOn(fixture.fixtureStore, "resolve");
    const forged = structuredClone(fixture.envelope) as unknown as { project: { assets: Array<Record<string, unknown>> } };
    forged.project.assets[0]!.uri = "file:///secret/forged.png";
    forged.project.assets[0]!.hash = `sha256:${"f".repeat(64)}`;
    await expectRejectedBeforeQueue(fixture.service, fixture.output, fixture.service.create(principal, {
      contract: "export-request/v1", editableProject: forged as never, settings: settings("png-sequence")
    }), "PROJECT_VALIDATION_FAILED");
    expect(resolveAsset).not.toHaveBeenCalled();
  });

  it("rejects replaced authoritative visual bytes before queue insertion", async () => {
    const fixture = await integrityFixture("visual-replacement");
    await writeFile(fixture.fixtureImage.storedPath, Buffer.from("tampered after import"));
    await expectRejectedBeforeQueue(fixture.service, fixture.output, fixture.service.create(principal, {
      contract: "export-request/v1", editableProject: fixture.envelope, settings: settings("png-sequence")
    }), "MEDIA_VALIDATION_FAILED");
  });

  it("rejects truncated authoritative audio bytes before queue insertion", async () => {
    const fixture = await integrityFixture("audio-truncation");
    await writeFile(fixture.fixtureAudio.storedPath, Buffer.alloc(1));
    await expectRejectedBeforeQueue(fixture.service, fixture.output, fixture.service.create(principal, {
      contract: "export-request/v1", editableProject: fixture.envelope, settings: settings("webm")
    }), "MEDIA_VALIDATION_FAILED");
  });

  it("isolates the same audio asset ID by owner and rejects a missing owner before task or FFmpeg work", async () => {
    const ownerB = { tenantId: owner.tenantId, userId: "user-export-b" };
    const principalB = { ...principal, ...ownerB };
    const ownerC = { tenantId: owner.tenantId, userId: "user-export-c" };
    const principalC = { ...principal, ...ownerC };
    const audioB = await store.import(ownerB, {
      sourcePath: audioPath, claimedMime: "audio/wav", displayName: "owner-b.wav"
    });
    expect(audioB.asset.id).toBe(audio.asset.id);
    expect(audioB.storedPath).not.toBe(audio.storedPath);
    const editableProject = audioEnvelope(audio);
    const resolved: Array<{ owner: string; path?: string }> = [];
    const resolver = {
      resolve: async (requestedOwner: { tenantId: string; userId: string }, assetId: string, signal?: AbortSignal) => {
        const entry: { owner: string; path?: string } = { owner: requestedOwner.userId };
        resolved.push(entry);
        const media = await store.resolve(requestedOwner, assetId, signal);
        entry.path = media.storedPath;
        return media;
      }
    };
    const crossRoot = resolve(outputRoot, `cross-owner-audio-${randomUUID()}`);
    const crossService = await new ExportTaskService({ resolver, outputRoot: crossRoot }).initialize();
    const before = resolved.length;
    await expect(crossService.create(principalC, {
      contract: "export-request/v1", editableProject, settings: settings("mp4")
    })).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(resolved.slice(before)).toEqual([{ owner: ownerC.userId }]);
    expect(await crossService.list(principalC)).toEqual([]);
    expect(await readdir(crossRoot)).toEqual([]);
    await crossService.close();

    const service = await new ExportTaskService({
      resolver, outputRoot: resolve(outputRoot, `same-audio-${randomUUID()}`)
    }).initialize();
    const createdA = await service.create(principal, {
      contract: "export-request/v1", editableProject, settings: settings("mp4")
    });
    const createdB = await service.create(principalB, {
      contract: "export-request/v1", editableProject, settings: settings("mp4")
    });
    const completedA = await waitFor(service, createdA.id);
    const completedB = await waitFor(service, createdB.id, principalB);
    expect([completedA.status, completedB.status]).toEqual(["completed", "completed"]);
    expect(resolved).toEqual(expect.arrayContaining([
      { owner: owner.userId, path: audio.storedPath },
      { owner: ownerB.userId, path: audioB.storedPath }
    ]));
    for (const [taskPrincipal, taskId] of [[principal, createdA.id], [principalB, createdB.id]] as const) {
      const lease = await service.acquireDownload(taskPrincipal, taskId);
      const probe = JSON.parse((await runProcess("ffprobe", [
        "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", lease.path
      ])).stdout.toString("utf8")) as { streams: Array<{ codec_type: string; codec_name: string }> };
      expect(probe.streams).toEqual(expect.arrayContaining([
        expect.objectContaining({ codec_type: "audio", codec_name: "aac" })
      ]));
      await lease.release();
    }
    await service.close();
  }, 30_000);

  it("keeps byte estimation available for the render center", () => {
    expect(estimateExportBytes(settings("mp4"))).toBeGreaterThan(0);
  });

  it.each([
    ["mp4", "libx264", "aac", "h264", "aac"],
    ["webm", "libvpx-vp9", "libopus", "vp9", "opus"]
  ] as const)("materializes through the shared owner store and performs real %s audio mux and decode", async (
    format, viewCodec, viewAudioCodec, probeCodec, probeAudioCodec
  ) => {
    const service = await new ExportTaskService({ resolver: store, outputRoot: resolve(outputRoot, format) }).initialize();
    const created = await service.create(principal, {
      contract: "export-request/v1",
      editableProject: envelope,
      settings: settings(format)
    });
    const completed = await waitFor(service, created.id);
    expect(completed.status).toBe("completed");
    expect(completed.video).toMatchObject({ codec: viewCodec, audioCodec: viewAudioCodec });
    expect(JSON.stringify(completed)).not.toContain(mediaRoot);
    expect(JSON.stringify(completed)).not.toContain(owner.tenantId);
    const [lease, parallelLease] = await Promise.all([
      service.acquireDownload(principal, completed.id),
      service.acquireDownload(principal, completed.id)
    ]);
    expect((await stat(lease.path)).size).toBe(completed.outputBytes);
    const probe = JSON.parse((await runProcess("ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", lease.path
    ])).stdout.toString("utf8")) as { streams: Array<{ codec_type: string; codec_name: string }> };
    expect(probe.streams).toEqual(expect.arrayContaining([
      expect.objectContaining({ codec_type: "video", codec_name: probeCodec }),
      expect.objectContaining({ codec_type: "audio", codec_name: probeAudioCodec })
    ]));
    await runProcess("ffmpeg", ["-v", "error", "-i", lease.path, "-f", "null", "-"]);
    const aborted = new Promise<void>((resolveAbort) => {
      lease.controller.signal.addEventListener("abort", () => resolveAbort(), { once: true });
    });
    const closing = service.close();
    await aborted;
    await Promise.all([lease.release(), parallelLease.release()]);
    await closing;
    const restarted = await new ExportTaskService({
      resolver: store,
      outputRoot: resolve(outputRoot, format)
    }).initialize();
    expect((await restarted.get(principal, completed.id)).status).toBe("completed");
    await restarted.close();
  }, 30_000);

  it.each(["png-sequence", "gif"] as const)("runs a real %s task with progress, list/get history and download", async (format) => {
    const service = await new ExportTaskService({ resolver: store, outputRoot: resolve(outputRoot, format) }).initialize();
    const created = await service.create(principal, {
      contract: "export-request/v1", editableProject: envelope, settings: settings(format)
    });
    expect(["queued", "running"]).toContain(created.status);
    const completed = await waitFor(service, created.id);
    expect(completed).toMatchObject({ status: "completed", progress: 1, completedFrames: completed.frameCount });
    expect(completed.outputBytes).toBeGreaterThan(0);
    expect((await service.get(principal, created.id)).id).toBe(created.id);
    expect((await service.list(principal)).some((task) => task.id === created.id)).toBe(true);
    const lease = await service.acquireDownload(principal, created.id);
    expect((await stat(lease.path)).size).toBe(lease.bytes);
    if (format === "gif") await runProcess("ffmpeg", ["-v", "error", "-i", lease.path, "-f", "null", "-"]);
    await lease.release();
    await service.close();
  }, 30_000);

  it("returns 404 for the same task ID under another owner before download open", async () => {
    const service = await new ExportTaskService({ resolver: store, outputRoot: resolve(root, "isolation-output") }).initialize();
    const created = await service.create(principal, {
      contract: "export-request/v1",
      editableProject: envelope,
      settings: settings("png-sequence")
    });
    const other = { ...principal, tenantId: "tenant-other" };
    await expect(service.get(other, created.id)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(service.acquireDownload(other, created.id)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await service.cancel(principal, created.id);
    await service.close();
  });

  it("atomically tombstones an expired output and denies every new lease", async () => {
    let now = new Date("2026-08-04T00:00:00.000Z");
    const service = await new ExportTaskService({
      resolver: store,
      outputRoot: resolve(root, "expiry-output"),
      now: () => now
    }).initialize();
    const created = await service.create(principal, {
      contract: "export-request/v1",
      editableProject: envelope,
      settings: settings("png-sequence")
    });
    const completed = await waitFor(service, created.id);
    expect(completed.status).toBe("completed");
    now = new Date("2026-08-05T00:00:00.001Z");
    await expect(service.get(principal, completed.id)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    await expect(service.acquireDownload(principal, completed.id)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect((await service.list(principal)).some((task) => task.id === completed.id)).toBe(false);
    await service.close();
  }, 30_000);

  it("denies new leases after tombstone and bounds an active stream to 30 seconds plus 5 seconds", async () => {
    let now = new Date("2026-08-04T00:00:00.000Z");
    const service = await new ExportTaskService({
      resolver: store, outputRoot: resolve(root, `active-lease-${randomUUID()}`), now: () => now
    }).initialize();
    const created = await service.create(principal, {
      contract: "export-request/v1", editableProject: envelope, settings: settings("png-sequence")
    });
    const completed = await waitFor(service, created.id);
    const lease = await service.acquireDownload(principal, completed.id);
    const aborted = new Promise<void>((resolveAborted) => {
      lease.controller.signal.addEventListener("abort", () => resolveAborted(), { once: true });
    });
    now = new Date("2026-08-05T00:00:00.001Z");
    vi.useFakeTimers();
    try {
      await service.sweep();
      await expect(service.acquireDownload(principal, completed.id)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(lease.controller.signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await aborted;
      expect(lease.controller.signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(5_000);
    } finally {
      vi.useRealTimers();
      await lease.release();
      await service.close();
    }
  }, 30_000);

  it("recovers a persisted tombstone, clears stale leases, retries each explicit cleanup file, and retains clean tombstones", async () => {
    let now = new Date("2026-08-04T00:00:00.000Z");
    const lifecycleRoot = resolve(root, `restart-cleanup-${randomUUID()}`);
    const initial = await new ExportTaskService({ resolver: store, outputRoot: lifecycleRoot, now: () => now }).initialize();
    const created = await initial.create(principal, {
      contract: "export-request/v1", editableProject: envelope, settings: settings("png-sequence")
    });
    const completed = await waitFor(initial, created.id);
    expect(completed.status).toBe("completed");
    await initial.close();

    const directory = join(lifecycleRoot, created.id);
    const recordPath = join(directory, "task-record-v1.json");
    const blockedPath = join(directory, "blocked-output.bin");
    await mkdir(blockedPath);
    const record = JSON.parse(await readFile(recordPath, "utf8")) as Record<string, unknown>;
    Object.assign(record, {
      deletionPhase: "tombstoned-cleanup-pending",
      tombstonedAt: now.toISOString(),
      pendingFiles: [blockedPath],
      leases: [{ id: "stale-lease", runtimeId: "prior-runtime", acquiredAt: now.toISOString() }],
      cleanupAttempts: 0
    });
    await writeFile(recordPath, JSON.stringify(record));

    const restarted = await new ExportTaskService({ resolver: store, outputRoot: lifecycleRoot, now: () => now }).initialize();
    const persisted = async () => JSON.parse(await readFile(recordPath, "utf8")) as {
      leases: unknown[]; cleanupAttempts: number; nextCleanupAt?: string;
      pendingFiles: string[]; deletionPhase: string; tombstonedAt: string;
    };
    expect(await persisted()).toMatchObject({
      leases: [], cleanupAttempts: 1, pendingFiles: [blockedPath],
      deletionPhase: "tombstoned-cleanup-pending",
      nextCleanupAt: "2026-08-04T00:01:00.000Z"
    });
    for (const [advance, attempt, next] of [
      [60_000, 2, "2026-08-04T00:06:00.000Z"],
      [5 * 60_000, 3, "2026-08-04T00:36:00.000Z"],
      [30 * 60_000, 4, "2026-08-04T01:36:00.000Z"]
    ] as const) {
      now = new Date(now.getTime() + advance);
      await restarted.sweep();
      expect(await persisted()).toMatchObject({ cleanupAttempts: attempt, nextCleanupAt: next, pendingFiles: [blockedPath] });
    }
    await rmdir(blockedPath);
    now = new Date(now.getTime() + 60 * 60_000);
    await restarted.sweep();
    expect(await persisted()).toMatchObject({
      leases: [], pendingFiles: [], deletionPhase: "tombstoned-clean"
    });
    await expect(restarted.get(principal, created.id)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    now = new Date("2026-08-11T00:00:00.001Z");
    await restarted.sweep();
    await expect(stat(recordPath)).rejects.toMatchObject({ code: "ENOENT" });
    await restarted.close();
  }, 30_000);

  it("recovers active, failed, and cancelled records and retries each explicit partial cleanup", async () => {
    let now = new Date("2026-08-04T12:00:00.000Z");
    const restartRoot = resolve(root, `restart-active-${randomUUID()}`);
    const initial = await new ExportTaskService({ resolver: store, outputRoot: restartRoot, now: () => now }).initialize();
    const created = await initial.create(principal, {
      contract: "export-request/v1", editableProject: envelope, settings: settings("png-sequence")
    });
    await waitFor(initial, created.id);
    await initial.close();
    const template = JSON.parse(await readFile(join(restartRoot, created.id, "task-record-v1.json"), "utf8")) as Record<string, any>;
    const completedDownload = template.downloadPath as string;
    const otherId = randomUUID();
    const otherDirectory = join(restartRoot, otherId);
    const otherOutput = join(otherDirectory, "other-owner-output.zip");
    await mkdir(otherDirectory);
    await writeFile(otherOutput, "other-owner-completed");
    const otherRecord = structuredClone(template);
    otherRecord.owner = { tenantId: "tenant-other", userId: "user-other" };
    otherRecord.view = { ...otherRecord.view, id: otherId, outputBytes: 21, downloadName: "other.zip" };
    otherRecord.outputPath = join(otherDirectory, "frames");
    otherRecord.downloadPath = otherOutput;
    otherRecord.pendingFiles = [otherOutput];
    await writeFile(join(otherDirectory, "task-record-v1.json"), JSON.stringify(otherRecord));

    const fixtures: Array<{
      id: string; status: "queued" | "running" | "cancelling" | "failed" | "cancelled";
      recordPath: string; outputPath: string; blockedPath?: string;
    }> = [];
    for (const status of ["queued", "running", "cancelling", "failed", "cancelled"] as const) {
      const id = randomUUID();
      const directory = join(restartRoot, id);
      const outputPath = join(directory, "partial.mp4");
      const blockedPath = status === "failed" || status === "cancelled" ? join(directory, "blocked-partial.bin") : undefined;
      const recordPath = join(directory, "task-record-v1.json");
      await mkdir(directory);
      await writeFile(outputPath, `partial-${status}`);
      if (blockedPath !== undefined) await mkdir(blockedPath);
      const record = structuredClone(template);
      record.view = { ...record.view, id, status, progress: 0, completedFrames: 0, updatedAt: now.toISOString() };
      delete record.view.outputBytes;
      delete record.view.downloadName;
      if (status === "failed" || status === "cancelled") {
        record.view.expiresAt = "2026-08-05T12:00:00.000Z";
      } else {
        delete record.view.expiresAt;
      }
      if (status === "failed") {
        record.view.failure = {
          stage: "encode", frame: 0, time: 0, recoverFromFrame: 0,
          code: "OUTPUT_ENCODING_FAILED", message: "Output encoding failed."
        };
      } else delete record.view.failure;
      record.outputPath = outputPath;
      delete record.downloadPath;
      record.pendingFiles = blockedPath === undefined ? [outputPath] : [outputPath, blockedPath];
      record.deletionPhase = "live";
      record.leases = [];
      record.cleanupAttempts = 0;
      delete record.nextCleanupAt;
      delete record.cleanupFailure;
      await writeFile(recordPath, JSON.stringify(record));
      fixtures.push({ id, status, recordPath, outputPath, ...(blockedPath === undefined ? {} : { blockedPath }) });
    }
    const restarted = await new ExportTaskService({ resolver: store, outputRoot: restartRoot, now: () => now }).initialize();
    for (const fixture of fixtures) {
      expect(await restarted.get(principal, fixture.id)).toMatchObject({
        status: fixture.status === "failed" ? "failed" : "cancelled",
        expiresAt: "2026-08-05T12:00:00.000Z"
      });
      const persisted = JSON.parse(await readFile(fixture.recordPath, "utf8")) as Record<string, any>;
      expect(persisted.pendingFiles).toEqual(fixture.blockedPath === undefined ? [] : [fixture.blockedPath]);
      if (fixture.blockedPath !== undefined) {
        expect(persisted).toMatchObject({
          cleanupAttempts: 1, cleanupFailure: "filesystem", nextCleanupAt: "2026-08-04T12:01:00.000Z"
        });
      }
      await expect(stat(fixture.outputPath)).rejects.toMatchObject({ code: "ENOENT" });
    }
    expect((await stat(completedDownload)).isFile()).toBe(true);
    expect((await restarted.get(principal, created.id)).status).toBe("completed");
    const otherPrincipal = { ...principal, tenantId: "tenant-other", userId: "user-other" };
    expect((await restarted.get(otherPrincipal, otherId)).status).toBe("completed");
    expect((await stat(otherOutput)).isFile()).toBe(true);

    for (const [advance, attempts, nextCleanupAt] of [
      [60_000, 2, "2026-08-04T12:06:00.000Z"],
      [5 * 60_000, 3, "2026-08-04T12:36:00.000Z"],
      [30 * 60_000, 4, "2026-08-04T13:36:00.000Z"]
    ] as const) {
      now = new Date(now.getTime() + advance);
      await restarted.sweep();
      for (const fixture of fixtures.filter((entry) => entry.blockedPath !== undefined)) {
        expect(JSON.parse(await readFile(fixture.recordPath, "utf8"))).toMatchObject({
          cleanupAttempts: attempts, nextCleanupAt, pendingFiles: [fixture.blockedPath]
        });
      }
    }
    for (const fixture of fixtures) if (fixture.blockedPath !== undefined) await rmdir(fixture.blockedPath);
    now = new Date(now.getTime() + 60 * 60_000);
    await restarted.sweep();
    for (const fixture of fixtures.filter((entry) => entry.blockedPath !== undefined)) {
      const persisted = JSON.parse(await readFile(fixture.recordPath, "utf8")) as Record<string, unknown>;
      expect(persisted).toMatchObject({ pendingFiles: [], cleanupAttempts: 4 });
      expect(persisted).not.toHaveProperty("cleanupFailure");
      expect(persisted).not.toHaveProperty("nextCleanupAt");
    }
    expect((await stat(completedDownload)).isFile()).toBe(true);
    expect((await stat(otherOutput)).isFile()).toBe(true);
    await restarted.close();
  }, 30_000);
});
