import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DOCUMENT_EXPORT_PRESETS,
  EXPORT_PRESET_CATALOG,
  AAC_PCM_BITS_PER_SAMPLE,
  AAC_PCM_CHANNELS,
  AAC_PCM_SAMPLE_RATE,
  AAC_WAV_HEADER_ALLOWANCE_BYTES,
  OwnedTaskStore,
  TenantMediaStore,
  boundedAacTranscodeArgs,
  decodeAudioPreview,
  decodeMediaFrame,
  estimateAacWavUpperBound,
  exportFixedFrames,
  importMedia,
  removeStoredMedia,
  runProcess,
  validateExportPreset,
  verifyStoredMediaAsset,
  type ExportPreset,
  type FrameRequest
} from "../src/index.js";

const root = resolve("tmp/stage-7r-group-5-test");
const input = resolve(root, "input");
const storage = resolve(root, "storage");
const output = resolve(root, "output");
const avifPath = resolve(input, "fixture.avif");
const aacPath = resolve(input, "fixture.aac");
const longAacPath = resolve(input, "long-fixture.aac");
const svgPath = resolve(input, "fixture.svg");
const audioPath = resolve(input, "preset-audio.wav");

beforeAll(async () => {
  await mkdir(input, { recursive: true });
  await mkdir(output, { recursive: true });
  await runProcess("ffmpeg", [
    "-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=0x2f81f7:s=32x24:d=0.1",
    "-frames:v", "1", "-c:v", "libaom-av1", "-still-picture", "1", avifPath
  ]);
  await runProcess("ffmpeg", [
    "-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=523:duration=0.3",
    "-c:a", "aac", "-f", "adts", aacPath
  ]);
  await runProcess("ffmpeg", [
    "-hide_banner", "-y", "-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono",
    "-t", "600", "-c:a", "aac", "-b:a", "8k", "-f", "adts", longAacPath
  ]);
  await runProcess("ffmpeg", [
    "-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=0.3",
    "-c:a", "pcm_s16le", audioPath
  ]);
  await writeFile(svgPath, [
    "<!-- removed -->",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"24\" viewBox=\"0 0 32 24\">",
    "<rect width=\"32\" height=\"24\" fill=\"#1565c0\"/>",
    "<circle cx=\"16\" cy=\"12\" r=\"7\" fill=\"#ffca28\"/>",
    "</svg>"
  ].join(""));
}, 60_000);

function request(width = 32, height = 24): FrameRequest {
  return { frame: 0, time: 0, deltaTime: 0, fps: 24, width, height };
}

