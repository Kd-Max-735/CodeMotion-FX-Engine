import { readFileSync } from "node:fs";
import { describe, expect, it, vi, afterEach } from "vitest";
import { contractsSchema, validateContract } from "@codemotion/schema";
import { AI_CANVAS_RATIOS, aiPlanApi, buildAiPlanningInput } from "../src/ai-plan-client.js";
import { mediaAssetApi, sessionApi } from "../src/media-asset-client.js";
import {
  canvasLayerRect,
  createStarterProject,
  layerPropertySections,
  mainLayers,
  topLayerInCanvasRect
} from "../src/model.js";
import { EditorStore } from "../src/store.js";

const ASSET_ID = `asset_${"a".repeat(24)}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("S7R-F browser contracts", () => {
  it("posts the exact ai-task/v1 body with same-origin credentials and CSRF", async () => {
    vi.stubGlobal("document", { cookie: "cmfx_dev_csrf=csrf-value" });
    const fetchMock = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => json({ task: {
      id: "task-server",
      status: "running",
      phase: "accepted",
      events: [],
      createdAt: "2026-08-04T00:00:00.000Z",
      updatedAt: "2026-08-04T00:00:00.000Z",
      modalities: ["text", "image"]
    } }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const input = buildAiPlanningInput({
      prompt: "品牌片头",
      assets: [{ assetId: ASSET_ID, purpose: "logo" }],
      width: 1920,
      height: 1080,
      fps: 30,
      durationSeconds: 6,
      style: "极简, 纸张",
      colors: ["#ff5a3c"],
      tone: "专业, 克制",
      requiredText: "CodeMotion\nFX",
      forbiddenContent: "水印\n竞品"
    });

    await aiPlanApi.create(input);
    const [path, init] = fetchMock.mock.calls[0]!;
    if (!init) throw new Error("Expected request init.");
    expect(path).toBe("/api/ai-plans");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect((init.headers as Record<string, string>)["X-CMFX-CSRF"]).toBe("csrf-value");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      contract: "ai-task/v1",
      prompt: "品牌片头",
      assets: [{ assetId: ASSET_ID, purpose: "logo" }],
      canvas: { width: 1920, height: 1080, fps: 30 },
      durationSeconds: 6,
      style: ["极简", "纸张"],
      brand: {
        colors: ["#ff5a3c"],
        tone: ["专业", "克制"],
        requiredText: ["CodeMotion", "FX"],
        forbiddenContent: ["水印", "竞品"],
        logoAssetIds: [ASSET_ID]
      }
    });
    expect(JSON.stringify(body)).not.toMatch(/MotionProject|project|uri|path|hash|metadata|tenantId|userId|provider|taskId/i);
  });

  it("requires CSRF before create/cancel fetch and maps structured errors safely", async () => {
    vi.stubGlobal("document", { cookie: "" });
    const fetchMock = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => json({}));
    vi.stubGlobal("fetch", fetchMock);
    await expect(aiPlanApi.cancel("server-task")).rejects.toMatchObject({ code: "CSRF_MISSING" });
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal("document", { cookie: "__Host-cmfx_csrf=token" });
    fetchMock.mockResolvedValueOnce(json({ error: { code: "PRIVATE_DETAIL", message: "C:\\secret", retryable: false } }, 422));
    await expect(aiPlanApi.cancel("server-task")).rejects.toMatchObject({
      status: 422,
      message: "输入内容未通过安全校验。"
    });
  });

  it("uploads exactly file plus purpose and keeps only BrowserAssetSummaryV1 fields", async () => {
    vi.stubGlobal("document", { cookie: "cmfx_dev_csrf=csrf" });
    const responseAsset = {
      assetId: ASSET_ID,
      displayName: "logo.svg",
      kind: "svg",
      mime: "image/svg+xml",
      codec: "svg",
      bytes: 42,
      width: 120,
      height: 80,
      uploadedAt: "2026-07-31T08:00:00.000Z",
      allowedPurposes: ["reference-image", "logo"],
      hash: "forbidden",
      uri: "file:///forbidden",
      storedPath: "C:\\forbidden"
    };
    const fetchMock = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => path === "/api/media-assets"
      && init?.method === "POST" ? json({ asset: responseAsset }, 201) : json({ items: [responseAsset], nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" });
    const uploaded = await mediaAssetApi.upload(file, "logo");
    const [, uploadInit] = fetchMock.mock.calls[0]!;
    const form = uploadInit?.body as FormData;
    const keys: string[] = [];
    form.forEach((_value, key) => keys.push(key));
    expect(keys).toEqual(["file", "purpose"]);
    expect(form.get("file")).toBe(file);
    expect(form.get("purpose")).toBe("logo");
    expect(uploadInit).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect((uploadInit?.headers as Record<string, string>)["X-CMFX-CSRF"]).toBe("csrf");
    expect(uploaded).toEqual({
      assetId: ASSET_ID, displayName: "logo.svg", kind: "svg", mime: "image/svg+xml", codec: "svg",
      bytes: 42, width: 120, height: 80, uploadedAt: "2026-07-31T08:00:00.000Z",
      allowedPurposes: ["reference-image", "logo"]
    });
    expect(uploaded).not.toHaveProperty("hash");
    expect(uploaded).not.toHaveProperty("uri");
    expect(uploaded).not.toHaveProperty("storedPath");
  });

  it("reads each server session independently without browser persistence", async () => {
    const fetchMock = vi.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => json({}))
      .mockResolvedValueOnce(json({ authenticated: true, principal: { tenantId: "tenant-a", userId: "user-a", scopes: ["assets:read"], expiresAt: 100 } }))
      .mockResolvedValueOnce(json({ authenticated: true, principal: { tenantId: "tenant-b", userId: "user-b", scopes: ["ai:plan"], expiresAt: 200 } }));
    vi.stubGlobal("fetch", fetchMock);
    const first = await sessionApi.read();
    const second = await sessionApi.read();
    expect(first.principal).toMatchObject({ tenantId: "tenant-a", userId: "user-a" });
    expect(second.principal).toMatchObject({ tenantId: "tenant-b", userId: "user-b" });
    expect(fetchMock.mock.calls.every(([, init]) => init?.credentials === "same-origin")).toBe(true);
  });

  it("creates a local development session after an initial 401 without client-supplied identity", async () => {
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:4174" }, dispatchEvent: vi.fn() });
    const session = { authenticated: true, principal: {
      tenantId: "local-tenant", userId: "local-user",
      scopes: ["ai:plan", "assets:read", "assets:write", "project:preview", "export:create", "export:read"],
      expiresAt: 200
    } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ error: { code: "UNAUTHENTICATED", retryable: false } }, 401))
      .mockResolvedValueOnce(json({ authenticated: true }, 201))
      .mockResolvedValueOnce(json(session));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sessionApi.readWithDevelopmentFallback()).resolves.toEqual(session);
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      "/api/session", "/auth/dev/auto-session", "/api/session"
    ]);
    const autoInit = fetchMock.mock.calls[1]![1];
    expect(autoInit).toMatchObject({ method: "POST", credentials: "same-origin", body: "{}" });
    expect(JSON.parse(String(autoInit?.body))).toEqual({});
  });

  it("does not attempt development auto-session outside the fixed development origin", async () => {
    vi.stubGlobal("window", { location: { origin: "https://app.example.test" }, dispatchEvent: vi.fn() });
    const fetchMock = vi.fn().mockResolvedValue(json({ error: { code: "UNAUTHENTICATED", retryable: false } }, 401));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sessionApi.readWithDevelopmentFallback()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps every ratio to bounded integer dimensions", () => {
    for (const [width, height] of Object.values(AI_CANVAS_RATIOS)) {
      expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true);
      expect(width).toBeGreaterThanOrEqual(2);
      expect(height).toBeGreaterThanOrEqual(2);
      expect(width * height).toBeLessThanOrEqual(33_554_432);
    }
  });
});

describe("S7R-F editor interactions", () => {
  it("derives layer controls from the official contract and sees new schema fields", () => {
    const project = createStarterProject();
    const layer = mainLayers(project)[1]!;
    const fields = layerPropertySections(layer).flatMap((section) => section.fields);
    expect(fields.find((field) => field.path === "blendMode")?.options).toContain("overlay");
    expect(fields.some((field) => field.path === "transform.position" && field.component === "x")).toBe(true);

    const extended = structuredClone(contractsSchema) as Record<string, any>;
    extended.$defs.LayerCommon.properties.editorFutureField = { type: "number", minimum: 0 };
    const extendedFields = layerPropertySections(layer, extended).flatMap((section) => section.fields);
    expect(extendedFields.some((field) => field.path === "editorFutureField")).toBe(true);
  });

  it("frame-selects the top visible unlocked layer and handles geometry updates", () => {
    const project = createStarterProject();
    const accent = mainLayers(project).find((layer) => layer.id === "layer.accent")!;
    const rect = canvasLayerRect(project, accent, 0);
    expect(topLayerInCanvasRect(project, 0, rect)?.id).toBe("layer.title");

    const store = new EditorStore(undefined, project);
    store.updateLayerGeometry(accent.id, 120, 80, 160, 140);
    const updated = mainLayers(store.getSnapshot().document.project).find((layer) => layer.id === accent.id)!;
    const updatedRect = canvasLayerRect(store.getSnapshot().document.project, updated, 0);
    expect(updatedRect.width).toBeGreaterThan(rect.width);
    expect(validateContract("LayerDefinition", updated).valid).toBe(true);
    store.clearSelection();
    expect(store.getSnapshot().document.selectedLayerId).toBeNull();
  });

  it("mounts one server runtime only in configureServer and removes stale Effect Lab labels", () => {
    const vite = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
    expect(vite.match(/createServerRuntime\(/g)).toHaveLength(1);
    expect(vite).toContain("configureServer(server: ViteDevServer)");
    expect(vite).not.toContain("codemotion-export-api");
    expect(vite).not.toContain("codemotion-editor-preview-api");
    expect(vite).not.toContain("configurePreviewServer(server) { server.middlewares.use(runtime");
    expect(vite).not.toContain("createAiPlanApi");
    expect(vite).not.toContain("TenantMediaStore");

    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).not.toMatch(/未运行|待 Group 7|阶段 6/);
    expect(app).not.toContain("LAYER_PROPERTY_SCHEMA");
    expect(app).toContain("onPointerCancel");
    expect(app).toContain("aria-pressed");
  });
});
