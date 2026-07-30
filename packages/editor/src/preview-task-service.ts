import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { MotionProject, RenderQuality } from "@codemotion/core";
import { makeBrushCoverage } from "@codemotion/effects-2d";
import {
  createProjectFrameProducer,
  projectMediaReferences,
  verifyStoredMediaAsset,
  type ImportedMedia
} from "@codemotion/exporter";
import { loadProject } from "@codemotion/schema";
import type { CoverageBuffer } from "@codemotion/renderer-api";

const MAX_PREVIEW_REQUEST_BYTES = 24 * 1024 * 1024;

function jsonReplacer(_key: string, value: unknown): unknown {
  return ArrayBuffer.isView(value)
    ? Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
    : value;
}

export interface EditorPreviewRequest {
  readonly project: unknown;
  readonly time: number;
  readonly width: number;
  readonly height: number;
  readonly quality?: RenderQuality;
}

function positiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer within [1, ${maximum}].`);
  }
  return value;
}

function finiteTime(value: number, project: MotionProject): number {
  if (!Number.isFinite(value)) throw new TypeError("Preview time must be finite.");
  return Math.min(Math.max(0, value), Math.max(0, project.duration - 1 / project.fps));
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_PREVIEW_REQUEST_BYTES) throw new Error("Preview request exceeds the 24 MB limit.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function coverageAssets(project: MotionProject): Map<string, CoverageBuffer> {
  const result = new Map<string, CoverageBuffer>([["builtin://brush/round", makeBrushCoverage()]]);
  for (const asset of project.assets) {
    const candidate = asset.metadata.coverage;
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    const coverage = candidate as { width?: unknown; height?: unknown; data?: unknown; rowOrder?: unknown };
    if (!Number.isInteger(coverage.width) || !Number.isInteger(coverage.height)
      || typeof coverage.width !== "number" || typeof coverage.height !== "number"
      || !Array.isArray(coverage.data) || coverage.data.length !== coverage.width * coverage.height
      || coverage.rowOrder !== "top-to-bottom") continue;
    result.set(asset.id, {
      width: coverage.width,
      height: coverage.height,
      data: new Uint8Array(coverage.data as number[]),
      rowOrder: "top-to-bottom"
    });
  }
  return result;
}

async function verifiedMedia(project: MotionProject, mediaRoot: string): Promise<Map<string, ImportedMedia>> {
  const result = new Map<string, ImportedMedia>();
  const references = projectMediaReferences(project);
  for (const id of references.visualAssetIds) {
    const asset = project.assets.find((entry) => entry.id === id);
    if (asset === undefined || !/^media:\/\//.test(asset.uri)) continue;
    result.set(id, await verifyStoredMediaAsset({ asset, storageDirectory: mediaRoot }));
  }
  return result;
}

export class EditorPreviewService {
  constructor(private readonly mediaRoot = resolve(process.env.CMFX_MEDIA_STORAGE ?? "tmp/stage-6-media")) {}

  async render(request: EditorPreviewRequest): Promise<{
    readonly pixels: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly time: number;
    readonly quality: RenderQuality;
    readonly cpuMs: number;
  }> {
    const project = loadProject(JSON.stringify(request.project, jsonReplacer));
    const width = positiveInteger(request.width, "width", 960);
    const height = positiveInteger(request.height, "height", 960);
    if (width * height > 921_600) throw new RangeError("Preview pixel budget exceeds 921600 pixels.");
    const time = finiteTime(request.time, project);
    const quality = request.quality ?? "preview";
    if (quality !== "draft" && quality !== "preview" && quality !== "final") {
      throw new TypeError(`Unsupported preview quality ${String(quality)}.`);
    }
    const renderProject = structuredClone(project);
    renderProject.metadata = { ...renderProject.metadata, timeContractVersion: "1.1.0" };
    for (const composition of renderProject.compositions) {
      for (const layer of composition.layers) {
        for (const effect of layer.effects) effect.renderQuality = quality;
      }
    }
    const started = performance.now();
    const producer = createProjectFrameProducer(
      renderProject,
      await verifiedMedia(renderProject, this.mediaRoot),
      {
        timeContractVersion: "1.1.0",
        coverageAssets: coverageAssets(renderProject)
      }
    );
    const pixels = await producer({
      frame: Math.floor(time * project.fps + 1e-9),
      time,
      deltaTime: 1 / project.fps,
      fps: project.fps,
      width,
      height
    });
    return { pixels, width, height, time, quality, cpuMs: performance.now() - started };
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

export function createEditorPreviewApi(service = new EditorPreviewService()) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/editor-preview") return next();
    try {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Editor preview requires POST." });
        return;
      }
      const result = await service.render(await jsonBody(request) as EditorPreviewRequest);
      response.statusCode = 200;
      response.setHeader("content-type", "application/octet-stream");
      response.setHeader("content-length", String(result.pixels.byteLength));
      response.setHeader("x-cmfx-width", String(result.width));
      response.setHeader("x-cmfx-height", String(result.height));
      response.setHeader("x-cmfx-time", String(result.time));
      response.setHeader("x-cmfx-quality", result.quality);
      response.setHeader("x-cmfx-time-contract", "1.1.0");
      response.setHeader("x-cmfx-renderer", "g5-createProjectFrameProducer");
      response.setHeader("x-cmfx-cpu-ms", result.cpuMs.toFixed(3));
      response.end(Buffer.from(result.pixels));
    } catch (cause) {
      sendJson(response, 400, { error: cause instanceof Error ? cause.message : String(cause) });
    }
  };
}