describe("Stage 7R media ingress", () => {
  it("imports AVIF through signature, codec, decode, hash, and stored integrity checks", async () => {
    const imported = await importMedia({
      sourcePath: avifPath,
      claimedMime: "image/avif",
      allowedRoots: [input],
      storageDirectory: resolve(storage, "avif")
    });
    expect(imported.asset.type).toBe("image");
    expect(imported.asset.metadata.codec).toBe("av1");
    expect(imported.asset.id).toMatch(/^asset_[a-f0-9]{24}$/);
    expect((await decodeMediaFrame(imported, request())).byteLength).toBe(32 * 24 * 4);
    await expect(verifyStoredMediaAsset({
      asset: imported.asset,
      storageDirectory: resolve(storage, "avif")
    })).resolves.toMatchObject({ trustedBytes: (await stat(imported.storedPath)).size });
  }, 60_000);

  it("transcodes verified ADTS AAC to a content-addressed PCM WAV boundary", async () => {
    const imported = await importMedia({
      sourcePath: aacPath,
      claimedMime: "audio/aac",
      allowedRoots: [input],
      storageDirectory: resolve(storage, "aac")
    });
    expect(imported.asset.uri).toMatch(/\.wav$/);
    expect(imported.asset.metadata).toMatchObject({
      mime: "audio/wav",
      sourceMime: "audio/aac",
      sourceCodec: "aac",
      codec: "pcm_s16le",
      sampleRate: AAC_PCM_SAMPLE_RATE,
      channels: AAC_PCM_CHANNELS,
      bitsPerSample: AAC_PCM_BITS_PER_SAMPLE,
      transcoded: true,
      decodeVerified: true
    });
    expect((await decodeAudioPreview(imported)).byteLength).toBeGreaterThan(0);
  }, 60_000);

  it("rejects AAC whose bounded PCM output exceeds a custom limit before creating a WAV", async () => {
    const sourceBytes = (await stat(aacPath)).size;
    const audioBytes = Math.max(sourceBytes + 1, 32 * 1024);
    expect(estimateAacWavUpperBound(0.3)).toBeGreaterThan(audioBytes);
    const rejectedStorage = resolve(storage, `aac-preflight-${randomUUID()}`);
    await expect(importMedia({
      sourcePath: aacPath,
      claimedMime: "audio/aac",
      allowedRoots: [input],
      storageDirectory: rejectedStorage,
      limits: { audioBytes }
    })).rejects.toThrow("Predicted AAC PCM output exceeds the configured audio limit.");
    await expect(stat(rejectedStorage)).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);

  it.each([
    ["missing", undefined],
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY]
  ])("rejects %s AAC duration before budget calculation", (_name, duration) => {
    expect(() => estimateAacWavUpperBound(duration as number)).toThrow(
      "AAC duration must be a finite positive number."
    );
  });

  it("rejects an AAC duration too large for a reliable numeric bound", () => {
    expect(() => estimateAacWavUpperBound(Number.MAX_VALUE)).toThrow(
      "AAC duration is too large for a reliable PCM output bound."
    );
  });

  it("binds FFmpeg to the validated duration and byte ceiling using the named PCM constants", () => {
    const duration = 0.3;
    const audioBytes = estimateAacWavUpperBound(duration);
    const args = boundedAacTranscodeArgs("input.aac", "output.wav", duration, audioBytes);
    expect(args).toContain("-xerror");
    expect(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2)).toEqual(["-t", String(duration)]);
    expect(args.slice(args.indexOf("-fs"), args.indexOf("-fs") + 2)).toEqual(["-fs", String(audioBytes)]);
    expect(args.slice(args.indexOf("-ar"), args.indexOf("-ar") + 2))
      .toEqual(["-ar", String(AAC_PCM_SAMPLE_RATE)]);
    expect(args.slice(args.indexOf("-ac"), args.indexOf("-ac") + 2))
      .toEqual(["-ac", String(AAC_PCM_CHANNELS)]);
    expect(estimateAacWavUpperBound(1)).toBe(
      AAC_WAV_HEADER_ALLOWANCE_BYTES
      + AAC_PCM_SAMPLE_RATE * AAC_PCM_CHANNELS * (AAC_PCM_BITS_PER_SAMPLE / 8)
    );
  });

  it("cleans an observed partial WAV when bounded AAC transcoding is cancelled", async () => {
    const failedStorage = resolve(storage, `aac-cancel-${randomUUID()}`);
    const controller = new AbortController();
    const importing = importMedia({
      sourcePath: longAacPath,
      claimedMime: "audio/aac",
      allowedRoots: [input],
      storageDirectory: failedStorage,
      signal: controller.signal
    });
    let observedTemp = false;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const names = await readdir(failedStorage).catch(() => [] as string[]);
      if (names.some((name) => /^\.aac-.*\.wav$/.test(name))) {
        observedTemp = true;
        controller.abort(new Error("cancel bounded AAC transcode"));
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 2));
    }
    expect(observedTemp).toBe(true);
    await expect(importing).rejects.toThrow("cancel bounded AAC transcode");
    expect(await readdir(failedStorage)).toEqual([]);
  }, 60_000);

  it("sanitizes SVG and uses a verified deterministic PNG raster proxy", async () => {
    const imported = await importMedia({
      sourcePath: svgPath,
      claimedMime: "image/svg+xml",
      allowedRoots: [input],
      storageDirectory: resolve(storage, "svg")
    });
    expect(imported.asset.type).toBe("svg");
    expect(imported.rasterProxyPath).toMatch(/\.png$/);
    const sanitized = await readFile(imported.storedPath, "utf8");
    expect(sanitized).not.toContain("<!--");
    expect(imported.asset.metadata).toMatchObject({ sanitized: true, decodeVerified: true });
    const verified = await verifyStoredMediaAsset({
      asset: imported.asset,
      storageDirectory: resolve(storage, "svg")
    });
    expect(verified.rasterProxyPath).toBe(imported.rasterProxyPath);
    expect((await decodeMediaFrame(verified, request())).byteLength).toBe(32 * 24 * 4);
    const duplicate = await importMedia({
      sourcePath: svgPath,
      claimedMime: "image/svg+xml",
      allowedRoots: [input],
      storageDirectory: resolve(storage, "svg")
    });
    expect(duplicate.asset.id).toBe(imported.asset.id);
    expect(duplicate.asset.metadata.rasterProxyHash).toBe(imported.asset.metadata.rasterProxyHash);
    expect(duplicate.rasterProxyPath).toBe(imported.rasterProxyPath);
    const proxyProbe = JSON.parse((await runProcess("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,codec_name",
      "-of", "json", imported.rasterProxyPath!
    ])).stdout.toString("utf8")) as { streams: Array<{ width: number; height: number; codec_name: string }> };
    expect(proxyProbe.streams[0]).toEqual({ width: 32, height: 24, codec_name: "png" });
  }, 60_000);

  it("deletes a verified SVG primary and raster proxy together", async () => {
    const deleteStorage = resolve(storage, `svg-delete-${randomUUID()}`);
    const imported = await importMedia({
      sourcePath: svgPath,
      claimedMime: "image/svg+xml",
      allowedRoots: [input],
      storageDirectory: deleteStorage
    });
    await removeStoredMedia({ asset: imported.asset, storageDirectory: deleteStorage });
    await expect(stat(imported.storedPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(imported.rasterProxyPath!)).rejects.toMatchObject({ code: "ENOENT" });
  }, 60_000);

  it("does not delete SVG files when proxy metadata is invalid", async () => {
    const deleteStorage = resolve(storage, `svg-invalid-proxy-${randomUUID()}`);
    const imported = await importMedia({
      sourcePath: svgPath,
      claimedMime: "image/svg+xml",
      allowedRoots: [input],
      storageDirectory: deleteStorage
    });
    const forged = structuredClone(imported.asset);
    forged.metadata.rasterProxyUri = "file:///outside.png";
    await expect(removeStoredMedia({ asset: forged, storageDirectory: deleteStorage })).rejects.toThrow(
      "Stored SVG raster proxy metadata is invalid."
    );
    expect((await stat(imported.storedPath)).isFile()).toBe(true);
    expect((await stat(imported.rasterProxyPath!)).isFile()).toBe(true);
  }, 60_000);

  it("does not delete the SVG primary when its proxy is missing or fails integrity", async () => {
    const missingStorage = resolve(storage, `svg-missing-proxy-${randomUUID()}`);
    const missing = await importMedia({
      sourcePath: svgPath,
      claimedMime: "image/svg+xml",
      allowedRoots: [input],
      storageDirectory: missingStorage
    });
    await unlink(missing.rasterProxyPath!);
    await expect(removeStoredMedia({ asset: missing.asset, storageDirectory: missingStorage })).rejects.toThrow(
      "Stored SVG raster proxy is missing or failed integrity verification."
    );
    expect((await stat(missing.storedPath)).isFile()).toBe(true);

    const tamperedStorage = resolve(storage, `svg-tampered-proxy-${randomUUID()}`);
    const tampered = await importMedia({
      sourcePath: svgPath,
      claimedMime: "image/svg+xml",
      allowedRoots: [input],
      storageDirectory: tamperedStorage
    });
    await writeFile(tampered.rasterProxyPath!, "tampered");
    await expect(removeStoredMedia({ asset: tampered.asset, storageDirectory: tamperedStorage })).rejects.toThrow(
      "Stored SVG raster proxy is missing or failed integrity verification."
    );
    expect((await stat(tampered.storedPath)).isFile()).toBe(true);
    expect((await stat(tampered.rasterProxyPath!)).isFile()).toBe(true);
  }, 60_000);

  it.each([
    ["script", "<svg width=\"10\" height=\"10\"><script>alert(1)</script></svg>"],
    ["event", "<svg width=\"10\" height=\"10\" onload=\"alert(1)\"><rect width=\"1\" height=\"1\"/></svg>"],
    ["external", "<svg width=\"10\" height=\"10\"><path fill=\"url(https://evil.invalid/x)\" d=\"M0 0\"/></svg>"],
    ["entity", "<!DOCTYPE svg [<!ENTITY x SYSTEM \"file:///etc/passwd\">]><svg width=\"10\" height=\"10\"/>"]
  ])("rejects malicious SVG %s before storage", async (name, markup) => {
    const sourcePath = resolve(input, `malicious-${name}.svg`);
    const targetStorage = resolve(storage, `malicious-${name}-${randomUUID()}`);
    await writeFile(sourcePath, markup);
    await expect(importMedia({
      sourcePath,
      claimedMime: "image/svg+xml",
      allowedRoots: [input],
      storageDirectory: targetStorage
    })).rejects.toThrow(/SVG/);
    await expect(stat(targetStorage)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects format masquerading and size overflow", async () => {
    const disguisedPng = resolve(input, "disguised.png");
    const disguisedMp3 = resolve(input, "disguised.mp3");
    const disguisedMp4 = resolve(input, "disguised.mp4");
    await writeFile(disguisedPng, await readFile(avifPath));
    await writeFile(disguisedMp3, await readFile(aacPath));
    await writeFile(disguisedMp4, await readFile(avifPath));
    await expect(importMedia({
      sourcePath: disguisedPng,
      claimedMime: "image/png",
      allowedRoots: [input],
      storageDirectory: resolve(storage, "disguised-png")
    })).rejects.toThrow(/signature/);
    await expect(importMedia({
      sourcePath: disguisedMp3,
      claimedMime: "audio/mpeg",
      allowedRoots: [input],
      storageDirectory: resolve(storage, "disguised-mp3")
    })).rejects.toThrow(/codec/);
    await expect(importMedia({
      sourcePath: disguisedMp4,
      claimedMime: "video/mp4",
      allowedRoots: [input],
      storageDirectory: resolve(storage, "disguised-mp4")
    })).rejects.toThrow(/brand/);
    await expect(importMedia({
      sourcePath: svgPath,
      claimedMime: "image/svg+xml",
      allowedRoots: [input],
      storageDirectory: resolve(storage, "oversize"),
      limits: { imageBytes: 4 }
    })).rejects.toThrow(/size/);
  }, 60_000);

  it("cleans every temporary file when SVG proxy generation fails", async () => {
    const failedStorage = resolve(storage, `failed-svg-${randomUUID()}`);
    await expect(importMedia({
      sourcePath: svgPath,
      claimedMime: "image/svg+xml",
      allowedRoots: [input],
      storageDirectory: failedStorage,
      svgRasterizerPath: resolve(root, "missing-rasterizer.exe")
    })).rejects.toThrow("SVG raster proxy generation failed.");
    expect(await readdir(failedStorage)).toEqual([]);
  });

  it("deduplicates identical content and keeps a stable localAssetId", async () => {
    const duplicateStorage = resolve(storage, "duplicate");
    const first = await importMedia({
      sourcePath: avifPath,
      claimedMime: "image/avif",
      allowedRoots: [input],
      storageDirectory: duplicateStorage
    });
    const second = await importMedia({
      sourcePath: avifPath,
      claimedMime: "image/avif",
      allowedRoots: [input],
      storageDirectory: duplicateStorage
    });
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.asset.hash).toBe(first.asset.hash);
    expect(second.storedPath).toBe(first.storedPath);
  }, 60_000);

  it("denies cross-tenant asset access before resolving storage", async () => {
    const store = new TenantMediaStore({
      storageRoot: resolve(storage, "tenants"),
      allowedRoots: [input]
    });
    const tenantA = { tenantId: "tenant-a", userId: "owner" };
    const tenantB = { tenantId: "tenant-b", userId: "owner" };
    const importedA = await store.import(tenantA, {
      sourcePath: avifPath,
      claimedMime: "image/avif"
    });
    await expect(store.resolve(tenantB, importedA.asset.id)).rejects.toThrow("access denied");
    expect(store.list(tenantB)).toEqual([]);
    const importedB = await store.import(tenantB, {
      sourcePath: avifPath,
      claimedMime: "image/avif"
    });
    expect(importedB.asset.id).toBe(importedA.asset.id);
    await expect(store.resolve(tenantB, importedB.asset.id)).resolves.toMatchObject({
      asset: { id: importedA.asset.id }
    });
  }, 60_000);
});

