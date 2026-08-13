import { mkdtemp, readFile, readdir, stat } from "node:fs/promises";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import type { LayerDefinition } from "@codemotion/core";
import type { VerifiedStoredMedia } from "@codemotion/exporter";
import type { AuthenticatedSessionPrincipal, AuthSessionService } from "../src/auth-session-service.js";
import { createStarterProject } from "../src/model.js";

const filesystem = vi.hoisted(() => ({
  open: vi.fn(),
  realOpen: undefined as unknown as typeof import("node:fs/promises").open
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  filesystem.realOpen = actual.open;
  return { ...actual, open: filesystem.open };
});

import { createExportApi, ExportTaskService } from "../src/export-task-service.js";

const principal: AuthenticatedSessionPrincipal = {
  tenantId: "tenant-download", userId: "user-download", scopes: ["export:read"],
  issuer: "urn:test", audience: "test", issuedAt: 1, expiresAt: 2_000_000_000,
  sessionId: "download-session-id-012345678901234567890123456789", authSource: "local-dev-session"
};

function exportFixture(): { editableProject: unknown; verified: VerifiedStoredMedia } {
  const hash = "b".repeat(64);
  const asset = {
    id: "asset_export_route_opaque", type: "image" as const,
    uri: `media://${hash}.png`, hash: `sha256:${hash}`,
    metadata: { mime: "image/png", codec: "png", bytes: 4, width: 1, height: 1, decodeVerified: true }
  };
  const project = createStarterProject("Export close", 32, 24, 24);
  project.duration = 0.1;
  project.compositions[0]!.duration = 0.1;
  const template = project.compositions[0]!.layers[0]!;
  project.compositions[0]!.layers = [{
    ...template, id: "layer.export.image", name: "Export image", type: "image",
    endTime: 0.1, outPoint: 0.1,
    source: { assetId: asset.id }, properties: { fit: "fill" }, effects: [], masks: []
  } as unknown as LayerDefinition];
  project.compositions[0]!.markers = [];
  project.assets = [asset]; project.audioTracks = []; project.fonts = [];
  const safe = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: [], brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!safe.valid) throw new Error(safe.error.code);
  return {
    editableProject: safe.value,
    verified: {
      asset, descriptor: { id: asset.id, type: "image", cacheKey: "owner-image", metadata: {} },
      storedPath: "D:/missing/owner-image.png",
      arkEligibility: { filesApi: false, videoTos: false, base64OrUrl: false, reason: "test" }, trustedBytes: 4
    }
  };
}

function mediaFreeExportFixture(): unknown {
  const project = createStarterProject("Active download", 32, 24, 24);
  project.duration = 0.1;
  project.compositions[0]!.duration = 0.1;
  const template = project.compositions[0]!.layers[0]!;
  project.compositions[0]!.layers = [{
    ...template, id: "layer.download.shape", name: "Download shape", type: "shape",
    endTime: 0.1, outPoint: 0.1,
    properties: { shapes: [{ path: "M0 0 L32 0 L32 24 L0 24 Z", fill: "#20C997FF" }], fill: "#20C997FF" },
    effects: [], masks: []
  } as unknown as LayerDefinition];
  project.compositions[0]!.markers = [];
  project.assets = []; project.audioTracks = []; project.fonts = [];
  const safe = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(project, {
    style: [], brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  });
  if (!safe.valid) throw new Error(safe.error.code);
  return safe.value;
}

