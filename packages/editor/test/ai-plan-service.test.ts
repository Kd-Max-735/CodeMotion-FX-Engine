import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import {
  OfflineMockProvider,
  ProviderError,
  type AiPlanningInputV1,
  type ModelProvider,
  type UnderstandingRequest,
  type UnderstandingResult
} from "@codemotion/ai-planner";
import type { OwnerContext, VerifiedStoredMedia } from "@codemotion/exporter";
import {
  AiPlanService,
  createAiPlanApi,
  type AiAssetResolver,
  type AiSessionPrincipal
} from "../src/ai-plan-service.js";
import { AuthHttpError } from "../src/auth-session-service.js";

const ASSET_ID = "asset_aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ASSET_ID = "asset_bbbbbbbbbbbbbbbbbbbbbbbb";

function principal(
  tenantId = "tenant-a",
  userId = "user-a",
  scopes: readonly string[] = ["ai:plan"]
): AiSessionPrincipal {
  return { tenantId, userId, scopes };
}

function input(assets: AiPlanningInputV1["assets"] = []): AiPlanningInputV1 {
  return {
    contract: "ai-task/v1",
    prompt: "kinetic title",
    assets,
    canvas: { width: 640, height: 360, fps: 24 },
    durationSeconds: 1,
    style: ["kinetic"],
    brand: {
      colors: ["#112233"],
      tone: ["restrained"],
      requiredText: [],
      forbiddenContent: [],
      logoAssetIds: []
    }
  };
}

function verified(assetId: string, storedPath: string, type: "image" | "svg" = "image"): VerifiedStoredMedia {
  return {
    asset: {
      id: assetId,
      type,
      uri: `media://${assetId}`,
      hash: `sha256:${"a".repeat(64)}`,
      metadata: { mime: type === "svg" ? "image/svg+xml" : "image/png", bytes: 1 }
    },
    storedPath,
    trustedBytes: 1
  } as unknown as VerifiedStoredMedia;
}

class RecordingProvider implements ModelProvider {
  readonly id = "recording-provider";
  readonly requests: UnderstandingRequest[] = [];
  private readonly delegate = new OfflineMockProvider();

  async understand(request: UnderstandingRequest): Promise<UnderstandingResult> {
    this.requests.push(request);
    return this.delegate.understand(request);
  }
}

class BlockingProvider implements ModelProvider {
  readonly id = "blocking-provider";
  readonly requests: UnderstandingRequest[] = [];

