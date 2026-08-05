import { afterEach, describe, expect, it, vi } from "vitest";
import { APPLICATION_SCOPES, BROWSER_ASSET_URI, type BrowserProjectEnvelopeV1, type ExportTaskViewV1 } from "@codemotion/schema";
import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import { aiPlanApi } from "../src/ai-plan-client.js";
import { exportApi, type ExportSettings } from "../src/export-center.js";
import { hasApplicationScope, sessionApi, type BrowserSessionV1 } from "../src/media-asset-client.js";
import { ProjectPreviewRenderer } from "../src/preview-renderer.js";
import { AUTOSAVE_KEY, EditorStore, type StorageLike } from "../src/store.js";
import { createStarterProject } from "../src/model.js";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function completedResult(envelope: BrowserProjectEnvelopeV1) {
  return {
    contract: "ai-plan-result/v2",
    storyboard: {
      intent: "safe plan",
      duration: envelope.project.duration,
      width: envelope.project.width,
      height: envelope.project.height,
      fps: envelope.project.fps,
      style: [],
      brand: envelope.constraints.brand,
      requirements: [],
      constraints: [],
      shots: []
    },
    editableProject: envelope,
    issues: [],
    preview: { width: 160, height: 90, quality: "draft", frameCount: 1, timeContractVersion: "1.1.0" }
  } as const;
}

function taskWith(result: unknown) {
  return {
    id: "task_1", status: "completed", phase: "plan", events: [],
    createdAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:01.000Z",
    modalities: ["text"], result
  };
}

function audioEnvelope(): BrowserProjectEnvelopeV1 {
  const envelope = structuredClone(new EditorStore(undefined, createStarterProject("Audio project", 64, 36, 24)).getSnapshot().editableProject);
  const assetId = `asset_${"a".repeat(24)}`;
  envelope.project.assets = [{ id: assetId, type: "audio", uri: BROWSER_ASSET_URI, metadata: {} }];
  envelope.project.audioTracks = [{
    id: "audio.main", assetId, startTime: 0, endTime: envelope.project.duration,
    volume: { mode: "constant", value: 1 }
  }];
  const checked = P0_BROWSER_PROJECT_AUTHORITY_V1.validateBrowserProjectEnvelope(envelope);
  if (!checked.valid) throw new Error(checked.error.code);
  return checked.value;
}

