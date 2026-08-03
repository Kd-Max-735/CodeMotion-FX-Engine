import { mkdtemp } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ProviderError,
  type AiPlanningInputV1,
  type ModelProvider,
  type UnderstandingRequest,
  type UnderstandingResult
} from "@codemotion/ai-planner";
import { AiPlanService, type AiSessionPrincipal } from "../src/ai-plan-service.js";
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
      writeDevLoginCode: () => undefined,
      createAiPlans: (assets) => new AiPlanService(provider, assets)
    });

    const created = await runtime.aiPlans.create(owner, planningInput);
    await provider.started.promise;
    const runtimeHasClose = typeof runtime.close === "function";
    const firstClose = runtime.close();
    const secondClose = runtime.close();
    const disposed = runtime.dispose();
    expect(secondClose).toBe(firstClose);
    expect(disposed).toBe(firstClose);
    await Promise.all([firstClose, secondClose, disposed]);

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
});
