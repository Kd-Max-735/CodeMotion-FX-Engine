import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MotionProject } from "@codemotion/core";
import {
  addAssetToProject,
  DOCUMENT_EXPORT_PRESETS,
  ExportFrameError,
  createMediaFrameProducer,
  createProjectFrameProducer,
  decodeAudioPreview,
  exportFixedFrames,
  importMedia,
  removeStoredMedia,
  runProcess,
  validateExportPreset,
  verifyStoredMediaAsset,
  type ExportPreset,
  type FrameRequest
} from "../src/index.js";

const root = resolve("tmp/stage-6-test");
const input = resolve(root, "input");
const storage = resolve(root, "storage");
const output = resolve(root, "output");
const imagePath = resolve(input, "sample.png");
const audioPath = resolve(input, "sample.wav");
const videoPath = resolve(input, "sample.mp4");

beforeAll(async () => {
  await mkdir(input, { recursive: true });
  await mkdir(output, { recursive: true });
  await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=red@0.5:s=32x24:d=0.2", "-frames:v", "1", imagePath]);
  await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3", "-c:a", "pcm_s16le", audioPath]);
  await runProcess("ffmpeg", ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=s=32x24:r=24:d=0.3", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
});

function testPreset(
  format: ExportPreset["format"],
  fps: number,
  width: number,
  height: number,
  alpha: boolean,
  audio: boolean
): ExportPreset {
  return {
    id: `test-${format}-${fps}-${width}`,
    name: "test",
    format,
    quality: "final",
    settings: {
      width, height, fps, alpha, audio, crf: 30,
      ...(format === "webm" ? { videoCodec: "libvpx-vp9", audioCodec: "libopus" } : {}),
      ...(format === "mp4" ? { videoCodec: "libx264", audioCodec: "aac" } : {})
    }
  };
}

function render(request: FrameRequest): Uint8Array {
  const pixels = new Uint8Array(request.width * request.height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    const x = (index / 4) % request.width;
    pixels[index] = (request.frame * 29) % 256;
    pixels[index + 1] = Math.round(request.time * 255) % 256;
    pixels[index + 2] = 173;
    pixels[index + 3] = x < request.width / 3 ? 0 : x < request.width * 2 / 3 ? 128 : 255;
  }
  return pixels;
}

function alphaAt(bytes: Uint8Array, width: number, x: number, y: number): number {
  return bytes[(y * width + x) * 4 + 3]!;
}

describe("fixed frame export", () => {
  it("feeds explicit transparent, semi-transparent, and opaque regions to FFmpeg", () => {
    const frame = render({ frame: 0, time: 0, deltaTime: 1 / 24, fps: 24, width: 12, height: 4 });
    expect(alphaAt(frame, 12, 1, 2)).toBe(0);
    expect(alphaAt(frame, 12, 5, 2)).toBe(128);
    expect(alphaAt(frame, 12, 10, 2)).toBe(255);
  });

  it("uses exact frame-derived time and locates a failed frame", async () => {
    const requests: FrameRequest[] = [];
    await expect(exportFixedFrames({
      preset: testPreset("png-sequence", 24, 8, 8, true, false),
      duration: 3 / 24,
      outputPath: resolve(output, "timing"),
      renderFrame(request) {
        requests.push(request);
        if (request.frame === 2) throw new Error("fixture failure");
        return render(request);
      }
    })).rejects.toMatchObject({
      failure: {
        stage: "render", frame: 2, time: 2 / 24, recoverFromFrame: 2,
        message: "Error: fixture failure"
      }
    } satisfies Partial<ExportFrameError>);
    expect(requests.map(({ frame, time, deltaTime }) => ({ frame, time, deltaTime }))).toEqual([
      { frame: 0, time: 0, deltaTime: 0 },
      { frame: 1, time: 1 / 24, deltaTime: 1 / 24 },
      { frame: 2, time: 2 / 24, deltaTime: 1 / 24 }
    ]);
  });

  it.each([
    ["png-sequence", 24, 64, 36, true, false],
    ["gif", 30, 80, 48, false, false],
    ["webm", 60, 64, 36, true, false],
    ["webm", 24, 80, 48, false, true],
    ["mp4", 30, 64, 36, false, false],
    ["mp4", 60, 80, 48, false, true]
  ] as const)("encodes %s at %i fps %ix%i alpha=%s audio=%s", async (format, fps, width, height, alpha, audio) => {
    const extension = format === "png-sequence" ? "" : `.${format}`;
    const target = resolve(output, `${format}-${fps}-${width}x${height}${audio ? "-audio" : ""}${extension}`);
    const report = await exportFixedFrames({
      preset: testPreset(format, fps, width, height, alpha, audio),
      duration: 0.1,
      outputPath: target,
      renderFrame: render,
      ...(audio ? { audioPath } : {})
    });
    expect(report.frameCount).toBe(Math.ceil(0.1 * fps));
    expect(report.inspections).toHaveLength(report.frameCount);
    const probeTarget = format === "png-sequence" ? resolve(target, "frame-00000001.png") : target;
    const probe = JSON.parse((await runProcess("ffprobe", [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", probeTarget
    ])).stdout.toString("utf8")) as {
      streams: Array<{
        codec_type: string;
        pix_fmt?: string;
        avg_frame_rate?: string;
        start_time?: string;
        duration?: string;
        tags?: { alpha_mode?: string; DURATION?: string };
      }>;
      format: { duration?: string };
    };
    expect(probe.streams.some((stream) => stream.codec_type === "video")).toBe(true);
    expect(probe.streams.some((stream) => stream.codec_type === "audio")).toBe(audio);
    const video = probe.streams.find((stream) => stream.codec_type === "video");
    if (format === "png-sequence" && alpha) expect(video?.pix_fmt).toBe("rgba");
    if (format === "webm" && alpha) {
      expect(video?.tags?.alpha_mode).toBe("1");
      const decoded = (await runProcess("ffmpeg", [
        "-v", "error", "-c:v", "libvpx-vp9", "-i", target, "-frames:v", "1",
        "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
      ])).stdout;
      expect(alphaAt(decoded, width, 1, Math.floor(height / 2))).toBeLessThanOrEqual(8);
      expect(alphaAt(decoded, width, Math.floor(width / 2), Math.floor(height / 2))).toBeGreaterThanOrEqual(112);
      expect(alphaAt(decoded, width, Math.floor(width / 2), Math.floor(height / 2))).toBeLessThanOrEqual(144);
      expect(alphaAt(decoded, width, width - 2, Math.floor(height / 2))).toBeGreaterThanOrEqual(247);
    }
    if (format === "webm" && !alpha) expect(video?.tags?.alpha_mode).toBeUndefined();
    if (format !== "png-sequence") {
      const [rateNumerator, rateDenominator] = (video?.avg_frame_rate ?? "0/1").split("/").map(Number);
      const actualFps = rateNumerator! / rateDenominator!;
      const expectedFps = format === "gif" ? 100 / Math.round(100 / fps) : fps;
      expect(actualFps).toBeCloseTo(expectedFps, 5);
      const encodedDuration = Number(probe.format.duration);
      expect(encodedDuration).toBeGreaterThanOrEqual(report.frameCount / fps - 0.01);
      expect(encodedDuration).toBeLessThanOrEqual(report.frameCount / fps + 0.05);
      await runProcess("ffmpeg", ["-v", "error", "-i", target, "-f", "null", "-"]);
    }
    if (audio) {
      const streams = probe.streams.filter((stream) => stream.codec_type === "video" || stream.codec_type === "audio");
      expect(streams.every((stream) => Math.abs(Number(stream.start_time ?? 0)) <= 0.05)).toBe(true);
      const seconds = (stream: typeof streams[number]): number => {
        if (stream.duration !== undefined) return Number(stream.duration);
        const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(stream.tags?.DURATION ?? "");
        return match === null ? Number.NaN : Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      };
      expect(Math.abs(seconds(streams[0]!) - seconds(streams[1]!))).toBeLessThanOrEqual(1 / fps + 0.03);
    }
  }, 30_000);

  it("rejects unsupported alpha/audio preset combinations", () => {
    expect(() => validateExportPreset(testPreset("mp4", 30, 64, 36, true, false))).toThrow(/alpha/);
    expect(() => validateExportPreset({
      ...testPreset("webm", 30, 64, 36, true, false),
      settings: { ...testPreset("webm", 30, 64, 36, true, false).settings, videoCodec: "vp9_qsv" }
    })).toThrow(/libvpx/);
    expect(() => validateExportPreset(testPreset("gif", 30, 64, 36, false, true))).toThrow(/audio/);
    expect(() => validateExportPreset(testPreset("mp4", 30, 8192, 8192, false, false))).toThrow(/render budget/);
    expect(DOCUMENT_EXPORT_PRESETS).toHaveLength(4);
  });

  it("resumes PNG at an exact frame and rejects compressed midstream resume", async () => {
    const target = resolve(output, "resume-png");
    const report = await exportFixedFrames({
      preset: testPreset("png-sequence", 24, 8, 8, true, false),
      duration: 4 / 24,
      outputPath: target,
      resumeFromFrame: 2,
      renderFrame: render
    });
    expect(report.inspections.map((entry) => entry.frame)).toEqual([2, 3]);
    expect((await stat(resolve(target, "frame-00000002.png"))).isFile()).toBe(true);
    await expect(exportFixedFrames({
      preset: testPreset("mp4", 24, 8, 8, false, false),
      duration: 4 / 24,
      outputPath: resolve(output, "invalid-resume.mp4"),
      resumeFromFrame: 2,
      renderFrame: render
    })).rejects.toThrow(/frame 0/);
  });
});

describe("media input contract", () => {
  it.each([
    [imagePath, "image/png", "image"],
    [audioPath, "audio/wav", "audio"],
    [videoPath, "video/mp4", "video"]
  ] as const)("validates and content-addresses %s", async (sourcePath, claimedMime, kind) => {
    const imported = await importMedia({
      sourcePath, claimedMime, allowedRoots: [input], storageDirectory: storage
    });
    expect(imported.asset.type).toBe(kind);
    expect(imported.asset.id).toMatch(/^asset_[0-9a-f]{24}$/);
    expect(imported.asset.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(imported.asset.metadata).not.toHaveProperty("originalPath");
    expect(imported.descriptor.metadata.decodeVerified).toBe(true);
    expect((await stat(imported.storedPath)).isFile()).toBe(true);
    const project = { assets: [] } as unknown as MotionProject;
    const referenced = addAssetToProject(project, imported);
    expect(referenced.assets[0]?.id).toBe(imported.asset.id);
    expect(addAssetToProject(referenced, imported)).toBe(referenced);
  }, 30_000);

  it("rejects MIME mismatch, damaged files, cancellation, and paths outside the root", async () => {
    const damaged = resolve(input, "damaged.png");
    await writeFile(damaged, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
    await expect(importMedia({
      sourcePath: imagePath, claimedMime: "video/mp4", allowedRoots: [input], storageDirectory: storage
    })).rejects.toThrow(/MIME/);
    await expect(importMedia({
      sourcePath: damaged, claimedMime: "image/png", allowedRoots: [input], storageDirectory: storage
    })).rejects.toThrow();
    await expect(importMedia({
      sourcePath: imagePath, claimedMime: "image/png", allowedRoots: [storage], storageDirectory: storage
    })).rejects.toThrow(/allowed roots/);
    await expect(importMedia({
      sourcePath: imagePath, claimedMime: "image/png", allowedRoots: [input], storageDirectory: storage,
      limits: { imageBytes: 4 }
    })).rejects.toThrow(/size/);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(importMedia({
      sourcePath: imagePath, claimedMime: "image/png", allowedRoots: [input], storageDirectory: storage,
      signal: controller.signal
    })).rejects.toThrow(/cancelled/);
    expect((await readFile(imagePath)).byteLength).toBeGreaterThan(0);
  });

  it("uses imported media in preview decode and formal export", async () => {
    const image = await importMedia({
      sourcePath: imagePath, claimedMime: "image/png", allowedRoots: [input], storageDirectory: storage
    });
    const audio = await importMedia({
      sourcePath: audioPath, claimedMime: "audio/wav", allowedRoots: [input], storageDirectory: storage
    });
    const video = await importMedia({
      sourcePath: videoPath, claimedMime: "video/mp4", allowedRoots: [input], storageDirectory: storage
    });
    const producer = createMediaFrameProducer(image);
    const preview = await producer({ frame: 0, time: 0, deltaTime: 1 / 24, fps: 24, width: 32, height: 24 });
    expect(preview.byteLength).toBe(32 * 24 * 4);
    expect((await decodeAudioPreview(audio)).byteLength).toBeGreaterThan(0);
    const transform = {
      anchorPoint: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
      position: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
      scale: { mode: "constant", value: { x: 100, y: 100, z: 100 } },
      rotation: { mode: "constant", value: { x: 0, y: 0, z: 0 } }
    } as const;
    const videoProject = {
      schemaVersion: "1.2.0",
      engineVersion: "0.3.0",
      id: "project.video-raster",
      name: "video raster",
      width: 32,
      height: 24,
      fps: 24,
      duration: 0.3,
      background: { type: "transparent" },
      colorSpace: "srgb",
      seed: 7,
      assets: [video.asset],
      compositions: [{
        id: "main",
        name: "main",
        width: 32,
        height: 24,
        duration: 0.3,
        fps: 24,
        layers: [{
          id: "video",
          type: "video",
          name: "video",
          visible: true,
          locked: false,
          solo: false,
          startTime: 0,
          endTime: 0.3,
          inPoint: 0,
          outPoint: 0.3,
          zIndex: 0,
          transform,
          opacity: { mode: "constant", value: 1 },
          blendMode: "normal",
          masks: [],
          effects: [],
          source: { assetId: video.asset.id },
          properties: { loop: false, muted: true }
        }]
      }],
      fonts: [],
      audioTracks: [],
      renderPresets: [],
      metadata: { timeContractVersion: "1.1.0" }
    } as MotionProject;
    const videoProducer = createProjectFrameProducer(videoProject, new Map([[video.asset.id, video]]));
    const videoStart = await videoProducer({
      frame: 0, time: 0, deltaTime: 0, fps: 24, width: 32, height: 24
    });
    const videoLater = await videoProducer({
      frame: 4, time: 4 / 24, deltaTime: 1 / 24, fps: 24, width: 32, height: 24
    });
    expect(videoStart.byteLength).toBe(32 * 24 * 4);
    expect(videoLater.byteLength).toBe(32 * 24 * 4);
    expect(Array.from(videoLater).some((byte, index) => index % 4 === 3 && byte > 0)).toBe(true);
    const report = await exportFixedFrames({
      preset: testPreset("mp4", 24, 32, 24, false, true),
      duration: 0.1,
      outputPath: resolve(output, "imported-media.mp4"),
      renderFrame: producer,
      audioPath: audio.storedPath
    });
    expect(report.frameCount).toBe(3);
  }, 30_000);

  it("removes one explicit stored file", async () => {
    const cleanupStorage = resolve(root, "cleanup-storage");
    const imported = await importMedia({
      sourcePath: imagePath, claimedMime: "image/png", allowedRoots: [input], storageDirectory: cleanupStorage
    });
    await removeStoredMedia({ asset: imported.asset, storageDirectory: cleanupStorage });
    await expect(stat(imported.storedPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not trust a caller-supplied path during cleanup", async () => {
    const cleanupStorage = resolve(root, "cleanup-boundary");
    const imported = await importMedia({
      sourcePath: imagePath, claimedMime: "image/png", allowedRoots: [input], storageDirectory: cleanupStorage
    });
    const outside = resolve(root, "must-remain.txt");
    await writeFile(outside, "keep");
    const { hash: _hash, ...withoutHash } = imported.asset;
    await expect(removeStoredMedia({
      asset: { ...withoutHash, uri: "file:///outside" },
      storageDirectory: cleanupStorage
    })).rejects.toThrow(/address or hash/);
    expect(await readFile(outside, "utf8")).toBe("keep");
    expect((await stat(imported.storedPath)).isFile()).toBe(true);
  });

  it.each([
    [imagePath, "image/png"],
    [audioPath, "audio/wav"],
    [videoPath, "video/mp4"]
  ] as const)("re-verifies unchanged stored media %s", async (sourcePath, claimedMime) => {
    const verifyStorage = resolve(root, `verify-${claimedMime.replace("/", "-")}`);
    const imported = await importMedia({
      sourcePath, claimedMime, allowedRoots: [input], storageDirectory: verifyStorage
    });
    const verified = await verifyStoredMediaAsset({
      asset: imported.asset, storageDirectory: verifyStorage
    });
    expect(verified.storedPath).toBe(imported.storedPath);
    expect(verified.descriptor.cacheKey).toBe(imported.asset.hash?.slice("sha256:".length));
    expect(verified.trustedBytes).toBe((await stat(imported.storedPath)).size);
  });

  it("rejects an unchanged 11 MB image declared as 130 bytes without side effects", async () => {
    const exactBytes = 11_534_447;
    const largeImagePath = resolve(input, "declared-small.png");
    const source = await readFile(imagePath);
    const largeImage = Buffer.alloc(exactBytes);
    source.copy(largeImage);
    await writeFile(largeImagePath, largeImage);
    const verifyStorage = resolve(root, "verify-declared-small");
    const imported = await importMedia({
      sourcePath: largeImagePath,
      claimedMime: "image/png",
      allowedRoots: [input],
      storageDirectory: verifyStorage
    });
    expect((await stat(imported.storedPath)).size).toBe(exactBytes);
    const forged = structuredClone(imported.asset);
    forged.metadata.bytes = 130;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const absentOutput = resolve(root, `forged-bytes-output-${randomUUID()}`);
    const result = verifyStoredMediaAsset({ asset: forged, storageDirectory: verifyStorage });
    await expect(result).rejects.toThrow(/byte declaration/);
    await expect(result).rejects.not.toThrow(new RegExp(verifyStorage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(stat(absentOutput)).rejects.toMatchObject({ code: "ENOENT" });
    fetchSpy.mockRestore();
  }, 30_000);

  it("rejects every invalid byte declaration for image, audio, and video", async () => {
    const cases = [
      ["missing", undefined],
      ["string", "130"],
      ["nan", Number.NaN],
      ["negative", -1],
      ["fraction", 1.5],
      ["too-small", 0],
      ["too-large", Number.MAX_SAFE_INTEGER]
    ] as const;
    const fixtures = [
      [imagePath, "image/png"],
      [audioPath, "audio/wav"],
      [videoPath, "video/mp4"]
    ] as const;
    for (const [sourcePath, claimedMime] of fixtures) {
      const verifyStorage = resolve(root, `verify-byte-matrix-${claimedMime.replace("/", "-")}`);
      const imported = await importMedia({
        sourcePath, claimedMime, allowedRoots: [input], storageDirectory: verifyStorage
      });
      for (const [name, declaration] of cases) {
        const forged = structuredClone(imported.asset);
        if (declaration === undefined) delete forged.metadata.bytes;
        else forged.metadata.bytes = declaration;
        await expect(verifyStoredMediaAsset({
          asset: forged,
          storageDirectory: verifyStorage
        }), `${claimedMime} ${name}`).rejects.toThrow(/byte declaration/);
      }
    }
  }, 30_000);

  it("does not treat a valid URI and disk hash as a substitute for byte verification", async () => {
    const verifyStorage = resolve(root, "verify-hash-is-not-size");
    const imported = await importMedia({
      sourcePath: audioPath,
      claimedMime: "audio/wav",
      allowedRoots: [input],
      storageDirectory: verifyStorage
    });
    const forged = structuredClone(imported.asset);
    forged.metadata.bytes = (await stat(imported.storedPath)).size + 1;
    await expect(verifyStoredMediaAsset({
      asset: forged,
      storageDirectory: verifyStorage
    })).rejects.toThrow("Stored media byte declaration does not match the verified file size.");
  });

  it.each([
    ["tampered-image", imagePath, "image/png", Buffer.from("replacement")],
    ["truncated-audio", audioPath, "audio/wav", Buffer.alloc(1)],
    ["replaced-video", videoPath, "video/mp4", Buffer.from("different video")]
  ] as const)("rejects %s before use", async (name, sourcePath, claimedMime, replacement) => {
    const verifyStorage = resolve(root, name);
    const imported = await importMedia({
      sourcePath, claimedMime, allowedRoots: [input], storageDirectory: verifyStorage
    });
    await writeFile(imported.storedPath, replacement);
    await expect(verifyStoredMediaAsset({
      asset: imported.asset, storageDirectory: verifyStorage
    })).rejects.toThrow(/content hash/);
  });

  it("cancels stored media verification without exposing a path", async () => {
    const verifyStorage = resolve(root, "cancel-verification");
    const imported = await importMedia({
      sourcePath: videoPath, claimedMime: "video/mp4", allowedRoots: [input], storageDirectory: verifyStorage
    });
    const controller = new AbortController();
    controller.abort("private path");
    const result = verifyStoredMediaAsset({
      asset: imported.asset, storageDirectory: verifyStorage, signal: controller.signal
    });
    await expect(result).rejects.toThrow();
    await expect(result).rejects.not.toThrow(new RegExp(verifyStorage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  });

  it("interrupts an in-progress large-file hash with a sanitized error", async () => {
    const verifyStorage = resolve(root, "cancel-large-verification");
    await mkdir(verifyStorage, { recursive: true });
    const bytes = Buffer.alloc(32 * 1024 * 1024, 0x5a);
    const hash = createHash("sha256").update(bytes).digest("hex");
    await writeFile(resolve(verifyStorage, `${hash}.wav`), bytes);
    const controller = new AbortController();
    const result = verifyStoredMediaAsset({
      asset: {
        id: `asset_${hash.slice(0, 24)}`,
        type: "audio",
        uri: `media://${hash}.wav`,
        hash: `sha256:${hash}`,
        metadata: { duration: 1 }
      },
      storageDirectory: verifyStorage,
      signal: controller.signal
    });
    setTimeout(() => controller.abort("do not expose this reason"), 0);
    await expect(result).rejects.toThrow("Stored media verification was cancelled.");
  });
});