  understand(request: UnderstandingRequest): Promise<UnderstandingResult> {
    this.requests.push(request);
    return new Promise((_resolve, reject) => {
      const abort = (): void => reject(new ProviderError("cancelled", "cancelled"));
      if (request.signal?.aborted) abort();
      else request.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

class OwnedAssetResolver implements AiAssetResolver {
  readonly calls: Array<{ owner: OwnerContext; assetId: string }> = [];
  diskReads = 0;
  private readonly records = new Map<string, VerifiedStoredMedia>();

  add(owner: OwnerContext, assetId: string, media: VerifiedStoredMedia): void {
    this.records.set(JSON.stringify([owner.tenantId, owner.userId, assetId]), media);
  }

  async resolve(owner: OwnerContext, assetId: string): Promise<VerifiedStoredMedia> {
    this.calls.push({ owner: { ...owner }, assetId });
    const record = this.records.get(JSON.stringify([owner.tenantId, owner.userId, assetId]));
    if (record === undefined) throw new Error("Asset not found or access denied.");
    this.diskReads += 1;
    return record;
  }
}

async function waitForTerminal(service: AiPlanService, owner: AiSessionPrincipal, id: string) {
  for (let turn = 0; turn < 1_000; turn += 1) {
    const task = service.get(owner, id);
    if (task.status !== "running" && task.status !== "cancelling") return task;
    await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
  }
  throw new Error("AI plan did not reach a terminal state within the deterministic turn budget.");
}

async function apiPost(
  service: AiPlanService,
  body: string,
  resolver?: Parameters<typeof createAiPlanApi>[1],
  verifyStateChange?: Parameters<typeof createAiPlanApi>[2]
): Promise<Response> {
  const handler = createAiPlanApi(service, resolver, verifyStateChange);
  const server = createServer((request, response) => {
    void handler(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}/api/ai-plans`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
    });
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    }));
  }
}

describe("AI plan server authorization and isolation", () => {
  it("rejects missing identity, resolver failure, and missing scope before body, assets, or provider", async () => {
    const provider = new RecordingProvider();
    const assets = new OwnedAssetResolver();
    const service = new AiPlanService(provider, assets);
    const malformedBody = "{not-json";

    const missing = await apiPost(service, malformedBody);
    const failed = await apiPost(service, malformedBody, async () => { throw new Error("resolver detail"); });
    const forbidden = await apiPost(service, malformedBody, () => principal("tenant-a", "user-a", []));
    const originRejected = await apiPost(service, malformedBody, () => principal());

    expect([missing.status, failed.status, forbidden.status, originRejected.status]).toEqual([401, 401, 403, 403]);
    expect(assets.calls).toEqual([]);
    expect(assets.diskReads).toBe(0);
    expect(provider.requests).toEqual([]);
  });

  it("checks session, scope, and request forgery before reading the POST body", async () => {
    const events: string[] = [];
    const service = new AiPlanService(new RecordingProvider(), new OwnedAssetResolver());
    const response = await apiPost(
      service,
      "{not-json",
      () => { events.push("session"); return principal(); },
      () => { events.push("csrf"); throw new AuthHttpError(403, "REQUEST_ORIGIN_REJECTED"); }
    );
    expect(response.status).toBe(403);
    expect(events).toEqual(["session", "csrf"]);
    expect(await response.json()).toMatchObject({ error: { code: "REQUEST_ORIGIN_REJECTED" } });
  });

  it("accepts only the closed ai-task/v1 body and generates the trusted task principal", async () => {
    const provider = new BlockingProvider();
    const assets = new OwnedAssetResolver();
    const service = new AiPlanService(provider, assets);
    const owner = principal();
    const forbiddenFields: Array<[string, unknown]> = [
      ["project", { schemaVersion: "1.1.0", assets: [] }],
      ["assetDefinition", { id: ASSET_ID, uri: "file:///secret" }],
      ["uri", "file:///secret"],
      ["hash", `sha256:${"f".repeat(64)}`],
      ["metadata", { bytes: 1 }],
      ["storageDirectory", "C:\\secret"],
      ["principal", owner],
      ["tenantId", "attacker"],
      ["userId", "attacker"],
      ["providerId", "other-provider"],
      ["apiKey", "credential"],
      ["taskId", "client-task"]
    ];
    for (const [field, value] of forbiddenFields) {
      await expect(service.create(owner, { ...input(), [field]: value })).rejects.toThrow("closed ai-task/v1");
    }
    expect(assets.calls).toEqual([]);
    expect(provider.requests).toEqual([]);

    const created = await service.create(owner, input());
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(provider.requests[0]?.principal).toEqual({
      tenantId: owner.tenantId,
      userId: owner.userId,
      taskId: created.id,
      scopes: ["ai:plan"]
    });
    service.cancel(owner, created.id);
    await waitForTerminal(service, owner, created.id);
  });

  it("resolves the same opaque assetId from each owner record and trusted tenant path", async () => {
    const provider = new BlockingProvider();
    const assets = new OwnedAssetResolver();
    const ownerA = principal("tenant-a", "user-shared");
    const ownerB = principal("tenant-b", "user-shared");
    assets.add(ownerA, ASSET_ID, verified(ASSET_ID, "C:\\trusted-a\\tenant-a\\asset.png"));
    assets.add(ownerB, ASSET_ID, verified(ASSET_ID, "C:\\trusted-b\\tenant-b\\asset.png"));
    const service = new AiPlanService(provider, assets);
    const withImage = input([{ assetId: ASSET_ID, purpose: "reference-image" }]);

    const [taskA, taskB] = await Promise.all([
      service.create(ownerA, withImage),
      service.create(ownerB, withImage)
    ]);
    expect(provider.requests.map((request) => request.resources?.[0]?.storageDirectory))
      .toEqual(["C:\\trusted-a\\tenant-a", "C:\\trusted-b\\tenant-b"]);
    expect(provider.requests.every((request) => request.resources?.[0]?.localAssetId === ASSET_ID)).toBe(true);
    service.cancel(ownerA, taskA.id);
    service.cancel(ownerB, taskB.id);
    await Promise.all([
      waitForTerminal(service, ownerA, taskA.id),
      waitForTerminal(service, ownerB, taskB.id)
    ]);
  });

  it("rejects a cross-tenant asset before trusted disk resolution and provider invocation", async () => {
    const provider = new RecordingProvider();
    const assets = new OwnedAssetResolver();
    const ownerA = principal("tenant-a", "user-a");
    const ownerB = principal("tenant-b", "user-b");
    assets.add(ownerB, OTHER_ASSET_ID, verified(OTHER_ASSET_ID, "C:\\trusted-b\\asset.png"));
    const service = new AiPlanService(provider, assets);

    await expect(service.create(ownerA, input([
      { assetId: OTHER_ASSET_ID, purpose: "reference-image" }
    ]))).rejects.toThrow("access denied");
    expect(assets.diskReads).toBe(0);
    expect(provider.requests).toEqual([]);
  });

  it("scopes list, get, cancel, Storyboard, DSL, preview, and trace to tenant plus user", async () => {
    const provider = new RecordingProvider();
    const service = new AiPlanService(provider, new OwnedAssetResolver());
    const owner = principal("tenant-a", "user-a");
    const otherTenant = principal("tenant-b", "user-a");
    const peer = principal("tenant-a", "user-b");
    const created = await service.create(owner, input());
    const completed = await waitForTerminal(service, owner, created.id);
    expect(completed.status).toBe("completed");
    expect(completed.result).toMatchObject({
      storyboard: expect.any(Object),
      dsl: expect.any(Object),
      preview: expect.any(Object),
      trace: expect.any(Object)
    });

    expect(service.list(owner).map((task) => task.id)).toEqual([created.id]);
    expect(service.list(otherTenant)).toEqual([]);
    expect(service.list(peer)).toEqual([]);
    for (const intruder of [otherTenant, peer]) {
      expect(() => service.get(intruder, created.id)).toThrow(/access denied|not found/i);
      expect(() => service.cancel(intruder, created.id)).toThrow(/access denied|not found/i);
    }
    expect(() => service.list(principal("tenant-a", "user-a", []))).toThrow("ai:plan");
  });

  it("enforces logo IDs as purpose=logo and maps an authorized SVG to image modality", async () => {
    const provider = new BlockingProvider();
    const assets = new OwnedAssetResolver();
    const owner = principal();
    assets.add(owner, ASSET_ID, verified(ASSET_ID, "C:\\trusted-a\\logo.svg", "svg"));
    const service = new AiPlanService(provider, assets);

    await expect(service.create(owner, {
      ...input([{ assetId: ASSET_ID, purpose: "reference-image" }]),
      brand: { ...input().brand, logoAssetIds: [ASSET_ID] }
    })).rejects.toThrow("purpose=logo");
    await expect(service.create(owner, input([
      { assetId: ASSET_ID, purpose: "reference-video" }
    ]))).rejects.toMatchObject({ code: "security" });
    expect(provider.requests).toEqual([]);
    const created = await service.create(owner, {
      ...input([{ assetId: ASSET_ID, purpose: "logo" }]),
      brand: { ...input().brand, logoAssetIds: [ASSET_ID] }
    });
    expect(provider.requests[0]?.resources?.[0]).toMatchObject({
      modality: "image",
      localAssetId: ASSET_ID,
      asset: { type: "svg" }
    });
    service.cancel(owner, created.id);
    await waitForTerminal(service, owner, created.id);
  });
});
