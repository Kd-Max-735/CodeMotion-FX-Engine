import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeMediaFrame,
  importMedia,
  MediaPreviewDecodeError,
  runProcess,
  type ImportedMedia,
  type ProcessResult,
  type FrameRequest
} from "../src/index.js";

const root = resolve("tmp/media-preview-regression");
const input = resolve(root, "input");
const portraitJpeg = resolve(input, "portrait-yuvj444p.jpg");
const png = resolve(input, "ordinary.png");
const jpeg = resolve(input, "ordinary.jpg");
const webp = resolve(input, "ordinary.webp");
const video = resolve(input, "seekable.mp4");
const svg = resolve(input, "fixture.svg");

beforeAll(async () => {
  await mkdir(input, { recursive: true });
  await runProcess("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1242x2208:rate=1",
    "-frames:v", "1", "-vf", "format=yuvj444p", "-q:v", "2", portraitJpeg
  ]);
  await runProcess("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=48x32:rate=1",
    "-frames:v", "1", png
  ]);
  await runProcess("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=48x32:rate=1",
    "-frames:v", "1", "-vf", "format=yuvj420p", "-q:v", "3", jpeg
  ]);
  await runProcess("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=48x32:rate=1",
    "-frames:v", "1", "-c:v", "libwebp", "-q:v", "80", webp
  ]);
  await runProcess("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10:duration=3",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", video
  ]);
  await writeFile(svg, [
    "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"32\" viewBox=\"0 0 64 32\">",
    "<rect width=\"64\" height=\"32\" fill=\"#204060\"/><circle cx=\"32\" cy=\"16\" r=\"10\" fill=\"#f0c040\"/>",
    "</svg>"
  ].join(""));
}, 60_000);

function request(time = 0): FrameRequest {
  return { frame: Math.round(time * 10), time, deltaTime: 0.1, fps: 10, width: 160, height: 90 };
}

async function imported(path: string, claimedMime: string, name: string): Promise<ImportedMedia> {
  return importMedia({
    sourcePath: path,
    claimedMime,
    allowedRoots: [input],
    storageDirectory: resolve(root, "storage", name)
  });
}

describe("media preview decode regression", () => {
  it("decodes a vertical yuvj444p JPEG to an exact 160x90 RGBA frame", async () => {
    const media = await imported(portraitJpeg, "image/jpeg", "portrait");
    expect(media.asset.metadata).toMatchObject({ width: 1242, height: 2208, codec: "mjpeg", decodeVerified: true });
    expect((await decodeMediaFrame(media, request())).byteLength).toBe(160 * 90 * 4);
  }, 60_000);

  it.each([
    [png, "image/png", "png"],
    [jpeg, "image/jpeg", "jpeg"],
    [webp, "image/webp", "webp"]
  ] as const)("decodes ordinary %s images", async (path, mime, name) => {
    const media = await imported(path, mime, name);
    expect((await decodeMediaFrame(media, request())).byteLength).toBe(160 * 90 * 4);
    expect(media.asset.metadata.decodeVerified).toBe(true);
  }, 60_000);

  it("decodes SVG through its verified raster proxy", async () => {
    const media = await imported(svg, "image/svg+xml", "svg");
    expect((await decodeMediaFrame(media, request())).byteLength).toBe(160 * 90 * 4);
    expect(media.asset.metadata.decodeVerified).toBe(true);
  }, 60_000);

  it("seeks video frames at start, middle, and near the end", async () => {
    const media = await imported(video, "video/mp4", "video");
    const frames = await Promise.all([0, 1.5, 2.9].map((time) => decodeMediaFrame(media, request(time))));
    expect(frames.every((frame) => frame.byteLength === 160 * 90 * 4)).toBe(true);
    expect(new Set(frames.map((frame) => createHash("sha256").update(frame).digest("hex"))).size).toBe(3);
  }, 60_000);

  it("does not put -ss before image input and fails clearly on empty stdout", async () => {
    const media = await imported(portraitJpeg, "image/jpeg", "empty-output");
    const calls: string[][] = [];
    const processRunner: typeof runProcess = async (_executable, args): Promise<ProcessResult> => {
      calls.push([...args]);
      return { stdout: Buffer.alloc(0), stderr: "" };
    };
    await expect(decodeMediaFrame(media, request(), { processRunner })).rejects.toMatchObject({
      code: "MEDIA_PREVIEW_DECODE_FAILED",
      reason: "empty_output",
      actualBytes: 0,
      expectedBytes: 160 * 90 * 4
    });
    expect(calls[0]).not.toContain("-ss");
    expect(calls[0]).toEqual(expect.arrayContaining(["-frames:v", "1", "-pix_fmt", "rgba"]));
  });

  it("keeps video seek after input", async () => {
    const media = await imported(video, "video/mp4", "seek-args");
    const calls: string[][] = [];
    const processRunner: typeof runProcess = async (_executable, args): Promise<ProcessResult> => {
      calls.push([...args]);
      return { stdout: Buffer.alloc(160 * 90 * 4), stderr: "" };
    };
    await decodeMediaFrame(media, request(1.5), { processRunner });
    expect(calls[0]!.indexOf("-i")).toBeLessThan(calls[0]!.indexOf("-ss"));
    expect(calls[0]).toContain("1.5");
  });

  it("preserves FFmpeg stderr as a server-side diagnostic", async () => {
    const media = await imported(portraitJpeg, "image/jpeg", "stderr");
    const processRunner: typeof runProcess = async (): Promise<ProcessResult> => ({
      stdout: Buffer.alloc(160 * 90 * 4), stderr: "decoder warning: test diagnostic"
    });
    await expect(decodeMediaFrame(media, request(), { processRunner })).rejects.toMatchObject({
      code: "MEDIA_PREVIEW_DECODE_FAILED",
      reason: "stderr",
      diagnostic: "decoder warning: test diagnostic"
    });
  });

  it("preserves a nonzero FFmpeg exit as a server-side process diagnostic", async () => {
    const media = await imported(portraitJpeg, "image/jpeg", "nonzero-exit");
    const processRunner: typeof runProcess = async () => {
      throw new Error("ffmpeg exited with code 69: corrupt input");
    };
    await expect(decodeMediaFrame(media, request(), { processRunner })).rejects.toMatchObject({
      code: "MEDIA_PREVIEW_DECODE_FAILED",
      reason: "process",
      diagnostic: "ffmpeg exited with code 69: corrupt input"
    });
  });

});
