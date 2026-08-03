import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, preview, type Connect, type ViteDevServer } from "vite";
import { createServerRuntimePlugin } from "../vite.config.js";

function deferred<T = void>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

type RuntimeHandle = (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => Promise<void>;

function runtime(close: () => Promise<void> = async () => undefined) {
  return {
    handle: vi.fn<RuntimeHandle>(async (_request, _response, next) => { next(); }),
    close: vi.fn(close)
  };
}

const editorRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function developmentServer(createRuntime: Parameters<typeof createServerRuntimePlugin>[0]): Promise<ViteDevServer> {
  return createServer({
    configFile: false,
    root: editorRoot,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    plugins: [createServerRuntimePlugin(createRuntime)]
  });
}

function middlewareHandles(server: ViteDevServer): unknown[] {
  return (server.middlewares as unknown as { stack: Array<{ handle: unknown }> }).stack
    .map((layer) => layer.handle);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Vite server runtime lifecycle", () => {
  it("makes a real ViteDevServer.close wait for runtime.close", async () => {
    const closeStarted = deferred();
    const closeBarrier = deferred();
    const current = runtime(async () => {
      closeStarted.resolve();
      await closeBarrier.promise;
    });
    let createCount = 0;
    const server = await developmentServer(async () => {
      createCount += 1;
      return current;
    });

    let viteCloseCompleted = false;
    const viteClose = server.close().then(() => { viteCloseCompleted = true; });
    await closeStarted.promise;
    await Promise.resolve();
    expect(viteCloseCompleted).toBe(false);
    expect(current.close).toHaveBeenCalledTimes(1);

    closeBarrier.resolve();
    await viteClose;
    expect(viteCloseCompleted).toBe(true);
    expect(createCount).toBe(1);
  });

  it("propagates runtime close rejection without an unhandled rejection", async () => {
    const closeFailure = new Error("runtime close failed");
    const current = runtime(async () => { throw closeFailure; });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const server = await developmentServer(async () => current);
      await expect(server.close()).rejects.toBe(closeFailure);
      await new Promise<void>((resolveValue) => setImmediate(resolveValue));
      expect(unhandled).toEqual([]);
      expect(current.close).toHaveBeenCalledTimes(1);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("reuses one runtime and one close promise for repeated close calls", async () => {
    const closeStarted = deferred();
    const closeBarrier = deferred();
    const current = runtime(async () => {
      closeStarted.resolve();
      await closeBarrier.promise;
    });
    const createRuntime = vi.fn(async () => current);
    const server = await developmentServer(createRuntime);

    const firstClose = server.close();
    const secondClose = server.close();
    await closeStarted.promise;
    expect(secondClose).toBe(firstClose);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(current.close).toHaveBeenCalledTimes(1);

    closeBarrier.resolve();
    await Promise.all([firstClose, secondClose]);
  });

  it("closes the old runtime before a restarted server can use the new middleware", async () => {
    const oldCloseStarted = deferred();
    const oldCloseBarrier = deferred();
    let oldProviderAborted = false;
    let oldTaskStatus = "running";
    const oldRuntime = runtime(async () => {
      oldProviderAborted = true;
      oldTaskStatus = "cancelled";
      oldCloseStarted.resolve();
      await oldCloseBarrier.promise;
    });
    const newRuntime = runtime();
    let createCount = 0;
    const server = await developmentServer(async () => {
      createCount += 1;
      return createCount === 1 ? oldRuntime : newRuntime;
    });
    expect(middlewareHandles(server)).toContain(oldRuntime.handle);

    let restartCompleted = false;
    const restart = server.restart().then(() => { restartCompleted = true; });
    await oldCloseStarted.promise;
    await Promise.resolve();
    expect(createCount).toBe(2);
    expect(restartCompleted).toBe(false);
    expect(middlewareHandles(server)).toContain(oldRuntime.handle);
    expect(middlewareHandles(server)).not.toContain(newRuntime.handle);

    oldCloseBarrier.resolve();
    await restart;
    expect(oldProviderAborted).toBe(true);
    expect(oldTaskStatus).not.toMatch(/running|cancelling/);
    expect(middlewareHandles(server)).toContain(newRuntime.handle);
    expect(middlewareHandles(server)).not.toContain(oldRuntime.handle);
    await server.close();
    expect(newRuntime.close).toHaveBeenCalledTimes(1);
  });

  it("does not create another runtime for an ordinary HMR watch change", async () => {
    const current = runtime();
    const createRuntime = vi.fn(async () => current);
    const server = await developmentServer(createRuntime);

    await server.environments.client.pluginContainer.watchChange(
      resolve(editorRoot, "src/App.tsx"),
      { event: "update" }
    );
    expect(createRuntime).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it("mounts the development runtime handle exactly once", async () => {
    const current = runtime();
    const createRuntime = vi.fn(async () => current);
    const server = await developmentServer(createRuntime);

    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(middlewareHandles(server).filter((handle) => handle === current.handle)).toHaveLength(1);
    await server.close();
  });

  it("does not create or mount the runtime in Vite preview", async () => {
    const current = runtime();
    const createRuntime = vi.fn(async () => current);
    const previewServer = await preview({
      configFile: false,
      root: editorRoot,
      logLevel: "silent",
      build: { outDir: "dist-app" },
      plugins: [createServerRuntimePlugin(createRuntime)]
    });
    try {
      expect(createRuntime).not.toHaveBeenCalled();
      expect((previewServer.middlewares as unknown as { stack: Array<{ handle: unknown }> }).stack
        .some((layer) => layer.handle === current.handle)).toBe(false);
    } finally {
      await previewServer.close();
    }
  });

  it("does not mount middleware when runtime initialization fails", async () => {
    const failure = new Error("runtime initialization failed");
    const createRuntime = vi.fn(async () => { throw failure; });
    await expect(developmentServer(createRuntime)).rejects.toBe(failure);
    expect(createRuntime).toHaveBeenCalledTimes(1);
  });
});
