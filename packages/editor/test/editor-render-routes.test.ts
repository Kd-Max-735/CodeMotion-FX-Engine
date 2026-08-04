import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import type { LayerDefinition } from "@codemotion/core";
import { TenantMediaStore, runProcess, type ImportedMedia } from "@codemotion/exporter";
import type { AuthenticatedSessionPrincipal, AuthSessionService } from "../src/auth-session-service.js";
import { createStarterProject } from "../src/model.js";
import { createEditorPreviewApi, EditorPreviewService } from "../src/preview-task-service.js";
import type { OwnerMediaResolverV1 } from "../src/project-materialization.js";

const principal: AuthenticatedSessionPrincipal = {
  tenantId: "tenant-route", userId: "user-route", scopes: ["project:preview"],
  issuer: "urn:test", audience: "test", issuedAt: 1, expiresAt: 2_000_000_000,
  sessionId: "route-session-id-012345678901234567890123456789", authSource: "local-dev-session"
};

function envelope(kind: "text" | "shape" | "svg" = "text") {
  const project = createStarterProject(`Route ${kind}`, 64, 36, 24);
  const source = project.compositions[0]!.layers[kind === "text" ? 2 : 0]!;
  const layer = {
    ...source,
    type: kind,
    id: `layer.${kind}`,
    name: `Formal ${kind}`,
    transform: {
      ...source.transform,
      position: { mode: "constant", value: { x: 0, y: 0, z: 0 } }
    },
    opacity: { mode: "constant", value: 1 },
    effects: [], masks: [],
    properties: kind === "text"
      ? { text: "CodeMotion", fontFamily: "Codemotion Planner Unicode Bitmap", fontSize: 12, color: "#20C997FF" }
      : kind === "shape"
        ? { shapes: [{ path: "M0 0 L64 0 L64 36 L0 36 Z", fill: "#20C997FF" }], fill: "#20C997FF" }
        : { svg: "M0 0 L1 0 L1 1 L0 1 Z", fill: "#20C997FF" }
  } as unknown as LayerDefinition;
  project.compositions[0]!.layers = [layer];
  project.compositions[0]!.markers = [];
  project.assets = [];
  project.audioTracks = [];
  project.fonts = kind === "text" ? [{
    id: "font.codemotion.unicode-bitmap-v1", family: "Codemotion Planner Unicode Bitmap"
  }] : [];
  const safe = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: [], brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!safe.valid) throw new Error(safe.error.code);
  return safe.value;
}

function requestBody(kind: "text" | "shape" | "svg" = "text"): string {
  return JSON.stringify({
    contract: "preview-request/v1",
    editableProject: envelope(kind),
    frame: { time: 0.25, width: 64, height: 36, quality: "preview" }
  });
}

function assetEnvelope() {
  const project = createStarterProject("Route disconnect", 64, 36, 24);
  const hash = "a".repeat(64);
  const asset = {
    id: "asset_route_opaque", type: "image" as const,
    uri: `media://${hash}.png`, hash: `sha256:${hash}`,
    metadata: { mime: "image/png", codec: "png", bytes: 4, width: 1, height: 1, decodeVerified: true }
  };
  project.assets = [asset];
  const template = project.compositions[0]!.layers[0]!;
  project.compositions[0]!.layers = [{
    ...template, id: "layer.route.image", name: "Route image", type: "image",
    source: { assetId: asset.id }, properties: { fit: "contain" }, effects: [], masks: []
  }];
  project.compositions[0]!.markers = [];
  project.audioTracks = [];
  project.fonts = [];
  const safe = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: [], brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!safe.valid) throw new Error(safe.error.code);
  return safe.value;
}

function ownerAssetEnvelope(media: ImportedMedia) {
  const project = createStarterProject(`Owner ${media.asset.type}`, 64, 36, 24);
  const template = project.compositions[0]!.layers[0]!;
  project.compositions[0]!.layers = [{
    ...template,
    id: `layer.owner.${media.asset.type}`,
    name: `Owner ${media.asset.type}`,
    type: media.asset.type === "video" ? "video" : "image",
    source: { assetId: media.asset.id },
    properties: media.asset.type === "video" ? { loop: false, muted: true } : { fit: "fill" },
    effects: [], masks: []
  } as unknown as LayerDefinition];
  project.compositions[0]!.markers = [];
  project.assets = [media.asset];
  project.audioTracks = [];
  project.fonts = [];
  const safe = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: [], brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!safe.valid) throw new Error(safe.error.code);
  return safe.value;
}