describe("owner-scoped task storage", () => {
  it("keys by tenant, owner, and task while rejecting unauthorized lookup", () => {
    const store = new OwnedTaskStore<{ result: string }>();
    const ownerA = { tenantId: "tenant-a", userId: "user-a" };
    const ownerB = { tenantId: "tenant-b", userId: "user-a" };
    const peer = { tenantId: "tenant-a", userId: "user-b" };
    store.put(ownerA, "task-shared", { result: "a" });
    store.put(ownerB, "task-shared", { result: "b" });
    expect(store.get(ownerA, "task-shared").value.result).toBe("a");
    expect(store.get(ownerB, "task-shared").value.result).toBe("b");
    expect(() => store.get(peer, "task-shared")).toThrow("access denied");
    expect(store.list(ownerA).map((task) => task.taskId)).toEqual(["task-shared"]);
    expect(store.list(peer)).toEqual([]);
  });
});

function renderPresetFrame(requestValue: FrameRequest): Uint8Array {
  const frame = new Uint8Array(requestValue.width * requestValue.height * 4);
  frame.fill(requestValue.frame === 0 ? 48 : 176);
  for (let offset = 3; offset < frame.length; offset += 4) {
    frame[offset] = offset < frame.length / 2 ? 96 : 255;
  }
  return frame;
}