function exportTask(settings: ExportSettings): ExportTaskViewV1 {
  return {
    contract: "export-task/v1", id: "export_1", projectName: "Audio project", format: settings.format,
    status: "completed", progress: 1, completedFrames: 3, frameCount: 3,
    createdAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:01.000Z",
    settings,
    video: { codec: "libx264", audioCodec: "aac", width: settings.width, height: settings.height, fps: settings.fps, duration: settings.duration },
    estimatedBytes: 20, outputBytes: 4, downloadName: "output.mp4", expiresAt: "2026-08-05T00:00:00.000Z"
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Stage 7R G0-5 browser contracts", () => {
  it("imports exactly six public scopes and gates each independently", () => {
    expect(APPLICATION_SCOPES).toEqual([
      "ai:plan", "assets:read", "assets:write", "project:preview", "export:create", "export:read"
    ]);
    for (const granted of APPLICATION_SCOPES) {
      const session: BrowserSessionV1 = {
        authenticated: true,
        principal: { tenantId: "tenant", userId: "user", scopes: [granted], expiresAt: 1 }
      };
      for (const tested of APPLICATION_SCOPES) expect(hasApplicationScope(session, tested)).toBe(tested === granted);
    }
  });

  it("accepts only ai-plan-result/v2 and adopts its complete envelope across refresh", async () => {
    const storage = new MemoryStorage();
    const source = new EditorStore(storage, createStarterProject("AI source"));
    const base = structuredClone(source.getSnapshot().editableProject);
    const envelope: BrowserProjectEnvelopeV1 = { ...base, constraints: { ...base.constraints, style: ["editorial"] } };
    const result = completedResult(envelope);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ configured: true, tasks: [taskWith(result)] }), {
      status: 200, headers: { "content-type": "application/json" }
    })));
    const completed = (await aiPlanApi.list()).tasks[0]!.result!;
    source.adoptEditableProject(completed.editableProject);
    vi.useFakeTimers();
    source.updateLayerGeometry("layer.accent", 2, 3, 101, 102);
    vi.advanceTimersByTime(500);
    const saved = JSON.parse(storage.getItem(AUTOSAVE_KEY)!) as { editableProject: BrowserProjectEnvelopeV1 };
    expect(saved.editableProject.constraints.style).toEqual(["editorial"]);
    const restarted = new EditorStore(storage, createStarterProject("Blank"));
    restarted.recover();
    expect(restarted.getSnapshot().editableProject).toEqual(saved.editableProject);
  });

  it("autosaves an adopted AI envelope without requiring a later edit", () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const store = new EditorStore(storage, createStarterProject("Before AI"));
    const base = store.getSnapshot().editableProject;
    const envelope: BrowserProjectEnvelopeV1 = {
      ...structuredClone(base),
      constraints: { ...structuredClone(base.constraints), style: ["persist-directly"] }
    };

    store.adoptEditableProject(envelope);
    vi.advanceTimersByTime(500);

    const restarted = new EditorStore(storage, createStarterProject("After reload"));
    restarted.recover();
    expect(restarted.getSnapshot().editableProject.constraints.style).toEqual(["persist-directly"]);
    expect(restarted.getSnapshot().editableProject.project.id).toBe(envelope.project.id);
  });

  it("rejects raw DSL, wrong contracts, and hostile extra result fields", async () => {
    const envelope = new EditorStore(undefined, createStarterProject()).getSnapshot().editableProject;
    const hostile = { ...completedResult(envelope), dsl: envelope.project };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true, tasks: [taskWith({ dsl: envelope.project })] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true, tasks: [taskWith({ ...completedResult(envelope), contract: "ai-plan-result/v1" })] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ configured: true, tasks: [taskWith(hostile)] })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiPlanApi.list()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(aiPlanApi.list()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(aiPlanApi.list()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("sends an exact authenticated preview request and aborts the superseded render", async () => {
    const envelope = new EditorStore(undefined, createStarterProject("Preview", 64, 36, 24)).getSnapshot().editableProject;
    vi.stubGlobal("document", { cookie: "cmfx_dev_csrf=csrf" });
    vi.stubGlobal("ImageData", class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} });
    const calls: RequestInit[] = [];
    const fetchMock = vi.fn((_path: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      if (calls.length === 1) return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
      const body = new Uint8Array(64 * 36 * 4);
      return Promise.resolve(new Response(body, { headers: {
        "content-type": "application/octet-stream", "content-length": String(body.length),
        "cache-control": "no-store", "x-content-type-options": "nosniff",
        "x-cmfx-width": "64", "x-cmfx-height": "36", "x-cmfx-time": "0",
        "x-cmfx-quality": "preview", "x-cmfx-time-contract": "1.1.0", "x-cmfx-renderer": "server"
      } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const canvas = { width: 0, height: 0, getContext: () => ({ putImageData: vi.fn() }) } as unknown as HTMLCanvasElement;
    const renderer = new ProjectPreviewRenderer();
    const first = renderer.render(envelope, 0, canvas);
    await Promise.resolve();
    const second = renderer.render(envelope, 0, canvas);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toMatchObject({ backend: "G5 Shared", width: 64, height: 36 });
    expect(calls[0]?.credentials).toBe("same-origin");
    expect((calls[0]?.headers as Record<string, string>)["X-CMFX-CSRF"]).toBe("csrf");
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      contract: "preview-request/v1", editableProject: envelope,
      frame: { time: 0, width: 64, height: 36, quality: "preview" }
    });
    renderer.dispose();
  });

  it("exports only the safe envelope and opaque audio ID, then downloads with authenticated fetch", async () => {
    const envelope = audioEnvelope();
    const settings: ExportSettings = { format: "mp4", width: 64, height: 36, fps: 24, duration: 0.1, alpha: false, audio: true };
    const current = exportTask(settings);
    vi.stubGlobal("document", { cookie: "cmfx_dev_csrf=csrf" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ task: current }), { status: 202 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4]), { headers: {
        "content-type": "video/mp4", "content-length": "4", "cache-control": "private, no-store", "x-content-type-options": "nosniff"
      } }));
    vi.stubGlobal("fetch", fetchMock);
    await exportApi.create(envelope, settings);
    const createInit = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(createInit.body));
    expect(body).toEqual({ contract: "export-request/v1", editableProject: envelope, settings });
    expect(body.editableProject.project.audioTracks[0]).toEqual(expect.objectContaining({ assetId: `asset_${"a".repeat(24)}` }));
    expect(JSON.stringify(body.editableProject.project.assets)).not.toMatch(/hash|mime|codec|path|owner/);
    expect(createInit.credentials).toBe("same-origin");
    expect((createInit.headers as Record<string, string>)["X-CMFX-CSRF"]).toBe("csrf");
    await expect(exportApi.download(current)).resolves.toMatchObject({ name: "output.mp4", blob: { size: 4 } });
    expect((fetchMock.mock.calls[1]![1] as RequestInit).credentials).toBe("same-origin");
  });

  it("does not read a download body after an authentication error and sessions never cache owners", async () => {
    const settings: ExportSettings = { format: "mp4", width: 64, height: 36, fps: 24, duration: 0.1, alpha: false, audio: true };
    const response = new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED" } }), { status: 401 });
    const blobSpy = vi.spyOn(response, "blob");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true, principal: { tenantId: "a", userId: "u", scopes: ["assets:read"], expiresAt: 1 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true, principal: { tenantId: "b", userId: "u", scopes: ["assets:read"], expiresAt: 1 } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(exportApi.download(exportTask(settings))).rejects.toMatchObject({ status: 401 });
    expect(blobSpy).not.toHaveBeenCalled();
    expect((await sessionApi.read()).principal.tenantId).toBe("a");
    expect((await sessionApi.read()).principal.tenantId).toBe("b");
  });
});
