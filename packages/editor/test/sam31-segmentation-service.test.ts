import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VerifiedStoredMedia } from "@codemotion/exporter";
import { PNG } from "pngjs";
import { describe, expect, it, vi } from "vitest";
import {
  Sam31SegmentationError,
  Sam31SegmentationService,
  createSam31SegmentationService
} from "../src/sam31-segmentation-service.js";

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

function readinessResponse(input: string | URL | Request): Response | undefined {
  const url = String(input);
  if (url.endsWith("/health/live")) {
    return new Response(JSON.stringify({ status: "ok", docker: true }), { status: 200 });
  }
  if (url.endsWith("/api/models")) {
    return new Response(JSON.stringify({
      models: [{ slug: "sam3", operations: ["segment"], configured: true }]
    }), { status: 200 });
  }
  return undefined;
}

describe("SAM3 segmentation service", () => {
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
    let request = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const readiness = readinessResponse(input);
      if (readiness !== undefined) return readiness;
      request += 1;
      if (request === 1) {
        expect(String(input)).toBe("http://192.168.1.31:9100/api/uploads");
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("error");
        const form = init?.body as FormData;
        expect(form).toBeInstanceOf(FormData);
        const image = form.get("file") as Blob;
        expect(image.type).toBe("image/png");
        expect(new Uint8Array(await image.arrayBuffer())).toEqual(Uint8Array.from([137, 80, 78, 71]));
        return new Response(JSON.stringify({ file_id: "upload_abcdefgh.png" }), { status: 200 });
      }
      if (request === 2) {
        expect(String(input)).toBe("http://192.168.1.31:9100/api/tasks");
        expect(init?.method).toBe("POST");
        expect(init?.headers).toEqual({ "content-type": "application/json" });
        expect(JSON.parse(String(init?.body))).toEqual({
          model: "sam3",
          operation: "segment",
          inputs: {
            file_id: "upload_abcdefgh.png",
            prompt: "car license plate",
            threshold: 0.65,
            include_masks: true
          }
        });
        return new Response(JSON.stringify({ task_id: "task_abcdefgh", status: "queued" }), { status: 200 });
      }
      expect(String(input)).toBe("http://192.168.1.31:9100/api/tasks/task_abcdefgh");
      if (request === 3) {
        return new Response(JSON.stringify({ id: "task_abcdefgh", status: "provisioning" }), { status: 200 });
      }
      return new Response(JSON.stringify({
        id: "task_abcdefgh",
        status: "succeeded",
        result: { detections: [
          { score: 0.4, bbox_xyxy: [0, 0, 2, 1], mask_png_base64: lowMask },
          { score: 0.93, bbox_xyxy: [1, 0, 2, 1], mask_png_base64: highMask }
        ] }
      }), { status: 200 });
    });
    const service = new Sam31SegmentationService({
      baseUrl: "http://192.168.1.31:9100",
      fetchImpl: fetchImpl as typeof fetch,
      threshold: 0.65,
      pollIntervalMs: 100
    });

    await expect(service.segment(await sourceMedia(), "car license plate", 4, 2)).resolves.toEqual({
      version: "sam31-mask-v1",
      width: 4,
      height: 2,
      data: Uint8Array.from([0, 0, 255, 255, 0, 0, 255, 255]),
      score: 0.93,
      bbox: [1, 0, 2, 1]
    });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("reports a failed health check as a gateway availability failure", async () => {
    const service = new Sam31SegmentationService({
      baseUrl: "http://192.168.1.20:9100",
      fetchImpl: vi.fn(async () => new Response("not-json", { status: 200 })) as typeof fetch
    });

    await expect(service.segment(await sourceMedia(), "main subject", 2, 2))
      .rejects.toMatchObject({
        name: "Sam31SegmentationError",
        code: "gateway_unavailable",
        message: "SAM3 gateway health check failed."
      } satisfies Partial<Sam31SegmentationError>);
  });

  it("requires a configured sam3 model with the segment operation", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/health/live")) {
        return new Response(JSON.stringify({ status: "ok", docker: true }), { status: 200 });
      }
      return new Response(JSON.stringify({
        models: [{ slug: "sam3", operations: ["segment"], configured: false }]
      }), { status: 200 });
    });
    const service = new Sam31SegmentationService({
      baseUrl: "http://192.168.1.31:9100",
      fetchImpl: fetchImpl as typeof fetch
    });

    await expect(service.segment(await sourceMedia(), "car", 2, 2))
      .rejects.toMatchObject({ code: "model_unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("separates invalid targets and missing detections from service availability failures", async () => {
    let request = 0;
    const service = new Sam31SegmentationService({
      baseUrl: "http://127.0.0.1:9100",
      fetchImpl: vi.fn(async (input) => {
        const readiness = readinessResponse(input);
        if (readiness !== undefined) return readiness;
        request += 1;
        if (request === 1) return new Response(JSON.stringify({ file_id: "upload_abcdefgh.png" }), { status: 200 });
        if (request === 2) return new Response(JSON.stringify({ task_id: "task_abcdefgh" }), { status: 200 });
        return new Response(JSON.stringify({
          id: "task_abcdefgh", status: "succeeded", result: { detections: [] }
        }), { status: 200 });
      }) as typeof fetch
    });

    await expect(service.segment(await sourceMedia(), "图片中的汽车", 2, 2))
      .rejects.toMatchObject({ code: "invalid_input" });
    await expect(service.segment(await sourceMedia(), "car", 2, 2))
      .rejects.toMatchObject({ code: "target_not_found" });
  });

  it("accepts the gateway's bbox-only detections when masks are omitted", async () => {
    let request = 0;
    const service = new Sam31SegmentationService({
      baseUrl: "http://127.0.0.1:9100",
      fetchImpl: vi.fn(async (input) => {
        const readiness = readinessResponse(input);
        if (readiness !== undefined) return readiness;
        request += 1;
        if (request === 1) return new Response(JSON.stringify({ file_id: "upload_abcdefgh.png" }), { status: 200 });
        if (request === 2) return new Response(JSON.stringify({ task_id: "task_abcdefgh" }), { status: 200 });
        return new Response(JSON.stringify({
          id: "task_abcdefgh",
          status: "succeeded",
          result: {
            width: 8,
            height: 4,
            count: 1,
            detections: [{ score: 0.91, bbox_xyxy: [2, 1, 6, 3] }]
          }
        }), { status: 200 });
      }) as typeof fetch
    });

    const result = await service.segment(await sourceMedia(), "car", 4, 2);
    expect(result.score).toBe(0.91);
    expect(Array.from(result.data)).toEqual([0, 255, 255, 0, 0, 255, 255, 0]);
  });

  it("downloads a same-gateway mask artifact when the task returns a mask URL", async () => {
    const mask = maskPng([0, 255], 2, 1);
    let request = 0;
    const service = new Sam31SegmentationService({
      baseUrl: "http://127.0.0.1:9100",
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const readiness = readinessResponse(input);
        if (readiness !== undefined) return readiness;
        request += 1;
        if (request === 1) return new Response(JSON.stringify({ file_id: "upload_abcdefgh.png" }), { status: 200 });
        if (request === 2) return new Response(JSON.stringify({ task_id: "task_abcdefgh" }), { status: 200 });
        if (request === 3) return new Response(JSON.stringify({
          id: "task_abcdefgh", status: "succeeded", result: {
            width: 2, height: 1,
            detections: [{ score: 0.95, bbox_xyxy: [0, 0, 2, 1], mask_download_url: "/api/artifacts/mask.png" }]
          }
        }), { status: 200 });
        expect(String(input)).toBe("http://127.0.0.1:9100/api/artifacts/mask.png");
        return new Response(mask, { status: 200, headers: { "content-type": "image/png" } });
      }) as typeof fetch
    });

    const result = await service.segment(await sourceMedia(), "car", 2, 1);
    expect(result.score).toBe(0.95);
    expect(Array.from(result.data)).toEqual([0, 255]);
  });

  it("configures the private SAM3 gateway without exposing it to model parameters", () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(() => createSam31SegmentationService({
      SAM3_API_BASE_URL: "http://192.168.1.31:9100",
      SAM3_THRESHOLD: "0.3",
      SAM3_TIMEOUT_MS: "600000",
      SAM3_READINESS_TIMEOUT_MS: "10000",
      SAM3_POLL_INTERVAL_MS: "1000"
    }, fetchImpl)).not.toThrow();
  });
});