async function download(service: ExportTaskService): Promise<{ status: number; text: string }> {
  const auth: Pick<AuthSessionService, "authorize" | "verifySameOriginDownload"> = {
    authorize: async () => principal,
    verifySameOriginDownload: () => undefined
  };
  const handler = createExportApi(service, auth);
  const server = createServer((request, response) => {
    void handler(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/editor-exports/task/download`);
    return { status: response.status, text: await response.text() };
  } finally {
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}

function downloadService(release: () => Promise<void>): ExportTaskService {
  return {
    acquireDownload: vi.fn(async () => ({
      taskId: "task", leaseId: "lease", path: "D:/canonical/output.mp4", name: "output.mp4",
      bytes: 4, format: "mp4", controller: new AbortController(), release
    }))
  } as unknown as ExportTaskService;
}

describe("export download handle ownership", () => {
  it("releases the exact lease once when open fails", async () => {
    const release = vi.fn(async () => undefined);
    filesystem.open.mockRejectedValueOnce(new Error("secret open D:/canonical/output.mp4"));
    const result = await download(downloadService(release));
    expect(result.status).toBe(500);
    expect(release).toHaveBeenCalledOnce();
    expect(result.text).not.toMatch(/secret|canonical|D:\//iu);
  });

  it("closes the handle and releases the exact lease once when stat fails", async () => {
    const release = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    filesystem.open.mockResolvedValueOnce({
      stat: vi.fn(async () => { throw new Error("secret stat"); }), close
    });
    const result = await download(downloadService(release));
    expect(result.status).toBe(500);
    expect(close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(result.text).not.toContain("secret");
  });

  it("closes the handle and releases the exact lease once when stream creation fails", async () => {
    const release = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    filesystem.open.mockResolvedValueOnce({
      stat: vi.fn(async () => ({ isFile: () => true, size: 4 })),
      createReadStream: vi.fn(() => { throw new Error("secret stream"); }),
      close
    });
    const result = await download(downloadService(release));
    expect(result.status).toBe(500);
    expect(close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(result.text).not.toContain("secret");
  });
});

describe("real HTTP active download drain", () => {
  it("closes real handles before exact lease release and bounds tombstone cleanup to 30 plus 5 seconds", async () => {
    let now = new Date("2026-08-04T00:00:00.000Z");
    const outputRoot = await mkdtemp(resolve(tmpdir(), "cmfx-active-download-"));
    const service = await new ExportTaskService({
      outputRoot, now: () => now,
      resolver: { resolve: async (): Promise<never> => { throw new Error("media not expected"); } }
    }).initialize();
    const settings = {
      format: "png-sequence" as const, width: 32, height: 24, fps: 24,
      duration: 0.1, alpha: true, audio: false
    };
    const taskIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const created = await service.create({ ...principal, scopes: ["export:create", "export:read"] }, {
        contract: "export-request/v1", editableProject: mediaFreeExportFixture(), settings
      });
      await vi.waitFor(async () => expect((await service.get(principal, created.id)).status).toBe("completed"), {
        timeout: 10_000, interval: 25
      });
      taskIds.push(created.id);
    }
    type RuntimeTask = { record: { view: { id: string; outputBytes?: number }; downloadPath?: string; leases: unknown[]; deletionPhase: string } };
    const internals = service as unknown as {
      tasks: Map<string, RuntimeTask>;
      persist(task: RuntimeTask): Promise<void>;
    };
    const runtimeTasks = taskIds.map((id) => [...internals.tasks.values()].find((task) => task.record.view.id === id)!);
    for (const task of runtimeTasks) {
      const handle = await filesystem.realOpen(task.record.downloadPath!, "r+");
      await handle.truncate(32 * 1024 * 1024);
      await handle.close();
      task.record.view.outputBytes = 32 * 1024 * 1024;
      await internals.persist(task);
    }

    const opened: Array<{
      handle: Awaited<ReturnType<typeof filesystem.realOpen>>;
      close: unknown;
      createReadStream: unknown;
    }> = [];
    filesystem.open.mockImplementation(async (...args: Parameters<typeof filesystem.realOpen>) => {
      const handle = await filesystem.realOpen(...args);
      const close = vi.spyOn(handle, "close");
      const createReadStream = vi.spyOn(handle, "createReadStream");
      opened.push({ handle, close, createReadStream });
      return handle;
    });
    const releases: Array<ReturnType<typeof vi.fn>> = [];
    const acquire = service.acquireDownload.bind(service);
    vi.spyOn(service, "acquireDownload").mockImplementation(async (...args) => {
      const lease = await acquire(...args);
      const release = vi.fn(lease.release.bind(lease));
      releases.push(release);
      return { ...lease, release };
    });
    const auth: Pick<AuthSessionService, "authorize" | "verifySameOriginDownload"> = {
      authorize: async () => principal,
      verifySameOriginDownload: () => undefined
    };
    const handler = createExportApi(service, auth);
    let activeHandler: Promise<void> | undefined;
    const server = createServer((request, response) => {
      activeHandler = handler(request, response, () => response.end());
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const startDownload = async (id: string) => {
      let clientResponse!: IncomingMessage;
      const responseReady = new Promise<void>((resolveResponse) => {
        const client = httpRequest({
          host: "127.0.0.1", port: (server.address() as AddressInfo).port,
          path: `/api/editor-exports/${id}/download`, method: "GET"
        });
        client.on("error", () => undefined);
        client.on("response", (response) => {
          clientResponse = response;
          response.on("error", () => undefined);
          response.pause();
          resolveResponse();
        });
        client.end();
      });
      await responseReady;
      await vi.waitFor(() => expect(opened.length).toBeGreaterThan(0));
      return { response: clientResponse, handler: activeHandler! };
    };
    try {
      const disconnected = await startDownload(taskIds[0]!);
      const firstHandle = opened[0]!;
      expect(firstHandle.createReadStream).toHaveBeenCalledWith(expect.objectContaining({ autoClose: true }));
      disconnected.response.destroy();
      await disconnected.handler;
      expect(firstHandle.handle.fd).toBe(-1);
      expect(firstHandle.close).toHaveBeenCalledOnce();
      expect(releases[0]).toHaveBeenCalledOnce();
      expect(runtimeTasks[0]!.record.leases).toEqual([]);
      expect((await stat(runtimeTasks[0]!.record.downloadPath!)).isFile()).toBe(true);

      const active = await startDownload(taskIds[1]!);
      const secondHandle = opened[1]!;
      const secondDownloadPath = runtimeTasks[1]!.record.downloadPath!;
      expect(runtimeTasks[1]!.record.leases).toHaveLength(1);
      now = new Date("2026-08-05T00:00:00.001Z");
      vi.useFakeTimers();
      await service.sweep();
      await expect(service.acquireDownload(principal, taskIds[1]!)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(secondHandle.handle.fd).not.toBe(-1);
      expect(releases[1]).not.toHaveBeenCalled();
      expect((await stat(secondDownloadPath)).isFile()).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(5_000);
      await active.handler;
      await service.close();
      expect(secondHandle.handle.fd).toBe(-1);
      expect(secondHandle.close).toHaveBeenCalledOnce();
      expect(releases[1]).toHaveBeenCalledOnce();
      expect(runtimeTasks[1]!.record.leases).toEqual([]);
      expect(runtimeTasks[1]!.record.deletionPhase).toBe("tombstoned-clean");
      await expect(stat(secondDownloadPath)).rejects.toMatchObject({ code: "ENOENT" });
      const persisted = JSON.parse(await readFile(resolve(outputRoot, taskIds[1]!, "task-record-v1.json"), "utf8"));
      expect(persisted).toMatchObject({ deletionPhase: "tombstoned-clean", leases: [], pendingFiles: [] });
    } finally {
      vi.useRealTimers();
      filesystem.open.mockReset();
      await service.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }, 60_000);
});

async function disconnectExport(
  path: string,
  body: string | undefined,
  service: ExportTaskService
): Promise<void> {
  const auth: Pick<AuthSessionService, "authorize" | "verifySameOriginDownload"> = {
    authorize: async () => ({ ...principal, scopes: ["export:create", "export:read"] }),
    verifySameOriginDownload: () => undefined
  };
  const handler = createExportApi(service, auth);
  let settle!: () => void;
  const settled = new Promise<void>((resolveSettled) => { settle = resolveSettled; });
  const server = createServer((request, response) => {
    void handler(request, response, () => response.end()).finally(settle);
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const client = httpRequest({
      host: "127.0.0.1", port: (server.address() as AddressInfo).port, path, method: "POST",
      headers: body === undefined ? {} : { "content-type": "application/json" }
    });
    client.on("error", () => undefined);
    if (body === undefined) client.end(); else client.end(body);
    await new Promise<void>((resolveStarted) => {
      const method = path.endsWith("/retry") ? service.retry : service.create;
      vi.waitFor(() => expect(method).toHaveBeenCalled()).then(() => resolveStarted());
    });
    client.destroy();
    await settled;
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  }
}

describe("export create and retry disconnect ownership", () => {
  it.each([
    ["create", "/api/editor-exports", "{}"],
    ["retry", "/api/editor-exports/task-id/retry", undefined]
  ] as const)("aborts the same controller while %s is in progress", async (method, path, body) => {
    let observedSignal!: AbortSignal;
    const service = {} as ExportTaskService;
    const waitForAbort = (_principal: unknown, _requestOrId: unknown, controller: AbortController) => {
      observedSignal = controller.signal;
      return new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
      });
    };
    if (method === "create") service.create = vi.fn(waitForAbort) as ExportTaskService["create"];
    else service.retry = vi.fn(waitForAbort) as ExportTaskService["retry"];
    await disconnectExport(path, body, service);
    expect(observedSignal.aborted).toBe(true);
  });

  it("does not call create when the request disconnects before the body completes", async () => {
    const create = vi.fn();
    const service = { create } as unknown as ExportTaskService;
    const auth = { authorize: async () => ({ ...principal, scopes: ["export:create"] }) };
    const handler = createExportApi(service, auth as unknown as Pick<AuthSessionService, "authorize" | "verifySameOriginDownload">);
    let settle!: () => void;
    const settled = new Promise<void>((resolveSettled) => { settle = resolveSettled; });
    let notifyReceived!: () => void;
    const received = new Promise<void>((resolveReceived) => { notifyReceived = resolveReceived; });
    const server = createServer((request, response) => {
      notifyReceived();
      void handler(request, response, () => response.end()).finally(settle);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const client = httpRequest({ host: "127.0.0.1", port: (server.address() as AddressInfo).port,
        path: "/api/editor-exports", method: "POST", headers: { "content-length": "1000" } });
      client.on("error", () => undefined);
      client.write("{");
      await received;
      client.destroy();
      await settled;
      expect(create).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  });

  it.each([
    ["create", "/api/editor-exports", "{}"],
    ["retry", "/api/editor-exports/task-id/retry", undefined]
  ] as const)("keeps the %s controller active after a normal 202 response", async (method, path, body) => {
    let controller!: AbortController;
    const service = {} as ExportTaskService;
    const complete = async (_principal: unknown, _requestOrId: unknown, value: AbortController) => {
      controller = value;
      return { id: "new-task" };
    };
    if (method === "create") service.create = vi.fn(complete) as unknown as ExportTaskService["create"];
    else service.retry = vi.fn(complete) as unknown as ExportTaskService["retry"];
    const auth = {
      authorize: async () => ({ ...principal, scopes: ["export:create", "export:read"] }),
      verifySameOriginDownload: () => undefined
    };
    const handler = createExportApi(service, auth as Pick<AuthSessionService, "authorize" | "verifySameOriginDownload">);
    const server = createServer((request, response) => { void handler(request, response, () => response.end()); });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
        method: "POST", ...(body === undefined ? {} : { body })
      });
      expect(response.status).toBe(202);
      await response.arrayBuffer();
      expect(controller.signal.aborted).toBe(false);
    } finally {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    }
  });
});

describe("export runtime close ownership", () => {
  const settings = {
    format: "png-sequence" as const, width: 32, height: 24, fps: 24,
    duration: 0.1, alpha: true, audio: false
  };

  it("aborts and drains an in-flight create materialization", async () => {
    const fixture = exportFixture();
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => { notifyStarted = resolveStarted; });
    let notifyAborted!: () => void;
    const aborted = new Promise<void>((resolveAborted) => { notifyAborted = resolveAborted; });
    let release!: () => void;
    const released = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    const service = await new ExportTaskService({
      outputRoot: await mkdtemp(resolve(tmpdir(), "cmfx-export-close-create-")),
      resolver: { resolve: async (_owner, _assetId, signal): Promise<never> => {
        notifyStarted();
        return new Promise((_resolve, reject) => signal!.addEventListener("abort", () => {
          notifyAborted();
          void released.then(() => reject(signal!.reason));
        }, { once: true }));
      } }
    }).initialize();
    const creation = service.create({ ...principal, scopes: ["export:create"] }, {
      contract: "export-request/v1", editableProject: fixture.editableProject, settings
    });
    await started;
    const closing = service.close();
    await aborted;
    let closed = false;
    void closing.then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await expect(creation).rejects.toMatchObject({ code: "SERVICE_CLOSING" });
    await closing;
  });

  it("aborts and drains retry materialization without inserting a replacement task", async () => {
    const fixture = exportFixture();
    let blockRetry = false;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => { notifyStarted = resolveStarted; });
    let notifyAborted!: () => void;
    const aborted = new Promise<void>((resolveAborted) => { notifyAborted = resolveAborted; });
    let release!: () => void;
    const released = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    const service = await new ExportTaskService({
      outputRoot: await mkdtemp(resolve(tmpdir(), "cmfx-export-close-retry-")),
      resolver: { resolve: async (_owner, _assetId, signal) => {
        if (!blockRetry) return fixture.verified;
        notifyStarted();
        return new Promise<never>((_resolve, reject) => signal!.addEventListener("abort", () => {
          notifyAborted();
          void released.then(() => reject(signal!.reason));
        }, { once: true }));
      } }
    }).initialize();
    const created = await service.create({ ...principal, scopes: ["export:create"] }, {
      contract: "export-request/v1", editableProject: fixture.editableProject, settings
    });
    await vi.waitFor(async () => expect((await service.get(principal, created.id)).status).toBe("failed"), {
      timeout: 10_000,
      interval: 50
    });
    blockRetry = true;
    const retry = service.retry({ ...principal, scopes: ["export:create"] }, created.id);
    await started;
    const closing = service.close();
    await aborted;
    release();
    await expect(retry).rejects.toMatchObject({ code: "SERVICE_CLOSING" });
    await closing;
    expect((await service.list(principal)).map((task) => task.id)).toEqual([created.id]);
  });
});

describe("export persisted insertion abort rollback", () => {
  const settings = {
    format: "png-sequence" as const, width: 32, height: 24, fps: 24,
    duration: 0.1, alpha: true, audio: false
  };

  it.each(["create", "retry"] as const)("rolls back only the new %s task when abort wins after insertion", async (mode) => {
    const fixture = exportFixture();
    const outputRoot = await mkdtemp(resolve(tmpdir(), `cmfx-export-boundary-${mode}-`));
    const service = await new ExportTaskService({
      outputRoot,
      resolver: { resolve: async () => fixture.verified }
    }).initialize();
    let sourceId: string | undefined;
    if (mode === "retry") {
      const source = await service.create({ ...principal, scopes: ["export:create"] }, {
        contract: "export-request/v1", editableProject: fixture.editableProject, settings
      });
      sourceId = source.id;
      await vi.waitFor(async () => expect((await service.get(principal, source.id)).status).toBe("failed"), {
        timeout: 10_000, interval: 25
      });
    }
    const beforeDirectories = await readdir(outputRoot);
    const controller = new AbortController();
    const reason = new Error(`abort-${mode}-after-insert`);
    type CapturedTask = { record: { view: { id: string }; outputPath: string; pendingFiles: string[] }; execution?: Promise<void> };
    const internals = service as unknown as { tasks: Map<string, CapturedTask> };
    const originalSet = internals.tasks.set.bind(internals.tasks);
    let inserted: CapturedTask | undefined;
    const set = vi.spyOn(internals.tasks, "set").mockImplementation((key, task) => {
      const result = originalSet(key, task);
      inserted = task;
      controller.abort(reason);
      return result;
    });
    try {
      const operation = mode === "create"
        ? service.create({ ...principal, scopes: ["export:create"] }, {
          contract: "export-request/v1", editableProject: fixture.editableProject, settings
        }, controller)
        : service.retry({ ...principal, scopes: ["export:create"] }, sourceId!, controller);
      await expect(operation).rejects.toBe(reason);
    } finally {
      set.mockRestore();
    }
    expect(inserted).toBeDefined();
    expect(inserted!.execution).toBeUndefined();
    const newId = inserted!.record.view.id;
    expect((await service.list(principal)).map((task) => task.id)).toEqual(sourceId === undefined ? [] : [sourceId]);
    await expect(service.get(principal, newId)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(await readdir(outputRoot)).toEqual(beforeDirectories);
    await expect(stat(resolve(outputRoot, newId))).rejects.toMatchObject({ code: "ENOENT" });
    for (const pending of inserted!.record.pendingFiles) await expect(stat(pending)).rejects.toMatchObject({ code: "ENOENT" });
    if (sourceId !== undefined) {
      expect(await service.get(principal, sourceId)).toMatchObject({ id: sourceId, status: "failed" });
      expect((await stat(resolve(outputRoot, sourceId))).isDirectory()).toBe(true);
    }
    await service.close();
  }, 30_000);
});

describe("single export history clearing", () => {
  it("rejects active work and tombstones one completed task without affecting another", async () => {
    const outputRoot = await mkdtemp(resolve(tmpdir(), "cmfx-clear-task-"));
    const service = await new ExportTaskService({
      outputRoot,
      resolver: { resolve: async (): Promise<never> => { throw new Error("media not expected"); } }
    }).initialize();
    const exportPrincipal = { ...principal, scopes: ["export:create", "export:read"] } as AuthenticatedSessionPrincipal;
    const request = {
      contract: "export-request/v1" as const,
      editableProject: mediaFreeExportFixture(),
      settings: { format: "png-sequence" as const, width: 32, height: 24, fps: 24, duration: 0.1, alpha: true, audio: false }
    };
    try {
      const active = await service.create(exportPrincipal, request);
      await expect(service.clear(exportPrincipal, active.id)).rejects.toMatchObject({ status: 409, code: "EXPORT_TASK_ACTIVE" });
      await vi.waitFor(async () => expect((await service.get(exportPrincipal, active.id)).status).toBe("completed"), { timeout: 10_000, interval: 25 });
      const retained = await service.create(exportPrincipal, request);
      await vi.waitFor(async () => expect((await service.get(exportPrincipal, retained.id)).status).toBe("completed"), { timeout: 10_000, interval: 25 });
      await service.clear(exportPrincipal, active.id);
      await expect(service.get(exportPrincipal, active.id)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
      expect((await service.list(exportPrincipal)).map((task) => task.id)).toEqual([retained.id]);
    } finally { await service.close(); }
  }, 30_000);
});

describe("export route authorization matrix", () => {
  it.each([
    ["GET", "/api/editor-exports", "export:read", false],
    ["POST", "/api/editor-exports", "export:create", true],
    ["GET", "/api/editor-exports/task-id", "export:read", false],
    ["DELETE", "/api/editor-exports/task-id", "export:create", true],
    ["POST", "/api/editor-exports/task-id/cancel", "export:create", true],
    ["POST", "/api/editor-exports/task-id/retry", "export:create", true],
    ["GET", "/api/editor-exports/task-id/download", "export:read", false]
  ] as const)("authorizes %s %s with exact %s before task or disk work", async (method, path, scope, stateChanging) => {
    filesystem.open.mockClear();
    const methods = {
      list: vi.fn(), create: vi.fn(), get: vi.fn(), clear: vi.fn(), cancel: vi.fn(), retry: vi.fn(), acquireDownload: vi.fn()
    };
    const service = methods as unknown as ExportTaskService;
    const authorize = vi.fn(async () => { throw { status: 401, code: "UNAUTHENTICATED" }; });
    const verifySameOriginDownload = vi.fn();
    const handler = createExportApi(service, { authorize, verifySameOriginDownload });
    const server = createServer((request, response) => { void handler(request, response, () => response.end()); });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
        method, ...(method === "POST" && path === "/api/editor-exports" ? { body: "{}" } : {})
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
      expect(authorize).toHaveBeenCalledOnce();
      expect(authorize.mock.calls[0]?.slice(2)).toEqual([scope, stateChanging]);
      for (const taskMethod of Object.values(methods)) expect(taskMethod).not.toHaveBeenCalled();
      expect(verifySameOriginDownload).not.toHaveBeenCalled();
      expect(filesystem.open).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
      filesystem.open.mockClear();
    }
  });
});
