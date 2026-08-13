import { mkdtemp, readdir, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ProviderError,
  type AiPlanningInputV1,
  type ModelProvider,
  type UnderstandingRequest,
  type UnderstandingResult
} from "@codemotion/ai-planner";
import { AiPlanService, type AiSessionPrincipal } from "../src/ai-plan-service.js";
import type { AuthenticatedSessionPrincipal } from "../src/auth-session-service.js";
import { createServerRuntime } from "../src/server-runtime.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class RuntimeBlockingProvider implements ModelProvider {
  readonly id = "runtime-blocking-provider";
  readonly requests: UnderstandingRequest[] = [];
  readonly started = deferred();
  aborted = false;

  understand(request: UnderstandingRequest): Promise<UnderstandingResult> {
    this.requests.push(request);
    this.started.resolve();
    return new Promise((_resolve, reject) => {
      const abort = (): void => {
        this.aborted = true;
        reject(new ProviderError("cancelled", "cancelled"));
      };
      if (request.signal?.aborted) abort();
      else request.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

const owner: AiSessionPrincipal = { tenantId: "tenant-runtime", userId: "user-runtime", scopes: ["ai:plan"] };
const uploadPrincipal: AuthenticatedSessionPrincipal = {
  tenantId: owner.tenantId,
  userId: owner.userId,
  scopes: ["assets:write", "ai:plan"],
  issuer: "urn:test",
  audience: "test",
  issuedAt: 1,
  expiresAt: 2_000_000_000,
  sessionId: "runtime-session-id-012345678901234567890123456789",
  authSource: "local-dev-session"
};
const planningInput: AiPlanningInputV1 = {
  contract: "ai-task/v1",
  prompt: "runtime lifecycle",
  assets: [],
  canvas: { width: 640, height: 360, fps: 24 },
  durationSeconds: 1,
  style: ["restrained"],
  brand: { colors: ["#112233"], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
};

describe("server runtime lifecycle", () => {
  it("returns the unified safe SERVICE_CLOSING envelope from real middleware", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "cmfx-runtime-closing-response-"));
    const runtime = await createServerRuntime({
      mode: "development",
      configureServer: true,
      listenHost: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      mediaRoot: resolve(root, "media"),
      uploadTempRoot: resolve(root, "uploads"),
      env: {},
      createAiPlans: (assets) => new AiPlanService(new RuntimeBlockingProvider(), assets)
    });
    await runtime.close();
    const server = createServer((request, response) => {
      void runtime.handle(request, response, () => { response.statusCode = 404; response.end(); });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/editor-preview`);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json() as { error: Record<string, unknown> };
      expect(body).toEqual({ error: {
        code: "SERVICE_CLOSING",
        message: "The service is closing.",
        retryable: true,
        requestId: expect.stringMatching(/^req_[0-9a-f-]{36}$/)
      } });
      expect(JSON.stringify(body)).not.toMatch(/path|hash|owner|token|cookie|provider|ffmpeg|probe/iu);
    } finally {
      await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
    }
  });

  it("exposes close, aborts its shared AI service, and disables the old handle", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "cmfx-runtime-lifecycle-"));
    const provider = new RuntimeBlockingProvider();
    const runtime = await createServerRuntime({
      mode: "development",
      configureServer: true,
      listenHost: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      mediaRoot: resolve(root, "media"),
      uploadTempRoot: resolve(root, "uploads"),
      env: {
        NODE_ENV: "development",
        CODEMOTION_DEV_AUTH: "1",
        CODEMOTION_DEV_TENANT_ID: owner.tenantId,
        CODEMOTION_DEV_USER_ID: owner.userId,
        CODEMOTION_DEV_SCOPES: "assets:read assets:write ai:plan"
      },
      createAiPlans: (assets) => new AiPlanService(provider, assets)
    });

    const created = await runtime.aiPlans.create(owner, planningInput);
    await provider.started.promise;
    const mediaCloseStarted = deferred();
    const releaseMediaClose = deferred();
    const closeMediaAssets = runtime.mediaAssets.close.bind(runtime.mediaAssets);
    vi.spyOn(runtime.mediaAssets, "close").mockImplementation(() => {
      mediaCloseStarted.resolve();
      return releaseMediaClose.promise.then(closeMediaAssets);
    });
    const runtimeHasClose = typeof runtime.close === "function";
    const firstClose = runtime.close();
    const secondClose = runtime.close();
    const disposed = runtime.dispose();
    expect(secondClose).toBe(firstClose);
    expect(disposed).toBe(firstClose);
    await mediaCloseStarted.promise;
    let closeSettled = false;
    void firstClose.then(() => { closeSettled = true; });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    releaseMediaClose.resolve();
    await Promise.all([firstClose, secondClose, disposed]);
    expect(runtime.mediaAssets.close).toHaveBeenCalledOnce();

    const taskStatusAfterClose = runtime.aiPlans.get(owner, created.id).status;
    const providerAbortedAfterClose = provider.aborted;
    expect({ runtimeHasClose, providerAbortedAfterClose, taskStatusAfterClose }).toMatchObject({
      runtimeHasClose: true,
      providerAbortedAfterClose: true
    });
    expect(taskStatusAfterClose).not.toBe("running");
    expect(taskStatusAfterClose).not.toBe("cancelling");

    let nextCalls = 0;
    await runtime.handle({} as IncomingMessage, {} as ServerResponse, () => { nextCalls += 1; });
    expect(nextCalls).toBe(1);
    await expect(runtime.aiPlans.create(owner, planningInput)).rejects.toMatchObject({ code: "cancelled" });
    expect(provider.requests).toHaveLength(1);
  });

  it("closes a real active upload only after its handler and temp-file cleanup settle", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "cmfx-runtime-upload-close-"));
    const uploadTempRoot = resolve(root, "uploads");
    const provider = new RuntimeBlockingProvider();
    const runtime = await createServerRuntime({
      mode: "development",
      configureServer: true,
      listenHost: "127.0.0.1",
      publicOrigin: "http://127.0.0.1:5173",
      mediaRoot: resolve(root, "media"),
      uploadTempRoot,
      env: {
        NODE_ENV: "development",
        CODEMOTION_DEV_AUTH: "1",
        CODEMOTION_DEV_TENANT_ID: owner.tenantId,
        CODEMOTION_DEV_USER_ID: owner.userId,
        CODEMOTION_DEV_SCOPES: "assets:read assets:write ai:plan"
      },
      createAiPlans: (assets) => new AiPlanService(provider, assets)
    });
    vi.spyOn(runtime.auth, "authorize").mockResolvedValue(uploadPrincipal);
    const importStarted = deferred<string>();
    const importAborted = deferred();
    const releaseImport = deferred();
    vi.spyOn(runtime.mediaStore, "import").mockImplementation(async (_owner, options) => {
      importStarted.resolve(options.sourcePath);
      const aborted = async (): Promise<never> => {
        importAborted.resolve();
        await releaseImport.promise;
        throw new Error("runtime upload cancelled");
      };
      if (options.signal?.aborted) return aborted();
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => { void aborted().catch(reject); }, { once: true });
      });
    });

    let serverRequest: IncomingMessage | undefined;
    let serverResponse: ServerResponse | undefined;
    let handlerFailure: unknown;
    const handlerStarted = deferred<Promise<void>>();
    const server = createServer((request, response) => {
      serverRequest = request;
      serverResponse = response;
      const promise = runtime.handle(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
      promise.catch((failure) => { handlerFailure = failure; });
      handlerStarted.resolve(promise);
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const boundary = "cmfx-runtime-close-boundary";
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="active.png"\r\n`
      + "Content-Type: image/png\r\n\r\nactive upload bytes\r\n"
      + `--${boundary}--\r\n`
    );
    const uploadResponse = fetch(`${base}/api/media-assets`, {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        origin: "http://127.0.0.1:5173",
        "x-cmfx-csrf": "test"
      },
      body: new Uint8Array(body)
    });
    const tempPath = await importStarted.promise;
    await expect(stat(tempPath)).resolves.toBeDefined();

    const firstClose = runtime.close();
    const secondClose = runtime.close();
    const dispose = runtime.dispose();
    expect(secondClose).toBe(firstClose);
    expect(dispose).toBe(firstClose);
    await importAborted.promise;
    let closeSettled = false;
    void firstClose.then(() => { closeSettled = true; });
    await Promise.resolve();
    expect(closeSettled).toBe(false);

    releaseImport.resolve();
    const response = await uploadResponse;
    const handlerPromise = await handlerStarted.promise;
    await Promise.all([handlerPromise, firstClose, secondClose, dispose]);
    expect(response.status).toBe(499);
    expect(handlerFailure).toBeUndefined();
    expect(serverRequest?.complete).toBe(true);
    expect(serverResponse?.writableEnded).toBe(true);
    await expect(stat(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(uploadTempRoot).catch(() => [])).toEqual([]);
    await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  });
});