function outputTarget(preset: ExportPreset): string {
  const name = `${preset.id}-${randomUUID()}`;
  return resolve(output, preset.format === "png-sequence" ? name : `${name}.${preset.format}`);
}

describe("eleven export preset decisions", () => {
  it("records exactly ten runnable presets and one Stage 9/10 4K deferral", () => {
    expect(EXPORT_PRESET_CATALOG).toHaveLength(11);
    expect(DOCUMENT_EXPORT_PRESETS).toHaveLength(10);
    expect(EXPORT_PRESET_CATALOG.filter((entry) => entry.state === "runnable")).toHaveLength(10);
    expect(EXPORT_PRESET_CATALOG.find((entry) => entry.requirementId === "4k-landscape")).toMatchObject({
      state: "deferred",
      ownerStage: "Stage 9 segmented render; Stage 10 stability/compatibility"
    });
    expect(DOCUMENT_EXPORT_PRESETS.some((preset) =>
      preset.settings.width === 3840 && preset.settings.height === 2160)).toBe(false);
    for (const entry of EXPORT_PRESET_CATALOG.filter((item) => item.state === "runnable")) {
      expect(DOCUMENT_EXPORT_PRESETS.some((preset) => preset.id === entry.presetId)).toBe(true);
    }
  });

  it("matches every runnable preset's frozen dimensions, rate, codecs, alpha, and audio", () => {
    const values = Object.fromEntries(DOCUMENT_EXPORT_PRESETS.map((preset) => [preset.id, preset.settings]));
    expect(values).toMatchObject({
      "document-mp4": { width: 1920, height: 1080, fps: 30, videoCodec: "libx264", audioCodec: "aac", alpha: false, audio: true },
      "document-mp4-portrait": { width: 1080, height: 1920, fps: 30, videoCodec: "libx264", audioCodec: "aac", alpha: false, audio: true },
      "document-webm-alpha": { width: 1920, height: 1080, fps: 30, videoCodec: "libvpx-vp9", audioCodec: "libopus", alpha: true, audio: true },
      "document-gif": { width: 1280, height: 720, fps: 30, alpha: false, audio: false },
      "document-gif-small": { width: 640, height: 360, fps: 15, alpha: false, audio: false },
      "document-png-alpha": { width: 1920, height: 1080, fps: 30, alpha: true, audio: false },
      "social-portrait-mp4": { width: 1080, height: 1920, fps: 30, videoCodec: "libx264", audioCodec: "aac", alpha: false, audio: true },
      "commerce-product-gif": { width: 800, height: 800, fps: 20, alpha: false, audio: false },
      "ppt-gif": { width: 1280, height: 720, fps: 15, alpha: false, audio: false },
      "web-background-webm": { width: 1920, height: 1080, fps: 30, videoCodec: "libvpx-vp9", alpha: false, audio: false }
    });
    DOCUMENT_EXPORT_PRESETS.forEach((preset) => expect(validateExportPreset(preset)).toBe(preset));
  });

  it("really exports and probes every runnable preset with distinct decoded frames", async () => {
    const sizes = new Map<string, number>();
    for (const preset of DOCUMENT_EXPORT_PRESETS) {
      const target = outputTarget(preset);
      const report = await exportFixedFrames({
        preset,
        duration: 2 / preset.settings.fps,
        outputPath: target,
        renderFrame: renderPresetFrame,
        ...(preset.settings.audio ? { audioPath } : {})
      });
      expect(report.frameCount, preset.id).toBe(2);
      expect(new Set(report.inspections.map((inspection) => inspection.sha256)).size, preset.id).toBe(2);
      const probeTarget = preset.format === "png-sequence" ? resolve(target, "frame-00000000.png") : target;
      const probe = JSON.parse((await runProcess("ffprobe", [
        "-v", "error", "-show_streams", "-of", "json", probeTarget
      ])).stdout.toString("utf8")) as {
        streams: Array<{
          codec_type: string;
          codec_name: string;
          width?: number;
          height?: number;
          avg_frame_rate?: string;
          tags?: { alpha_mode?: string };
        }>;
      };
      const video = probe.streams.find((stream) => stream.codec_type === "video");
      expect(video, preset.id).toMatchObject({
        width: preset.settings.width,
        height: preset.settings.height,
        codec_name: preset.format === "mp4" ? "h264"
          : preset.format === "webm" ? "vp9"
            : preset.format === "gif" ? "gif" : "png"
      });
      const audio = probe.streams.find((stream) => stream.codec_type === "audio");
      expect(audio?.codec_name, preset.id).toBe(preset.settings.audio
        ? preset.format === "mp4" ? "aac" : "opus"
        : undefined);
      if (preset.format === "mp4" || preset.format === "webm") {
        const [numerator, denominator] = (video?.avg_frame_rate ?? "0/1").split("/").map(Number);
        expect(numerator! / denominator!, preset.id).toBe(preset.settings.fps);
      }
      if (preset.format === "webm") {
        expect(video?.tags?.alpha_mode, preset.id).toBe(preset.settings.alpha ? "1" : undefined);
      }

      if (preset.format === "png-sequence") {
        const first = await readFile(resolve(target, "frame-00000000.png"));
        const second = await readFile(resolve(target, "frame-00000001.png"));
        expect(createHash("sha256").update(first).digest("hex"))
          .not.toBe(createHash("sha256").update(second).digest("hex"));
      } else {
        const decoded = (await runProcess("ffmpeg", [
          "-v", "error", ...(preset.format === "webm" && preset.settings.alpha ? ["-c:v", "libvpx-vp9"] : []),
          "-i", target, "-frames:v", "2", "-fps_mode", "passthrough",
          "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"
        ])).stdout;
        const frameBytes = preset.settings.width * preset.settings.height * 4;
        expect(decoded.byteLength, preset.id).toBe(frameBytes * 2);
        expect(createHash("sha256").update(decoded.subarray(0, frameBytes)).digest("hex"))
          .not.toBe(createHash("sha256").update(decoded.subarray(frameBytes)).digest("hex"));
      }
      sizes.set(preset.id, preset.format === "png-sequence"
        ? (await stat(resolve(target, "frame-00000000.png"))).size + (await stat(resolve(target, "frame-00000001.png"))).size
        : (await stat(target)).size);
    }
    expect(sizes.get("document-gif-small")!).toBeLessThan(sizes.get("document-gif")!);
  }, 300_000);
});
