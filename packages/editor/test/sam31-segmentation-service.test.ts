import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerifiedStoredMedia } from "@codemotion/exporter";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import { Sam31SegmentationService } from "../src/sam31-segmentation-service.js";

function maskPng(values: readonly number[], width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let index = 0; index < values.length; index += 1) {
    const offset = index * 4;
    png.data[offset] = values[index]!;
    png.data[offset + 1] = values[index]!;
    png.data[offset + 2] = values[index]!;
    png.data[offset + 3] = 255;
  }
  return PNG.sync.write(png);
}

async function sourceMedia(): Promise<VerifiedStoredMedia> {
  const directory = await mkdtemp(join(tmpdir(), "cmfx-sam31-"));
  const storedPath = join(directory, "source.png");
  await writeFile(storedPath, Buffer.from([137, 80, 78, 71]));
  return {
    asset: {
      id: "asset_sam31abcdefgh",
      type: "image",
      uri: "media://sam31-source.png",
      hash: "sha256:sam31-source",
      metadata: { mime: "image/png", width: 2, height: 1, codec: "png" }
    },
    descriptor: { id: "asset_sam31abcdefgh", type: "media/image", cacheKey: "sam31", metadata: {} },
    storedPath,
    arkEligibility: { filesApi: false, videoTos: false, base64OrUrl: true, reason: "test" },
    trustedBytes: 4
  };
}

describe("SAM3.1 segmentation service", () => {
  it("rejects public, authenticated, and non-HTTP endpoints", () => {
    for (const baseUrl of [
      "https://127.0.0.1:8001",
      "http://8.8.8.8:8001",
      "http://user:password@127.0.0.1:8001"
    ]) {
      expect(() => new Sam31SegmentationService({ baseUrl }), baseUrl)
        .toThrow(/private or loopback HTTP origin/u);
    }
  });

  it("sends the authorized image and English target, selects the best mask, and resizes it", async () => {
    const lowMask = maskPng([255, 255], 2, 1).toString("base64");
    const highMask = maskPng([0, 255], 2, 1).toString("base64");
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe("http://127.0.0.1:8001/v1/segment");
      expect(init?.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      const form = init?.body as FormData;
      expect(form).toBeInstanceOf(FormData);
      expect(form.get("prompt")).toBe("car license plate");
      expect(form.get("threshold")).toBe("0.65");
      expect(form.get("include_masks")).toBe("true");
      const image = form.get("image") as Blob;
      expect(image.type).toBe("image/png");
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(Uint8Array.from([137, 80, 78, 71]));
      return new Response(JSON.stringify({ detections: [
        { score: 0.4, bbox_xyxy: [0, 0, 2, 1], mask_png_base64: lowMask },
        { score: 0.93, bbox_xyxy: [1, 0, 2, 1], mask_png_base64: highMask }
      ] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const service = new Sam31SegmentationService({
      baseUrl: "http://127.0.0.1:8001",
      fetchImpl: fetchImpl as typeof fetch,
      threshold: 0.65
    });

    await expect(service.segment(await sourceMedia(), "car license plate", 4, 2)).resolves.toEqual({
      version: "sam31-mask-v1",
      width: 4,
      height: 2,
      data: Uint8Array.from([0, 0, 255, 255, 0, 0, 255, 255]),
      score: 0.93,
      bbox: [1, 0, 2, 1]
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not leak malformed remote response details", async () => {
    const service = new Sam31SegmentationService({
      baseUrl: "http://192.168.1.20:8001",
      fetchImpl: vi.fn(async () => new Response("not-json", { status: 200 })) as typeof fetch
    });

    await expect(service.segment(await sourceMedia(), "main subject", 2, 2))
      .rejects.toThrow("SAM3.1 could not segment the requested visible target.");
  });
});