async function invoke(
  service: EditorPreviewService,
  authorize: Pick<AuthSessionService, "authorize">["authorize"],
  body: string | Buffer
): Promise<{ response: Response; bytes: Uint8Array; bodyReads: number }> {
  let bodyReads = 0;
  const handler = createEditorPreviewApi(service, { authorize });
  const server = createServer((request, response) => {
    const iterator = request[Symbol.asyncIterator].bind(request);
    Object.defineProperty(request, Symbol.asyncIterator, {
      configurable: true,
      value: () => { bodyReads += 1; return iterator(); }
    });
    void handler(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/editor-preview`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : new Uint8Array(body)
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { response, bytes, bodyReads };
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}

describe("editor preview HTTP route", () => {
  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [403, "REQUEST_ORIGIN_REJECTED"]
  ] as const)("rejects %s/%s before body read or resolver work", async (status, code) => {
    const resolve = vi.fn(async (): Promise<never> => { throw new Error("unexpected resolver"); });
    const result = await invoke(new EditorPreviewService({ resolve }), async () => { throw { status, code }; }, requestBody());
    expect(result.response.status).toBe(status);
    expect(JSON.parse(Buffer.from(result.bytes).toString("utf8"))).toMatchObject({ error: { code } });
    expect(result.bodyReads).toBe(0);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("enforces body and contract errors without resolver or internal leakage", async () => {
    const resolve = vi.fn(async (): Promise<never> => { throw new Error("secret D:/media hash owner"); });
    const authorize = vi.fn(async () => principal);
    const malformed = await invoke(new EditorPreviewService({ resolve }), authorize, "{");
    expect(malformed.response.status).toBe(400);
    expect(JSON.parse(Buffer.from(malformed.bytes).toString("utf8"))).toMatchObject({ error: { code: "MALFORMED_REQUEST" } });
    const unsupported = await invoke(new EditorPreviewService({ resolve }), authorize, JSON.stringify({ project: {} }));
    expect(unsupported.response.status).toBe(400);
    expect(JSON.parse(Buffer.from(unsupported.bytes).toString("utf8"))).toMatchObject({ error: { code: "UNSUPPORTED_CONTRACT" } });
    const oversized = await invoke(new EditorPreviewService({ resolve }), authorize, Buffer.alloc(5 * 1024 * 1024 + 1, 0x20));
    expect(oversized.response.status).toBe(413);
    const errorText = Buffer.from(oversized.bytes).toString("utf8");
    expect(JSON.parse(errorText)).toMatchObject({ error: { code: "PROJECT_TOO_LARGE", retryable: false } });
    expect(errorText).not.toMatch(/secret|D:\/|hash|owner/iu);
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each(["text", "shape", "svg"] as const)("renders formal %s through the route as exact RGBA8", async (kind) => {
    const result = await invoke(
      new EditorPreviewService({ resolve: async (): Promise<never> => { throw new Error("no media"); } }),
      async () => principal,
      requestBody(kind)
    );
    expect(result.response.status).toBe(200);
    expect(result.response.headers.get("content-type")).toBe("application/octet-stream");
    expect(result.response.headers.get("cache-control")).toBe("no-store");
    expect(result.response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.response.headers.get("x-cmfx-width")).toBe("64");
    expect(result.response.headers.get("x-cmfx-height")).toBe("36");
    expect(result.response.headers.get("x-cmfx-time-contract")).toBe("1.1.0");
    expect(result.bytes).toHaveLength(64 * 36 * 4);
    expect(result.bytes.some((value) => value !== 0)).toBe(true);
  });

  it("aborts the materialization signal on response disconnect and starts no later work", async () => {
    let notifyStarted!: (signal: AbortSignal) => void;
    const started = new Promise<AbortSignal>((resolveStarted) => {
      notifyStarted = resolveStarted;
    });
    const fixture = assetEnvelope();
    const resolver: OwnerMediaResolverV1 = {
      resolve: async (_owner, _assetId, signal): Promise<never> => {
        notifyStarted(signal!);
        return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }));
      }
    };
    const handler = createEditorPreviewApi(new EditorPreviewService(resolver), { authorize: async () => principal });
    const server = createServer((request, response) => { void handler(request, response, () => response.end()); });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address() as AddressInfo;
      const client = httpRequest({ host: "127.0.0.1", port: address.port, path: "/api/editor-preview", method: "POST",
        headers: { "content-type": "application/json" } });
      client.on("error", () => undefined);
      client.end(JSON.stringify({ contract: "preview-request/v1", editableProject: fixture,
        frame: { time: 0, width: 64, height: 36, quality: "preview" } }));
      const signal = await started;
      client.destroy();
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it("runtime close aborts the same controller and waits for route cleanup", async () => {
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => { notifyStarted = resolveStarted; });
    let notifyAborted!: () => void;
    const aborted = new Promise<void>((resolveAborted) => { notifyAborted = resolveAborted; });
    let releaseAbort!: () => void;
    const abortReleased = new Promise<void>((resolveRelease) => { releaseAbort = resolveRelease; });
    const resolver: OwnerMediaResolverV1 = {
      resolve: async (_owner, _assetId, signal): Promise<never> => {
        notifyStarted();
        return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => {
          notifyAborted();
          void abortReleased.then(() => reject(signal!.reason));
        }, { once: true }));
      }
    };
    const service = new EditorPreviewService(resolver);
    const handler = createEditorPreviewApi(service, { authorize: async () => principal });
    const server = createServer((request, response) => { void handler(request, response, () => response.end()); });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const responsePromise = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/editor-preview`, {
        method: "POST", body: JSON.stringify({ contract: "preview-request/v1", editableProject: assetEnvelope(),
          frame: { time: 0, width: 64, height: 36, quality: "preview" } })
      });
      await started;
      const closing = service.close();
      await aborted;
      let closed = false;
      void closing.then(() => { closed = true; });
      await Promise.resolve();
      expect(closed).toBe(false);
      releaseAbort();
      const response = await responsePromise;
      await closing;
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: { code: "SERVICE_CLOSING", retryable: true } });
    } finally {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    }
  });

  it("renders owner image, video, and uploaded SVG proxy through the complete HTTP authority chain", async () => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));
    const fixtureRoot = await mkdtemp(resolve(tmpdir(), "cmfx-preview-owner-http-"));
    const input = resolve(fixtureRoot, "input");
    await mkdir(input);
    const imagePath = resolve(input, "owner.png");
    const videoPath = resolve(input, "owner.mp4");
    const svgPath = resolve(input, "owner.svg");
    await runProcess("ffmpeg", [
      "-hide_banner", "-y", "-threads", "1", "-f", "lavfi", "-i", "color=c=0x20c997:s=64x36:d=0.2",
      "-frames:v", "1", imagePath
    ]);
    await runProcess("ffmpeg", [
      "-hide_banner", "-y", "-threads", "1", "-f", "lavfi", "-i", "testsrc2=s=64x36:r=24:d=0.2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath
    ]);
    await writeFile(svgPath,
      "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"64\" height=\"36\"><rect width=\"64\" height=\"36\" fill=\"#20c997\"/></svg>");
    const store = await new TenantMediaStore({
      storageRoot: resolve(fixtureRoot, "media"), allowedRoots: [input]
    }).initialize();
    const ownerA = { tenantId: "tenant-route-owner", userId: "user-a" };
    const ownerB = { tenantId: "tenant-route-owner", userId: "user-b" };
    const ownerC = { tenantId: "tenant-route-owner", userId: "user-c" };
    const principalFor = (owner: typeof ownerA): AuthenticatedSessionPrincipal => ({ ...principal, ...owner });
    const imported = [] as Array<{ kind: string; a: ImportedMedia; b: ImportedMedia }>;
    for (const [kind, sourcePath, claimedMime] of [
      ["image", imagePath, "image/png"],
      ["video", videoPath, "video/mp4"],
      ["svg", svgPath, "image/svg+xml"]
    ] as const) {
      const a = await store.import(ownerA, { sourcePath, claimedMime, displayName: `${kind}-a` });
      const b = await store.import(ownerB, { sourcePath, claimedMime, displayName: `${kind}-b` });
      expect(a.asset.id).toBe(b.asset.id);
      expect(a.storedPath).not.toBe(b.storedPath);
      imported.push({ kind, a, b });
    }
    const resolutions: Array<{ userId: string; assetId: string; path?: string }> = [];
    const resolver: OwnerMediaResolverV1 = {
      resolve: async (requestedOwner, assetId, signal) => {
        const entry: { userId: string; assetId: string; path?: string } = { userId: requestedOwner.userId, assetId };
        resolutions.push(entry);
        const resolved = await store.resolve(requestedOwner, assetId, signal);
        entry.path = resolved.storedPath;
        return resolved;
      }
    };
    const service = new EditorPreviewService(resolver);
    for (const media of imported) {
      const editableProject = ownerAssetEnvelope(media.a);
      const body = JSON.stringify({
        contract: "preview-request/v1", editableProject,
        frame: { time: 0.1, width: 64, height: 36, quality: "final" }
      });
      const authorizeA = vi.fn(async () => principalFor(ownerA));
      const authorizeB = vi.fn(async () => principalFor(ownerB));
      const a = await invoke(service, authorizeA, body);
      const b = await invoke(service, authorizeB, body);
      expect([a.response.status, b.response.status]).toEqual([200, 200]);
      expect(authorizeA.mock.calls[0]?.slice(2)).toEqual(["project:preview", true]);
      expect(authorizeB.mock.calls[0]?.slice(2)).toEqual(["project:preview", true]);
      expect(a.bytes).toEqual(b.bytes);
      expect(resolutions).toEqual(expect.arrayContaining([
        { userId: ownerA.userId, assetId: media.a.asset.id, path: media.a.storedPath },
        { userId: ownerB.userId, assetId: media.b.asset.id, path: media.b.storedPath }
      ]));

      const beforeCrossOwner = resolutions.length;
      const denied = await invoke(service, async () => principalFor(ownerC), body);
      expect(denied.response.status).toBe(404);
      const deniedText = Buffer.from(denied.bytes).toString("utf8");
      expect(JSON.parse(deniedText)).toMatchObject({ error: { code: "NOT_FOUND" } });
      expect(resolutions.slice(beforeCrossOwner)).toEqual([
        { userId: ownerC.userId, assetId: media.a.asset.id }
      ]);
      expect(deniedText).not.toMatch(/tenant-route-owner|user-[abc]|cmfx-preview|sha256|ffmpeg|probe/iu);

      const forged = structuredClone(editableProject) as unknown as { project: { assets: Array<Record<string, unknown>> } };
      Object.assign(forged.project.assets[0]!, {
        owner: ownerB, path: media.b.storedPath, uri: "file:///forged/owner-media",
        hash: `sha256:${"f".repeat(64)}`,
        metadata: { mime: "application/octet-stream", codec: "forged", proxy: "D:/forged-proxy" }
      });
      const beforeForged = resolutions.length;
      const rejected = await invoke(service, async () => principalFor(ownerA), JSON.stringify({
        contract: "preview-request/v1", editableProject: forged,
        frame: { time: 0.1, width: 64, height: 36, quality: "final" }
      }));
      expect(rejected.response.status).toBe(400);
      expect(resolutions).toHaveLength(beforeForged);
      const rejectedText = Buffer.from(rejected.bytes).toString("utf8");
      expect(JSON.parse(rejectedText)).toMatchObject({ error: { code: "MALFORMED_REQUEST" } });
      expect(rejectedText).not.toMatch(/user-b|forged|D:\/|sha256/iu);
    }
    await service.close();
  }, 60_000);
});
