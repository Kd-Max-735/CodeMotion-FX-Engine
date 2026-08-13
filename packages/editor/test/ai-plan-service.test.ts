import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OfflineMockProvider,
  ProviderError,
  type AiPlanningInputV1,
  type ModelProvider,
  type UnderstandingRequest,
  type UnderstandingResult
} from "@codemotion/ai-planner";
import {
  MediaPreviewDecodeError,
  TenantMediaStore,
  runProcess,
  type OwnerContext,
  type VerifiedStoredMedia
} from "@codemotion/exporter";
import {
  AiPlanService,
  createAiPlanApi,
  type AiAssetResolver,
  type AiSessionPrincipal
} from "../src/ai-plan-service.js";
import { AuthHttpError } from "../src/auth-session-service.js";

const ASSET_ID = "asset_aaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_ASSET_ID = "asset_bbbbbbbbbbbbbbbbbbbbbbbb";
const THIRD_ASSET_ID = "asset_cccccccccccccccccccccccc";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

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

function verified(assetId: string, storedPath: string, type: "image" | "svg" | "video" = "image", duration?: number): VerifiedStoredMedia {
  return {
    asset: {
      id: assetId,
      type,
      uri: `media://${assetId}`,
      hash: `sha256:${"a".repeat(64)}`,
      metadata: { mime: type === "svg" ? "image/svg+xml" : type === "video" ? "video/mp4" : "image/png", bytes: 1, ...(duration === undefined ? {} : { duration }) }
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

class InvalidEffectProvider implements ModelProvider {
  readonly id = "invalid-effect-provider";

  async understand(request: UnderstandingRequest): Promise<UnderstandingResult> {
    const result = await new OfflineMockProvider().understand(request);
    return {
      ...result,
      storyboard: {
        ...result.storyboard,
        shots: result.storyboard.shots.map((shot) => ({
          ...shot,
          effects: shot.effects.map((effect) => ({ ...effect, effectId: "fx.invalid.notRegistered" }))
        }))
      }
    };
  }
}

class BlockingProvider implements ModelProvider {
  readonly id = "blocking-provider";
  readonly requests: UnderstandingRequest[] = [];
  aborted = false;

  understand(request: UnderstandingRequest): Promise<UnderstandingResult> {
    this.requests.push(request);
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

class ControlledAbortProvider implements ModelProvider {
  readonly id = "controlled-abort-provider";
  readonly requests: UnderstandingRequest[] = [];
  readonly abortSeen = deferred();
  readonly finishAbort = deferred();
  aborted = false;

  understand(request: UnderstandingRequest): Promise<UnderstandingResult> {
    this.requests.push(request);
    return new Promise((_resolve, reject) => {
      const abort = (): void => {
        this.aborted = true;
        this.abortSeen.resolve();
        void this.finishAbort.promise.then(() => reject(new ProviderError("cancelled", "cancelled")));
      };
      if (request.signal?.aborted) abort();
      else request.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}

class SavedProgressProvider implements ModelProvider {
  readonly id = "saved-progress-provider";
  readonly started = deferred();
  readonly requests: UnderstandingRequest[] = [];
  private readonly outcome = deferred<UnderstandingResult>();
  private request: UnderstandingRequest | undefined;

  understand(request: UnderstandingRequest): Promise<UnderstandingResult> {
    this.request = request;
    this.requests.push(request);
    this.started.resolve();
    const abort = (): void => this.outcome.reject(new ProviderError("cancelled", "cancelled"));
    if (request.signal?.aborted) abort();
    else request.signal?.addEventListener("abort", abort, { once: true });
    return this.outcome.promise;
  }

  emit(event: Parameters<NonNullable<UnderstandingRequest["onProgress"]>>[0]): void {
    this.request?.onProgress?.(event);
  }

  async succeed(): Promise<void> {
    if (this.request === undefined) throw new Error("Understanding request has not started.");
    const { onProgress: _onProgress, ...request } = this.request;
    const result = await new OfflineMockProvider().understand(request);
    this.outcome.resolve(result);
  }

  fail(error = new ProviderError("provider_unavailable", "failed")): void {
    this.outcome.reject(error);
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

class BarrierAssetResolver implements AiAssetResolver {
  readonly calls: Array<{ owner: OwnerContext; assetId: string; signal: AbortSignal | undefined }> = [];
  readonly started = deferred<AbortSignal | undefined>();
  readonly result = deferred<VerifiedStoredMedia>();

  async resolve(owner: OwnerContext, assetId: string, signal?: AbortSignal): Promise<VerifiedStoredMedia> {
    this.calls.push({ owner: { ...owner }, assetId, signal });
    this.started.resolve(signal);
    return this.result.promise;
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

async function waitForTerminalProcess(service: AiPlanService, owner: AiSessionPrincipal, id: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const task = service.get(owner, id);
    if (task.status !== "running" && task.status !== "cancelling") return task;
    await new Promise<void>((resolveTurn) => setTimeout(resolveTurn, 5));
  }
  throw new Error("AI plan did not reach a terminal state within 30 seconds.");
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

async function apiGet(
  service: AiPlanService,
  path: string,
  resolver: NonNullable<Parameters<typeof createAiPlanApi>[1]>
): Promise<Response> {
  const handler = createAiPlanApi(service, resolver);
  const server = createServer((request, response) => {
    void handler(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}${path}`);
  } finally {
    await new Promise<void>((resolveClose, rejectClose) => server.close((error) => {
      if (error) rejectClose(error);
      else resolveClose();
    }));
  }
}

describe("AI plan server authorization and isolation", () => {
  it("completes the vertical JPEG slide-in request with and without background audio", async () => {
    const fixtureRoot = resolve("tmp/media-preview-ai-plan-regression");
    const fixtureInput = resolve(fixtureRoot, "input");
    const jpegPath = resolve(fixtureInput, "portrait-yuvj444p.jpg");
    const audioPath = resolve(fixtureInput, "background.wav");
    await mkdir(fixtureInput, { recursive: true });
    await runProcess("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1242x2208:rate=1",
      "-frames:v", "1", "-vf", "format=yuvj444p", "-q:v", "2", jpegPath
    ]);
    await runProcess("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:a", "pcm_s16le", audioPath
    ]);
    const owner = principal("tenant-jpeg", "user-jpeg");
    const store = await new TenantMediaStore({
      storageRoot: resolve(fixtureRoot, "storage"),
      allowedRoots: [fixtureInput]
    }).initialize();
    const image = await store.import(owner, {
      sourcePath: jpegPath,
      claimedMime: "image/jpeg",
      displayName: "portrait.jpg"
    });
    const audio = await store.import(owner, {
      sourcePath: audioPath,
      claimedMime: "audio/wav",
      displayName: "background.wav"
    });
    expect(image.asset.metadata).toMatchObject({
      width: 1242,
      height: 2208,
      codec: "mjpeg",
      decodeVerified: true
    });

    for (const includeAudio of [false, true]) {
      const provider = new RecordingProvider();
      const service = new AiPlanService(provider, store);
      const created = await service.create(owner, {
        ...input([
          { assetId: image.asset.id, purpose: "reference-image" },
          ...(includeAudio ? [{ assetId: audio.asset.id, purpose: "reference-audio" as const }] : [])
        ]),
        prompt: "图片实现划入效果",
        selectedEffectId: "fx.motion.slide"
      });
      const completed = await waitForTerminalProcess(service, owner, created.id);
      expect(completed.status).toBe("completed");
      expect(completed.result?.storyboard.shots.flatMap((shot) => shot.effects)
        .map((effect) => effect.effectId)).toEqual(["fx.motion.slide"]);
      expect(completed.result?.preview).toMatchObject({ width: 160, height: 90, quality: "draft" });
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0]?.resources?.map((resource) => resource.modality))
        .toEqual(includeAudio ? ["image", "audio"] : ["image"]);
      await service.close();
    }
  }, 60_000);

  it("uses the explicit four-second prompt duration and hard-matches gaussian blur", async () => {
    const fixtureRoot = resolve("tmp/gaussian-duration-regression");
    const fixtureInput = resolve(fixtureRoot, "input");
    const imagePath = resolve(fixtureInput, "image.png");
    await mkdir(fixtureInput, { recursive: true });
    await runProcess("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=96x54:rate=1",
      "-frames:v", "1", imagePath
    ]);
    const provider = new RecordingProvider();
    const owner = principal();
    const store = await new TenantMediaStore({
      storageRoot: resolve(fixtureRoot, "storage"),
      allowedRoots: [fixtureInput]
    }).initialize();
    const image = await store.import(owner, {
      sourcePath: imagePath,
      claimedMime: "image/png",
      displayName: "image.png"
    });
    const service = new AiPlanService(provider, store);
    const created = await service.create(owner, {
      ...input([{ assetId: image.asset.id, purpose: "reference-image" }]),
      prompt: "实现柔和朦胧的效果，视频时长4秒",
      durationSeconds: 5
    });
    const completed = await waitForTerminalProcess(service, owner, created.id);
    expect(completed).toMatchObject({ status: "completed" });
    expect(provider.requests[0]?.planning?.durationSeconds).toBe(4);
    expect(completed.result?.editableProject.project.duration).toBe(4);
    expect(completed.result?.storyboard.shots.flatMap((shot) => shot.effects)
      .map((effect) => effect.effectId)).toEqual(["fx.post.gaussianBlur"]);
    await service.close();
  }, 60_000);

  it("maps media preview decode failures to a safe diagnostic task code", async () => {
    const secret = "internal ffmpeg stderr and storage path";
    const service = new AiPlanService(
      new RecordingProvider(),
      new OwnedAssetResolver(),
      async () => {
        throw new MediaPreviewDecodeError(
          "empty_output",
          160 * 90 * 4,
          0,
          secret,
          ["-v", "error", "-i", "C:\\private\\asset.jpg"]
        );
      }
    );
    const owner = principal();
    const created = await service.create(owner, input());
    const failed = await waitForTerminal(service, owner, created.id);
    expect(failed).toMatchObject({
      status: "failed",
      phase: "plan",
      error: {
        code: "media_preview_failed",
        retryable: false,
        message: "上传素材无法生成预览，请重新上传受支持的图片或视频。"
      }
    });
    expect(JSON.stringify(failed)).not.toContain(secret);
    expect(JSON.stringify(failed)).not.toContain("C:\\private");
  });

  it("records an invalid Provider effect with a specific safe subreason", async () => {
    const diagnostics: Array<{ reason?: string }> = [];
    const service = new AiPlanService(
      new InvalidEffectProvider(),
      new OwnedAssetResolver(),
      undefined,
      (record) => diagnostics.push(record)
    );
    const owner = principal();
    const created = await service.create(owner, input());
    const failed = await waitForTerminal(service, owner, created.id);
    expect(failed).toMatchObject({
      status: "failed",
      error: { code: "provider_response", problemCode: "EFFECT_ID_INVALID", retryable: true }
    });
    expect(diagnostics).toEqual([expect.objectContaining({ reason: "EFFECT_ID_INVALID" })]);
  });

  it("rejects product-invalid prompt-only, audio-only, and three-visual HTTP requests", async () => {
    const provider = new RecordingProvider();
    const service = new AiPlanService(provider, new OwnedAssetResolver());
    const authorize = () => principal();
    const allowStateChange = () => undefined;
    const cases = [
      input(),
      input([{ assetId: ASSET_ID, purpose: "reference-audio" }]),
      input([
        { assetId: ASSET_ID, purpose: "reference-image" },
        { assetId: OTHER_ASSET_ID, purpose: "reference-video" },
        { assetId: THIRD_ASSET_ID, purpose: "reference-image" }
      ])
    ];
    for (const body of cases) {
      const response = await apiPost(service, JSON.stringify(body), authorize, allowStateChange);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "AI_PLAN_REQUEST_REJECTED", retryable: false }
      });
    }
    expect(provider.requests).toEqual([]);
  });

  it("rejects selected-card count errors and a natural-language conflict before Provider use", async () => {
    const provider = new RecordingProvider();
    const assets = new OwnedAssetResolver();
    const service = new AiPlanService(provider, assets);
    const owner = principal();
    const fadeWithTwo = {
      ...input([
        { assetId: ASSET_ID, purpose: "reference-image" as const },
        { assetId: OTHER_ASSET_ID, purpose: "reference-video" as const }
      ]),
      selectedEffectId: "fx.motion.fade"
    };
    const wipeWithOne = {
      ...input([{ assetId: ASSET_ID, purpose: "reference-image" as const }]),
      selectedEffectId: "fx.transition.wipe"
    };
    await expect(service.create(owner, fadeWithTwo)).rejects.toThrow(/invalid visual asset count/u);
    await expect(service.create(owner, wipeWithOne)).rejects.toThrow(/invalid visual asset count/u);
    await expect(service.create(owner, {
      ...input([{ assetId: ASSET_ID, purpose: "reference-image" }]),
      prompt: "实现柔和朦胧的效果",
      selectedEffectId: "fx.light.neonGlow"
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(provider.requests).toEqual([]);
    expect(assets.calls).toEqual([]);
  });

  it("passes one-input fade and two-input wipe selections into the sole Provider as hard constraints", async () => {
    const provider = new BlockingProvider();
    const assets = new OwnedAssetResolver();
    const owner = principal();
    assets.add(owner, ASSET_ID, verified(ASSET_ID, "C:\\trusted-a\\first.png"));
    assets.add(owner, OTHER_ASSET_ID, verified(OTHER_ASSET_ID, "C:\\trusted-a\\second.png"));
    const service = new AiPlanService(provider, assets);
    const fade = await service.create(owner, {
      ...input([{ assetId: ASSET_ID, purpose: "reference-image" }]),
      prompt: "让整张图片淡入",
      selectedEffectId: "fx.motion.fade"
    });
    const wipe = await service.create(owner, {
      ...input([
        { assetId: ASSET_ID, purpose: "reference-image" },
        { assetId: OTHER_ASSET_ID, purpose: "reference-image" }
      ]),
      prompt: "从第一张图片线性擦除切换到第二张图片",
      selectedEffectId: "fx.transition.wipe"
    });
    expect(provider.requests.map((request) => request.planning?.selectedEffectId))
      .toEqual(["fx.motion.fade", "fx.transition.wipe"]);
    service.cancel(owner, fade.id);
    service.cancel(owner, wipe.id);
    await Promise.all([waitForTerminal(service, owner, fade.id), waitForTerminal(service, owner, wipe.id)]);
  });

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

  it("keeps Provider response bodies and validation details out of browser task errors", async () => {
    const provider = new SavedProgressProvider();
    const service = new AiPlanService(provider, new OwnedAssetResolver());
    const owner = principal();
    const created = await service.create(owner, input());
    const secret = "RAW_MODEL_BODY_AND_AJV_DETAILS";
    provider.fail(new ProviderError("provider_response", `${secret}: /storyboard/layers must match schema`));
    const failed = await waitForTerminal(service, owner, created.id);
    expect(failed).toMatchObject({
      status: "failed",
      error: { code: "provider_response", retryable: false }
    });
    expect(JSON.stringify(failed)).not.toContain(secret);
    expect(JSON.stringify(failed)).not.toContain("/storyboard/layers");
  });

  it("scopes safe completed results to tenant plus user without raw DSL or trace", async () => {
    const provider = new RecordingProvider();
    const service = new AiPlanService(provider, new OwnedAssetResolver());
    const owner = principal("tenant-a", "user-a");
    const otherTenant = principal("tenant-b", "user-a");
    const peer = principal("tenant-a", "user-b");
    const created = await service.create(owner, input());
    const completed = await waitForTerminal(service, owner, created.id);
    expect(completed.status).toBe("completed");
    expect(completed.result).toMatchObject({
      contract: "ai-plan-result/v2",
      storyboard: expect.any(Object),
      editableProject: expect.objectContaining({ contract: "browser-project/v1" }),
      preview: expect.objectContaining({ width: 160, height: 90, quality: "draft" })
    });
    expect(completed.result).not.toHaveProperty("dsl");
    expect(completed.result).not.toHaveProperty("trace");
    expect(completed.result).not.toHaveProperty("understanding");

    const response = await apiGet(service, `/api/ai-plans/${created.id}`, () => owner);
    const json = await response.json() as { task: Record<string, unknown> };
    expect(response.status).toBe(200);
    expect(Object.keys(json.task).sort()).toEqual([
      "createdAt", "events", "id", "modalities", "phase", "result", "status", "updatedAt"
    ]);
    expect(JSON.stringify(json)).not.toMatch(/"(?:dsl|understanding|trace|provider|principal|resources|input)"/i);
    expect(json.task.result).toMatchObject({ contract: "ai-plan-result/v2" });

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

describe("AI plan authoritative duration", () => {
  it("prefers a six-second description over the five-second field and falls back to the field", async () => {
    const provider = new RecordingProvider();
    const resolver: AiAssetResolver = { resolve: async (_owner, assetId) => verified(assetId, `C:/media/${assetId}.png`) };
    const service = new AiPlanService(provider, resolver);
    for (const [prompt, expected] of [
      ["在图片上使用打字机特效，输出视频时长为6秒", 6],
      ["在图片上使用打字机特效", 5]
    ] as const) {
      const created = await service.create(principal(), {
        ...input([{ assetId: ASSET_ID, purpose: "reference-image" }]),
        prompt,
        durationSeconds: 5,
        selectedEffectId: "fx.text.typewriter"
      });
      await waitForTerminalProcess(service, principal(), created.id);
      expect(provider.requests.at(-1)?.planning?.durationSeconds).toBe(expected);
    }
    await service.close();
  });

  it("rejects malformed description durations and durations beyond a verified video", async () => {
    const provider = new RecordingProvider();
    const videoResolver: AiAssetResolver = { resolve: async (_owner, assetId) => verified(assetId, `C:/media/${assetId}.mp4`, "video", 4) };
    const service = new AiPlanService(provider, videoResolver);
    await expect(service.create(principal(), {
      ...input([{ assetId: ASSET_ID, purpose: "reference-video" }]),
      prompt: "输出视频时长为很多秒",
      durationSeconds: 3
    })).rejects.toMatchObject({ code: "AI_DURATION_INVALID" });
    await expect(service.create(principal(), {
      ...input([{ assetId: ASSET_ID, purpose: "reference-video" }]),
      prompt: "输出视频时长为 6 秒",
      durationSeconds: 3
    })).rejects.toMatchObject({ code: "AI_DURATION_EXCEEDS_VIDEO" });
    expect(provider.requests).toHaveLength(0);
    await service.close();
  });
});

describe("AI plan service lifecycle", () => {
  it("aborts an active Provider and waits for its run to reach a terminal state", async () => {
    const provider = new ControlledAbortProvider();
    const service = new AiPlanService(provider, new OwnedAssetResolver());
    const owner = principal();
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on("unhandledRejection", recordUnhandled);
    try {
      const created = await service.create(owner, input());
      expect(provider.requests).toHaveLength(1);

      let closeSettled = false;
      const first = service.close();
      const second = service.close();
      const disposed = service.dispose();
      expect(second).toBe(first);
      expect(disposed).toBe(first);
      void first.then(() => { closeSettled = true; });
      await provider.abortSeen.promise;
      await Promise.resolve();
      expect(provider.aborted).toBe(true);
      expect(closeSettled).toBe(false);
      expect(service.get(owner, created.id).status).toBe("cancelling");

      provider.finishAbort.resolve();
      await Promise.all([first, second, disposed]);
      expect(closeSettled).toBe(true);
      expect(service.get(owner, created.id).status).toBe("cancelled");
      expect(service.list(owner).every((task) => task.status !== "running" && task.status !== "cancelling")).toBe(true);
      await Promise.resolve();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", recordUnhandled);
    }
  });

  it("rejects create after close before asset resolution or Provider invocation", async () => {
    const provider = new BlockingProvider();
    const assets = new OwnedAssetResolver();
    const service = new AiPlanService(provider, assets);
    await service.close();

    await expect(service.create(principal(), input([
      { assetId: ASSET_ID, purpose: "reference-image" }
    ]))).rejects.toMatchObject({ code: "cancelled" });
    expect(assets.calls).toEqual([]);
    expect(assets.diskReads).toBe(0);
    expect(provider.requests).toEqual([]);
  });

  it("waits for an in-flight asset resolver and prevents Provider startup after close begins", async () => {
    const provider = new BlockingProvider();
    const assets = new BarrierAssetResolver();
    const service = new AiPlanService(provider, assets);
    const owner = principal();
    const creating = service.create(owner, input([{ assetId: ASSET_ID, purpose: "reference-image" }]));
    const signal = await assets.started.promise;

    let closeSettled = false;
    const closing = service.close().then(() => { closeSettled = true; });
    expect(signal?.aborted).toBe(true);
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    assets.result.resolve(verified(ASSET_ID, "C:\\trusted-a\\asset.png"));

    await expect(creating).rejects.toMatchObject({ code: "cancelled" });
    await closing;
    expect(closeSettled).toBe(true);
    expect(provider.requests).toEqual([]);
    expect(service.list(owner)).toEqual([]);
  });

  it("uses the task signal to stop planAnimation after understand has completed", async () => {
    const provider = new RecordingProvider();
    const plannerStarted = deferred<AbortSignal>();
    const service = new AiPlanService(provider, new OwnedAssetResolver(), async (_result, options) => {
      const signal = options?.signal;
      if (signal === undefined) throw new Error("Planner signal is required.");
      plannerStarted.resolve(signal);
      return new Promise<never>((_resolve, reject) => {
        const abort = (): void => reject(new ProviderError("cancelled", "cancelled"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    });
    const owner = principal();
    const created = await service.create(owner, input());
    const plannerSignal = await plannerStarted.promise;

    expect(service.get(owner, created.id).phase).toBe("plan");
    expect(provider.requests[0]?.signal).toBe(plannerSignal);
    await service.close();
    expect(plannerSignal.aborted).toBe(true);
    expect(service.get(owner, created.id).status).toBe("cancelled");
  });
});

describe("AI plan Provider progress lifetime", () => {
  const late = { phase: "upload" as const, loaded: 99, total: 100 };

  function expectLateProgressIgnored(
    service: AiPlanService,
    provider: SavedProgressProvider,
    owner: AiSessionPrincipal,
    id: string
  ) {
    const before = service.get(owner, id);
    provider.emit(late);
    const after = service.get(owner, id);
    expect(after).toEqual(before);
    return { before, after };
  }

  it("records valid progress but freezes the cancelled view after close completes", async () => {
    const provider = new SavedProgressProvider();
    const service = new AiPlanService(provider, new OwnedAssetResolver());
    const owner = principal();
    const created = await service.create(owner, input());
    await provider.started.promise;
    provider.emit({ phase: "infer", loaded: 1, total: 2 });
    expect(service.get(owner, created.id)).toMatchObject({
      status: "running",
      phase: "infer",
      progress: { phase: "infer", loaded: 1, total: 2 },
      events: [{ phase: "infer", loaded: 1, total: 2 }]
    });

    await service.close();
    const { before, after } = expectLateProgressIgnored(service, provider, owner, created.id);
    expect({
      statusBeforeLateProgress: before.status,
      statusAfterLateProgress: after.status,
      terminalViewChangedAfterClose: JSON.stringify(before) !== JSON.stringify(after),
      phaseChanged: before.phase !== after.phase,
      eventsChanged: JSON.stringify(before.events) !== JSON.stringify(after.events),
      progressChanged: JSON.stringify(before.progress) !== JSON.stringify(after.progress),
      updatedAtChanged: before.updatedAt !== after.updatedAt
    }).toEqual({
      statusBeforeLateProgress: "cancelled",
      statusAfterLateProgress: "cancelled",
      terminalViewChangedAfterClose: false,
      phaseChanged: false,
      eventsChanged: false,
      progressChanged: false,
      updatedAtChanged: false
    });
  });

  it("ignores saved Provider progress after a normal user cancellation", async () => {
    const provider = new SavedProgressProvider();
    const service = new AiPlanService(provider, new OwnedAssetResolver());
    const owner = principal();
    const created = await service.create(owner, input());
    await provider.started.promise;
    service.cancel(owner, created.id);
    expect((await waitForTerminal(service, owner, created.id)).status).toBe("cancelled");
    expectLateProgressIgnored(service, provider, owner, created.id);
  });

  it("ignores saved Provider progress after completed and failed terminal states", async () => {
    const owner = principal();
    const completedProvider = new SavedProgressProvider();
    const completedService = new AiPlanService(completedProvider, new OwnedAssetResolver());
    const completed = await completedService.create(owner, input());
    await completedProvider.started.promise;
    await completedProvider.succeed();
    expect((await waitForTerminal(completedService, owner, completed.id)).status).toBe("completed");
    expectLateProgressIgnored(completedService, completedProvider, owner, completed.id);

    const failedProvider = new SavedProgressProvider();
    const failedService = new AiPlanService(failedProvider, new OwnedAssetResolver());
    const failed = await failedService.create(owner, input());
    await failedProvider.started.promise;
    failedProvider.fail();
    expect((await waitForTerminal(failedService, owner, failed.id)).status).toBe("failed");
    expectLateProgressIgnored(failedService, failedProvider, owner, failed.id);
  });

  it("closes the Provider progress window while planAnimation is still running", async () => {
    const provider = new SavedProgressProvider();
    const plannerStarted = deferred<AbortSignal>();
    const service = new AiPlanService(provider, new OwnedAssetResolver(), async (_result, options) => {
      const signal = options?.signal;
      if (signal === undefined) throw new Error("Planner signal is required.");
      plannerStarted.resolve(signal);
      return new Promise<never>((_resolve, reject) => {
        const abort = (): void => reject(new ProviderError("cancelled", "cancelled"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      });
    });
    const owner = principal();
    const created = await service.create(owner, input());
    await provider.started.promise;
    await provider.succeed();
    await plannerStarted.promise;
    expect(service.get(owner, created.id).phase).toBe("plan");
    expectLateProgressIgnored(service, provider, owner, created.id);
    await service.close();
  });

  it("ignores progress racing with close and remains frozen after close returns", async () => {
    const provider = new SavedProgressProvider();
    const service = new AiPlanService(provider, new OwnedAssetResolver());
    const owner = principal();
    const created = await service.create(owner, input());
    await provider.started.promise;
    provider.emit({ phase: "process", loaded: 1, total: 3 });

    const closing = service.close();
    provider.emit({ phase: "infer", loaded: 999, total: 1_000 });
    await closing;
    const terminal = service.get(owner, created.id);
    expect(terminal.status).toBe("cancelled");
    expect(terminal.events).not.toContainEqual({ phase: "infer", loaded: 999, total: 1_000 });
    expectLateProgressIgnored(service, provider, owner, created.id);
  });
});
