import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  EFFECT_TOOL_REGISTRY,
  EffectToolRegistry,
  executeSelectedEffectTool,
  type AuthorizedEffectInputs,
  type EffectToolDefinition
} from "@codemotion/effect-functions";
import type {
  SelectedToolConversationProvider,
  SelectedToolModelTurn,
  SelectedToolNativeCall,
  SelectedToolParameterProvider,
  SelectedToolParameterRequest
} from "@codemotion/ai-planner";
import type { ApplicationScope } from "@codemotion/schema";
import type { ExportOptions, VerifiedStoredMedia } from "@codemotion/exporter";
import {
  AuthHttpError,
  type AuthenticatedSessionPrincipal
} from "../src/auth-session-service.js";
import {
  EffectToolService,
  TenantMediaEffectToolInputResolver,
  createEffectToolApi,
  type EffectToolInputIds,
  type EffectToolInputResolver,
  type EffectToolPrincipal,
  type EffectToolRenderSettings
} from "../src/effect-tool-service.js";
import { EffectToolVideoService } from "../src/effect-tool-video-service.js";

const principal: EffectToolPrincipal = {
  tenantId: "tenant-effect-tools",
  userId: "user-effect-tools",
  scopes: ["ai:plan", "project:preview"]
};

class RecordingProvider implements SelectedToolParameterProvider {
  readonly id = "recording-selected-tool-provider";
  readonly requests: SelectedToolParameterRequest[] = [];
  output: unknown = undefined;

  generate(request: SelectedToolParameterRequest): Promise<unknown> {
    this.requests.push(request);
    const data = request.toolName === "fade"
      ? { from: 0, to: 1, duration: 1.2, easing: "easeOut" }
      : {};
    return Promise.resolve(this.output ?? { type: request.toolName, data });
  }
}

class NativeRecordingProvider extends RecordingProvider implements SelectedToolConversationProvider {
  readonly finalizations: Array<{
    request: SelectedToolParameterRequest;
    call: SelectedToolNativeCall;
    result: Readonly<Record<string, unknown>>;
  }> = [];
  turn: SelectedToolModelTurn = {
    reasoningContent: "用户只询问参数含义，不需要执行。",
    content: "temporal 控制颗粒随帧变化的活跃程度。"
  };

  respond(request: SelectedToolParameterRequest): Promise<SelectedToolModelTurn> {
    this.requests.push(request);
    return Promise.resolve(this.turn);
  }

  finalize(
    request: SelectedToolParameterRequest,
    call: SelectedToolNativeCall,
    result: Readonly<Record<string, unknown>>
  ): Promise<SelectedToolModelTurn> {
    this.finalizations.push({ request, call, result });
    return Promise.resolve({
      reasoningContent: "工具任务已创建，可以给出最终回复。",
      content: "已开始生成 1 秒的动态胶片颗粒视频。"
    });
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

class BlockingProvider implements SelectedToolParameterProvider {
  readonly id = "blocking-selected-tool-provider";
  readonly calls: Array<{
    request: SelectedToolParameterRequest;
    result: ReturnType<typeof deferred<unknown>>;
  }> = [];

  generate(request: SelectedToolParameterRequest): Promise<unknown> {
    const result = deferred<unknown>();
    this.calls.push({ request, result });
    request.signal?.addEventListener("abort", () => result.reject(request.signal?.reason), { once: true });
    return result.promise;
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Condition was not reached within the deterministic turn budget.");
}

async function testVideoService() {
  const outputRoot = await mkdtemp(join(tmpdir(), "cmfx-effect-video-"));
  const media: VerifiedStoredMedia = {
    asset: {
      id: "asset_imageabcdefgh",
      type: "image",
      uri: "media://image.png",
      hash: "sha256:test-image",
      metadata: {
        mime: "image/png", width: 2, height: 2, codec: "png"
      }
    },
    descriptor: { id: "asset_imageabcdefgh", type: "media/image", cacheKey: "test-image", metadata: {} },
    storedPath: join(outputRoot, "source.png"),
    arkEligibility: { filesApi: false, videoTos: false, base64OrUrl: false, reason: "test" },
    trustedBytes: 128
  };
  const exportFrames = vi.fn(async (options: ExportOptions) => {
    await options.renderFrame({
      frame: 0,
      time: 0,
      deltaTime: 0,
      fps: options.preset.settings.fps,
      width: options.preset.settings.width,
      height: options.preset.settings.height
    }, options.signal);
    await writeFile(options.outputPath, "test-mp4-output");
    return { outputPath: options.outputPath, frameCount: 1, inspections: [], encoder: "libx264" };
  });
  const decodeFrame = vi.fn(async () => new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255
  ]));
  const service = new EffectToolVideoService({
    media: { resolve: vi.fn(async () => media) },
    outputRoot,
    exportFrames: exportFrames as never,
    decodeFrame: decodeFrame as never,
    durationSeconds: 1 / 30,
    fps: 30,
    gpuSampler: vi.fn(async () => ({
      name: "Test NVIDIA GPU",
      memoryUsedMiB: 256,
      memoryTotalMiB: 8_192,
      utilizationPercent: 42
    }))
  });
  return { service, exportFrames, decodeFrame };
}

function rasterBinding() {
  const data = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 255, 255
  ]);
  return {
    surface: { width: 2, height: 2, data, colorSpace: "srgb", alphaMode: "straight" },
    rasterInput: {
      layerId: "single-tool-test-layer",
      layerType: "image",
      source: {
        kind: "image",
        assetId: "asset_testsource",
        assetHash: "sha256:test-source-fixture",
        frameTime: 0,
        pixels: {
          width: 2, height: 2, data, colorSpace: "srgb", alphaMode: "straight", rowOrder: "top-to-bottom"
        }
      },
      time: {
        contractVersion: "1.1.0", layerId: "single-tool-test-layer", active: true,
        projectTime: 0, localTime: 0, sourceTime: 0, deltaTime: 1 / 30
      },
      transform: { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], anchor: [0, 0] },
      opacity: 1,
      masks: [],
      target: {
        width: 2, height: 2, format: "rgba8", colorSpace: "srgb", samples: 1, usage: "input"
      }
    }
  };
}

class TestInputResolver implements EffectToolInputResolver {
  calls = 0;
  wrongOwner = false;

  resolve(
    owner: EffectToolPrincipal,
    definition: EffectToolDefinition,
    inputIds: EffectToolInputIds,
    render: EffectToolRenderSettings
  ): Promise<AuthorizedEffectInputs> {
    this.calls += 1;
    for (const slot of definition.inputSlots) {
      if (slot.required && inputIds[slot.name] === undefined && Object.keys(inputIds).length === 0) {
        throw new TypeError(`Required input slot ${slot.name} is missing.`);
      }
    }
    if (definition.toolName === "depth_of_field") {
      const pixels = new Uint8Array(render.width * render.height * 4).fill(255);
      const depth = new Float32Array(render.width * render.height).fill(0.5);
      return Promise.resolve(Object.freeze({
        source_frame: Object.freeze({
          slot: "source_frame",
          kind: "image" as const,
          tenantId: owner.tenantId,
          userId: owner.userId,
          locked: true as const,
          binding: { width: render.width, height: render.height, data: pixels }
        }),
        depth_field: Object.freeze({
          slot: "depth_field",
          kind: "depth-map" as const,
          tenantId: owner.tenantId,
          userId: owner.userId,
          locked: true as const,
          binding: { width: render.width, height: render.height, data: depth }
        })
      }));
    }
    if (definition.toolName === "film_grain") {
      return Promise.resolve(Object.freeze({
        source_frame: Object.freeze({
          slot: "source_frame",
          kind: "image" as const,
          tenantId: this.wrongOwner ? "tenant-other" : owner.tenantId,
          userId: owner.userId,
          locked: true as const,
          binding: {
            width: render.width,
            height: render.height,
            data: new Uint8Array(render.width * render.height * 4).fill(255)
          }
        })
      }));
    }
    const requiredImage = definition.inputSlots.find((slot) => slot.required && slot.kind === "image");
    if (requiredImage !== undefined) {
      return Promise.resolve(Object.freeze({
        [requiredImage.name]: Object.freeze({
          slot: requiredImage.name,
          kind: "image" as const,
          tenantId: this.wrongOwner ? "tenant-other" : owner.tenantId,
          userId: owner.userId,
          locked: true as const,
          binding: {
            width: render.width,
            height: render.height,
            data: new Uint8Array(render.width * render.height * 4).fill(255)
          }
        })
      }));
    }
    if (definition.toolName !== "fade") return Promise.resolve(Object.freeze({}));
    return Promise.resolve(Object.freeze({
      source_layer: Object.freeze({
        slot: "source_layer",
        kind: "data" as const,
        tenantId: this.wrongOwner ? "tenant-other" : owner.tenantId,
        userId: owner.userId,
        locked: true as const,
        binding: rasterBinding()
      })
    }));
  }
}

function authenticated(): AuthenticatedSessionPrincipal {
  return {
    ...principal,
    scopes: ["ai:plan", "project:preview"],
    issuer: "urn:test",
    audience: "test",
    issuedAt: 1,
    expiresAt: 2_000_000_000,
    sessionId: "effect-tool-session-012345678901234567890123",
    authSource: "local-dev-session"
  };
}

async function withApi<T>(
  service: EffectToolService,
  auth: Parameters<typeof createEffectToolApi>[1],
  run: (baseUrl: string) => Promise<T>
): Promise<T> {
  const handler = createEffectToolApi(service, auth);
  const server = createServer((request, response) => {
    void handler(request, response, () => {
      response.statusCode = 404;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("server single effect-tool service", () => {
  it("executes one existing adapter and one new definition through the server service", async () => {
    const provider = new RecordingProvider();
    const inputs = new TestInputResolver();
    const service = new EffectToolService(provider, inputs);

    const existing = await service.execute(principal, {
      toolName: "fade",
      prompt: "快速淡入",
      inputIds: { source_layer: "asset_abcdefgh" },
      render: { width: 2, height: 2, time: 0.5 }
    });
    const added = await service.execute(principal, {
      toolName: "particle_spark",
      prompt: "轻微火花",
      inputIds: { background_image: "asset_abcdefgh" },
      render: { width: 32, height: 18, time: 0.1 }
    });

    expect(service.list()).toHaveLength(120);
    expect(existing).toMatchObject({ toolName: "fade", result: { kind: "frame", degraded: false } });
    expect(existing.result.output).toMatchObject({ width: 2, height: 2, byteLength: 16 });
    expect(added).toMatchObject({ toolName: "particle_spark", result: { kind: "texture" } });
    expect(provider.requests.map((request) => request.toolName)).toEqual(["fade", "particle_spark"]);
    expect(provider.requests[0]!.fieldSpec).toContain("# 淡入淡出 `fade`");
    expect(provider.requests[1]!.fieldSpec).toContain("`particle_spark`");
    expect(() => service.get({ ...principal, tenantId: "tenant-other" }, added.id)).toThrow(/access denied/u);
  });

  it("rejects mismatched type, unknown model fields, missing inputs, and wrong-owner bindings", async () => {
    const provider = new RecordingProvider();
    const inputs = new TestInputResolver();
    const service = new EffectToolService(provider, inputs);

    provider.output = { type: "fade", data: {} };
    await expect(service.execute(principal, {
      toolName: "particle_spark", prompt: "火花", inputIds: { background_image: "asset_abcdefgh" }
    })).rejects.toMatchObject({ code: "TYPE_MISMATCH" });

    provider.output = { type: "particle_spark", data: { assetId: "asset_abcdefgh" } };
    await expect(service.execute(principal, {
      toolName: "particle_spark", prompt: "火花", inputIds: { background_image: "asset_abcdefgh" }
    })).rejects.toMatchObject({ code: "RESOURCE_INJECTION" });

    provider.output = { type: "particle_spark", data: { rogue: 1 } };
    await expect(service.execute(principal, {
      toolName: "particle_spark", prompt: "火花", inputIds: { background_image: "asset_abcdefgh" }
    })).rejects.toMatchObject({ code: "PARAMETER_INVALID" });

    provider.output = undefined;
    const beforeMissing = provider.requests.length;
    await expect(service.execute(principal, {
      toolName: "fade", prompt: "淡入", inputIds: {}
    })).rejects.toThrow(/Required input slot source_layer is missing/u);
    expect(provider.requests).toHaveLength(beforeMissing);

    inputs.wrongOwner = true;
    await expect(service.execute(principal, {
      toolName: "fade", prompt: "淡入", inputIds: { source_layer: "asset_abcdefgh" }
    })).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
  });

  it("invokes the selected render function exactly once for a legal request", async () => {
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("particle_spark")!;
    const render = vi.fn(definition.render.bind(definition));
    const registry = new EffectToolRegistry([{ ...definition, render }]);
    const service = new EffectToolService(new RecordingProvider(), new TestInputResolver(), registry);

    await service.execute(principal, {
      toolName: "particle_spark", prompt: "火花", inputIds: { background_image: "asset_abcdefgh" }
    });
    expect(render).toHaveBeenCalledOnce();
  });

  it("returns natural text without rendering or executes the sole film_grain native tool call", async () => {
    const provider = new NativeRecordingProvider();
    const inputs = new TestInputResolver();
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("film_grain")!;
    const render = vi.fn(definition.render.bind(definition));
    const registry = new EffectToolRegistry([{ ...definition, render }]);
    const video = await testVideoService();
    const service = new EffectToolService(provider, inputs, registry, video.service);

    await expect(service.turn(principal, {
      prompt: "temporal 参数有什么作用？",
      inputIds: {}
    })).resolves.toEqual({
      kind: "message",
      reasoningContent: "用户只询问参数含义，不需要执行。",
      content: "temporal 控制颗粒随帧变化的活跃程度。"
    });
    expect(inputs.calls).toBe(0);
    expect(render).not.toHaveBeenCalled();

    provider.turn = {
      reasoningContent: "用户要求实际添加粗粝的暗部胶片颗粒。",
      content: "将添加粗粝的单色 16mm 胶片颗粒。",
      toolCall: {
        id: "call-film-grain-1",
        name: "film_grain",
        arguments: {
          effectParams: {
            amount: 0.32,
            size: 4,
            monochrome: true,
            response: "shadows",
            temporal: 0.8
          },
          output: { durationSeconds: 1, generationMode: "fast" }
        }
      }
    };
    const turn = await service.turn(principal, {
      prompt: "添加粗粝的16mm胶片颗粒",
      inputIds: { source_image: "asset_imageabcdefgh" }
    });
    expect(turn).toMatchObject({
      kind: "tool_call",
      toolCall: {
        type: "function",
        function: {
          name: "film_grain",
          arguments: {
            effectParams: { amount: 0.32, size: 4, response: "shadows" },
            output: { durationSeconds: 1, generationMode: "fast" }
          }
        }
      },
      content: "已开始生成 1 秒的动态胶片颗粒视频。",
      executionInput: {
        source_image: "asset_imageabcdefgh",
        effectParams: { amount: 0.32, size: 4, response: "shadows" },
        output: { durationSeconds: 1, generationMode: "fast", fps: 15, format: "mp4" }
      },
      execution: {
        toolName: "film_grain",
        source: { kind: "image", assetId: "asset_imageabcdefgh" },
        video: { format: "mp4", mime: "video/mp4", width: 2, height: 2, fps: 15, frameCount: 15 }
      }
    });
    if (turn.kind !== "tool_call") throw new Error("Expected a tool call.");
    await waitFor(() => service.videoExecution(principal, turn.execution.id).status === "completed");
    expect(service.videoExecution(principal, turn.execution.id)).toMatchObject({
      status: "completed",
      video: { progress: 1, completedFrames: 15, bytes: 15 },
      gpu: { available: true, memoryUsedMiB: 256, peakMemoryUsedMiB: 256 }
    });
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests.every((request) => request.toolName === "film_grain")).toBe(true);
    expect(provider.requests[0]!.fieldSpec).toContain("# 胶片颗粒（film_grain）");
    expect(inputs.calls).toBe(0);
    expect(render).toHaveBeenCalledOnce();
    expect(video.decodeFrame).toHaveBeenCalledOnce();
    expect(provider.finalizations).toHaveLength(1);
    expect(provider.finalizations[0]).toMatchObject({
      call: { name: "film_grain", arguments: { output: { durationSeconds: 1, generationMode: "fast" } } },
      result: {
        status: "queued",
        output: { durationSeconds: 1, generationMode: "fast", fps: 15, format: "mp4" }
      }
    });
  });

  it("runs a Registry-selected native turn and preserves its exact tool identity", async () => {
    const provider = new NativeRecordingProvider();
    const inputs = new TestInputResolver();
    const video = await testVideoService();
    const service = new EffectToolService(provider, inputs, EFFECT_TOOL_REGISTRY, video.service);
    await expect(service.selectedTurn(principal, {
      toolName: "particle_spark",
      prompt: "这个工具有哪些参数？",
      inputIds: {}
    })).resolves.toMatchObject({
      kind: "message",
      tool: { toolName: "particle_spark", displayName: "火花粒子" },
      content: "temporal 控制颗粒随帧变化的活跃程度。"
    });
    expect(inputs.calls).toBe(0);
    expect(provider.requests[0]).toMatchObject({ toolName: "particle_spark" });
    expect(provider.requests[0]!.fieldSpec).toContain("`particle_spark`");
    expect(provider.requests[0]!.fieldSpec).not.toContain("film_grain");

    provider.turn = {
      reasoningContent: "用户要求执行当前选择的胶片颗粒工具。",
      content: "准备调用当前工具。",
      toolCall: {
        id: "call-selected-film-grain",
        name: "film_grain",
        arguments: {
          effectParams: { amount: 0.2, size: 2, monochrome: true, response: "uniform", temporal: 0.5 },
          output: { durationSeconds: 1 }
        }
      }
    };

    const turn = await service.selectedTurn(principal, {
      toolName: "film_grain",
      prompt: "生成一秒胶片颗粒视频",
      inputIds: { source_frame: "asset_imageabcdefgh" }
    });
    expect(turn).toMatchObject({
      kind: "tool_call",
      tool: { toolName: "film_grain", displayName: "胶片颗粒", category: "post" },
      toolCall: { function: { name: "film_grain" } },
      executionInput: {
        authorizedInputs: [{ name: "source_frame", kind: "image", count: 1 }]
      },
      execution: { toolName: "film_grain", status: "queued" }
    });
    if (turn.kind !== "tool_call") throw new Error("Expected a tool call.");
    await waitFor(() => service.videoExecution(principal, turn.execution.id).status === "completed");
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]).toMatchObject({ toolName: "film_grain" });
    expect(provider.requests[1]!.fieldSpec).toContain("# 胶片颗粒（film_grain）");
    expect(inputs.calls).toBe(1);

    provider.turn = {
      ...provider.turn,
      toolCall: { ...provider.turn.toolCall!, name: "Film_Grain" }
    };
    await expect(service.selectedTurn(principal, {
      toolName: "film_grain",
      prompt: "再次执行",
      inputIds: { source_frame: "asset_imageabcdefgh" }
    })).rejects.toMatchObject({ code: "security" });
  });

  it("passes server-derived material dimensions into the selected-tool video task", async () => {
    const provider = new NativeRecordingProvider();
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("film_grain")!;
    provider.turn = {
      reasoningContent: "需要执行胶片颗粒。",
      content: "开始执行。",
      toolCall: {
        id: "call-material-aspect-ratio",
        name: "film_grain",
        arguments: {
          effectParams: definition.defaults,
          output: { durationSeconds: 1, generationMode: "standard" }
        }
      }
    };
    const baseInputs = new TestInputResolver();
    const outputDimensions = vi.fn(async () => ({ width: 360, height: 640 }));
    const inputs: EffectToolInputResolver = {
      resolve: (...args) => baseInputs.resolve(...args),
      outputDimensions
    };
    const video = await testVideoService();
    const createPrepared = vi.spyOn(video.service, "createPrepared").mockResolvedValue({
      id: "video-material-aspect-ratio",
      status: "queued",
      toolName: "film_grain",
      createdAt: "2026-08-19T00:00:00.000Z",
      updatedAt: "2026-08-19T00:00:00.000Z",
      source: { kind: "image", assetId: "asset_imageabcdefgh" },
      video: {
        format: "mp4",
        mime: "video/mp4",
        width: 360,
        height: 640,
        durationSeconds: 1,
        fps: 30,
        frameCount: 30,
        audio: false,
        completedFrames: 0,
        progress: 0
      },
      gpu: { available: false, message: "queued" }
    } as never);
    const service = new EffectToolService(provider, inputs, EFFECT_TOOL_REGISTRY, video.service);
    const turn = await service.selectedTurn(principal, {
      toolName: "film_grain",
      prompt: "根据竖图生成一秒胶片颗粒",
      inputIds: { source_frame: "asset_imageabcdefgh" }
    });
    expect(turn).toMatchObject({ execution: { video: { width: 360, height: 640 } } });
    expect(outputDimensions).toHaveBeenCalledOnce();
    expect(createPrepared.mock.calls[0]![7]).toBe(360);
    expect(createPrepared.mock.calls[0]![8]).toBe(640);
  });

  it("exports a prompt-only selected tool without uploaded media", async () => {
    const provider = new NativeRecordingProvider();
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("bounce")!;
    provider.turn = {
      reasoningContent: "用户要求直接生成重力弹跳视频。",
      content: "准备调用重力弹跳工具。",
      toolCall: {
        id: "call-prompt-only-bounce",
        name: "bounce",
        arguments: {
          effectParams: definition.defaults,
          output: { durationSeconds: 1, generationMode: "fast" }
        }
      }
    };
    const resolveMedia = vi.fn(async () => { throw new Error("Prompt-only export must not resolve uploaded media."); });
    const inputs = new TenantMediaEffectToolInputResolver({ resolve: resolveMedia } as never);
    const video = await testVideoService();
    const service = new EffectToolService(provider, inputs, EFFECT_TOOL_REGISTRY, video.service);

    const turn = await service.selectedTurn(principal, {
      toolName: "bounce",
      prompt: "生成一秒自然的重力弹跳视频",
      inputIds: {}
    });

    expect(turn).toMatchObject({
      kind: "tool_call",
      tool: { toolName: "bounce" },
      executionInput: {
        authorizedInputs: [{ name: "source_layer", kind: "data", count: 1 }]
      },
      execution: { toolName: "bounce", status: "queued", video: { frameCount: 15 } }
    });
    if (turn.kind !== "tool_call") throw new Error("Expected a tool call.");
    await waitFor(() => service.videoExecution(principal, turn.execution.id).status === "completed");
    expect(service.videoExecution(principal, turn.execution.id)).toMatchObject({
      status: "completed",
      video: { progress: 1, bytes: 15 }
    });
    expect(resolveMedia).not.toHaveBeenCalled();
    expect(video.decodeFrame).not.toHaveBeenCalled();
    expect(video.exportFrames).toHaveBeenCalledOnce();
  });

  it("composes every camera frame from the current decoded video frame", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "cmfx-dolly-video-"));
    const assetId = "asset_videoabcdefgh";
    const media: VerifiedStoredMedia = {
      asset: {
        id: assetId,
        type: "video",
        uri: "media://source.mp4",
        hash: "sha256:test-video",
        metadata: { mime: "video/mp4", width: 2, height: 2, duration: 1, codec: "h264" }
      },
      descriptor: { id: assetId, type: "media/video", cacheKey: "test-video", metadata: {} },
      storedPath: join(outputRoot, "source.mp4"),
      arkEligibility: { filesApi: false, videoTos: false, base64OrUrl: false, reason: "test" },
      trustedBytes: 256
    };
    const red = new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
    const green = new Uint8Array([0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255]);
    const rendered: Uint8Array[] = [];
    const exportFrames = vi.fn(async (options: ExportOptions) => {
      for (const [frame, time] of [[0, 0], [1, 0.5]] as const) {
        rendered.push(await options.renderFrame({ frame, time, deltaTime: 0.5, fps: 2, width: 2, height: 2 }, options.signal));
      }
      await writeFile(options.outputPath, "test-mp4-output");
      return { outputPath: options.outputPath, frameCount: 2, inspections: [], encoder: "libx264" };
    });
    const decodeFrame = vi.fn(async (_media: VerifiedStoredMedia, request: { time: number }) =>
      request.time < 0.25 ? red : green);
    const service = new EffectToolVideoService({
      media: { resolve: vi.fn(async () => media) },
      outputRoot,
      exportFrames: exportFrames as never,
      decodeFrame: decodeFrame as never,
      durationSeconds: 1,
      fps: 2,
      gpuSampler: vi.fn(async () => ({ name: "Test GPU", memoryUsedMiB: 1, memoryTotalMiB: 2, utilizationPercent: 1 }))
    });
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("dolly")!;
    const inputs: AuthorizedEffectInputs = Object.freeze({
      source_video: Object.freeze({
        slot: "source_video",
        kind: "video" as const,
        tenantId: principal.tenantId,
        userId: principal.userId,
        locked: true as const,
        binding: { version: "rgba8-frame-v1", width: 2, height: 2, data: red }
      })
    });
    const task = await service.createPrepared(
      principal,
      definition,
      { type: "dolly", data: definition.defaults },
      inputs,
      [assetId],
      7,
      1,
      2,
      2,
      undefined,
      2,
      { source_video: assetId }
    );
    await waitFor(() => service.get(principal, task.id).status === "completed");

    expect(decodeFrame).toHaveBeenCalledTimes(2);
    expect(rendered).toHaveLength(2);
    expect(rendered[0]![0]).toBeGreaterThan(rendered[0]![1]!);
    expect(rendered[1]![1]).toBeGreaterThan(rendered[1]![0]!);
    await service.close();
  });

  it("requires every distinct selected-tool image only when Ark chooses the Tool Call", async () => {
    const provider = new NativeRecordingProvider();
    const inputs = new TestInputResolver();
    const service = new EffectToolService(provider, inputs);
    const setToolCall = (toolName: string) => {
      const definition = EFFECT_TOOL_REGISTRY.getByToolName(toolName)!;
      provider.turn = {
        reasoningContent: "用户要求生成视频，需要调用当前工具。",
        content: "准备执行当前工具。",
        toolCall: {
          id: `call-${toolName}`,
          name: toolName,
          arguments: {
            effectParams: structuredClone(definition.defaults),
            output: { durationSeconds: 5, generationMode: "standard" }
          }
        }
      };
    };

    await expect(service.selectedTurn(principal, {
      toolName: "photo_stack",
      prompt: "这个工具有哪些参数？",
      inputIds: { source_images: ["asset_imageabcdefgh"] }
    })).resolves.toMatchObject({ kind: "message" });

    setToolCall("wipe");
    await expect(service.selectedTurn(principal, {
      toolName: "wipe",
      prompt: "生成擦除转场",
      inputIds: { source_frame: "asset_imageabcdefgh" }
    })).rejects.toThrow(/target_frame/u);

    await expect(service.selectedTurn(principal, {
      toolName: "wipe",
      prompt: "生成擦除转场",
      inputIds: {
        source_frame: "asset_imageabcdefgh",
        target_frame: "asset_imageabcdefgh"
      }
    })).rejects.toThrow(/distinct authorized resource/u);

    setToolCall("photo_stack");
    await expect(service.selectedTurn(principal, {
      toolName: "photo_stack",
      prompt: "生成照片叠放",
      inputIds: { source_images: ["asset_imageabcdefgh"] }
    })).rejects.toThrow(/2–32/u);
    expect(inputs.calls).toBe(0);
  });

  it("reference-counts concurrent asset use and aborts parameter generation during close", async () => {
    const provider = new BlockingProvider();
    const service = new EffectToolService(provider, new TestInputResolver());
    const inputIds = { source_layer: "asset_abcdefgh" };
    const first = service.execute(principal, { toolName: "fade", prompt: "淡入", inputIds });
    const second = service.execute(principal, { toolName: "fade", prompt: "淡入", inputIds });
    await waitFor(() => provider.calls.length === 2);
    expect(service.usesAsset(principal, "asset_abcdefgh")).toBe(true);

    const envelope = { type: "fade", data: { from: 0, to: 1, duration: 1.2, easing: "easeOut" } };
    provider.calls[0]!.result.resolve(envelope);
    await first;
    expect(service.usesAsset(principal, "asset_abcdefgh")).toBe(true);
    provider.calls[1]!.result.resolve(envelope);
    await second;
    expect(service.usesAsset(principal, "asset_abcdefgh")).toBe(false);

    const generating = service.generate(principal, "particle_spark", "火花");
    await waitFor(() => provider.calls.length === 3);
    const closing = service.close();
    await expect(generating).rejects.toBeDefined();
    await closing;
    expect(provider.calls[2]!.request.signal?.aborted).toBe(true);
    await expect(service.generate(principal, "particle_spark", "火花"))
      .rejects.toMatchObject({ code: "cancelled" });
  }, 15_000);

  it("rejects unknown slots before resolving any media", async () => {
    const resolver = new TenantMediaEffectToolInputResolver({} as never);
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("particle_spark")!;
    await expect(resolver.resolve(principal, definition, {
      rogue_slot: "asset_abcdefgh"
    }, { time: 0, fps: 30, width: 2, height: 2, seed: 1, quality: "preview" }))
      .rejects.toThrow(/unknown slot/u);
  });

  it("builds an integrity-checked vision input only for allowlisted positioning tools", async () => {
    const directory = await mkdtemp(join(tmpdir(), "cmfx-positioning-image-"));
    const storedPath = join(directory, "source.png");
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    await writeFile(storedPath, bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const media: VerifiedStoredMedia = {
      asset: {
        id: `asset_${hash.slice(0, 24)}`,
        type: "image",
        uri: `media://${hash}.png`,
        hash: `sha256:${hash}`,
        metadata: { mime: "image/png", width: 2, height: 2, codec: "png" }
      },
      descriptor: { id: `asset_${hash.slice(0, 24)}`, type: "media/image", cacheKey: hash, metadata: {} },
      storedPath,
      arkEligibility: { filesApi: false, videoTos: false, base64OrUrl: true, reason: "test" },
      trustedBytes: bytes.byteLength
    };
    const resolveMedia = vi.fn(async () => media);
    const resolver = new TenantMediaEffectToolInputResolver({ resolve: resolveMedia } as never);
    const energyPulse = EFFECT_TOOL_REGISTRY.getByToolName("energy_pulse")!;
    const vision = await resolver.visionImage(principal, energyPulse, {
      source_frame: media.asset.id
    });
    expect(vision).toEqual({ mimeType: "image/png", base64Data: bytes.toString("base64") });
    expect(resolveMedia).toHaveBeenCalledOnce();

    const kenBurns = EFFECT_TOOL_REGISTRY.getByToolName("ken_burns")!;
    await expect(resolver.visionImage(principal, kenBurns, {
      source_image: media.asset.id
    })).resolves.toEqual({ mimeType: "image/png", base64Data: bytes.toString("base64") });
    expect(resolveMedia).toHaveBeenCalledTimes(2);

    const kineticTypography = EFFECT_TOOL_REGISTRY.getByToolName("kinetic_typography")!;
    await expect(resolver.visionImage(principal, kineticTypography, {
      source_image: media.asset.id
    })).resolves.toEqual({ mimeType: "image/png", base64Data: bytes.toString("base64") });
    expect(resolveMedia).toHaveBeenCalledTimes(3);

    const lensFlare = EFFECT_TOOL_REGISTRY.getByToolName("lens_flare")!;
    await expect(resolver.visionImage(principal, lensFlare, {
      source_frame: media.asset.id
    })).resolves.toEqual({ mimeType: "image/png", base64Data: bytes.toString("base64") });
    expect(resolveMedia).toHaveBeenCalledTimes(4);

    const markerStroke = EFFECT_TOOL_REGISTRY.getByToolName("marker_stroke")!;
    await expect(resolver.visionImage(principal, markerStroke, {
      source_image: media.asset.id
    })).resolves.toEqual({ mimeType: "image/png", base64Data: bytes.toString("base64") });
    expect(resolveMedia).toHaveBeenCalledTimes(5);

    const chalkStroke = EFFECT_TOOL_REGISTRY.getByToolName("chalk_stroke")!;
    await expect(resolver.visionImage(principal, chalkStroke, {
      source_image: media.asset.id
    })).resolves.toEqual({ mimeType: "image/png", base64Data: bytes.toString("base64") });
    expect(resolveMedia).toHaveBeenCalledTimes(6);

    const neonGlow = EFFECT_TOOL_REGISTRY.getByToolName("neon_glow")!;
    await expect(resolver.visionImage(principal, neonGlow, {
      source_image: media.asset.id
    })).resolves.toEqual({ mimeType: "image/png", base64Data: bytes.toString("base64") });
    expect(resolveMedia).toHaveBeenCalledTimes(7);

    const neonTrace = EFFECT_TOOL_REGISTRY.getByToolName("neon_trace")!;
    await expect(resolver.visionImage(principal, neonTrace, {
      source_image: media.asset.id
    })).resolves.toEqual({ mimeType: "image/png", base64Data: bytes.toString("base64") });
    expect(resolveMedia).toHaveBeenCalledTimes(8);

    const filmGrain = EFFECT_TOOL_REGISTRY.getByToolName("film_grain")!;
    await expect(resolver.visionImage(principal, filmGrain, {
      source_frame: media.asset.id
    })).resolves.toBeUndefined();
    expect(resolveMedia).toHaveBeenCalledTimes(8);
  });

  it.each(["marker_stroke", "chalk_stroke", "neon_glow"])(
    "derives the locked %s subject mask from the owner-authorized source image and normalized target",
    async (toolName) => {
      const width = 4; const height = 2;
      const media: VerifiedStoredMedia = {
        asset: {
          id: "asset_segmentabcdefgh",
          type: "image",
          uri: "media://segment-source.png",
          hash: "sha256:segment-source",
          metadata: { mime: "image/png", width, height, codec: "png" }
        },
        descriptor: {
          id: "asset_segmentabcdefgh", type: "media/image", cacheKey: "segment-source", metadata: {}
        },
        storedPath: "D:\\authorized-media\\segment-source.png",
        arkEligibility: { filesApi: false, videoTos: false, base64OrUrl: true, reason: "test" },
        trustedBytes: 32
      };
      const resolveMedia = vi.fn(async () => media);
      const decode = vi.fn(async () => new Uint8Array(width * height * 4).fill(120));
      const mask = Object.freeze({
        version: "sam31-mask-v1" as const,
        width,
        height,
        data: Uint8Array.from([0, 0, 255, 255, 0, 0, 255, 255]),
        score: 0.91,
        bbox: [2, 0, 4, 2] as const
      });
      const segment = vi.fn(async () => mask);
      const resolver = new TenantMediaEffectToolInputResolver(
        { resolve: resolveMedia } as never,
        undefined,
        decode as never,
        { segment } as never
      );
      const definition = EFFECT_TOOL_REGISTRY.getByToolName(toolName)!;
      const render = { time: 0.4, fps: 30, width, height, seed: 7, quality: "preview" } as const;
      const inputIds = { source_image: media.asset.id };

      const preliminary = await resolver.resolve(principal, definition, inputIds, render);
      expect(preliminary).toHaveProperty("source_image");
      expect(preliminary).not.toHaveProperty("subject_mask");
      const resolved = await resolver.resolve(principal, definition, inputIds, render, undefined, {
        ...definition.defaults,
        target: "car license plate"
      });

      expect(segment).toHaveBeenCalledWith(media, "car license plate", width, height, undefined);
      expect(resolved.subject_mask).toMatchObject({
        slot: "subject_mask",
        kind: "mask",
        tenantId: principal.tenantId,
        userId: principal.userId,
        locked: true,
        binding: mask
      });
      expect(inputIds).toEqual({ source_image: media.asset.id });
    }
  );

  it("derives even output dimensions from the first authorized visual while preserving aspect ratio", async () => {
    const dimensionsById = new Map([
      ["asset_landscape", { width: 1200, height: 800 }],
      ["asset_portrait", { width: 1080, height: 1920 }],
      ["asset_square", { width: 801, height: 801 }]
    ]);
    const resolveMedia = vi.fn(async (_owner, assetId: string) => {
      const dimensions = dimensionsById.get(assetId);
      if (dimensions === undefined) throw new Error("Unknown test asset.");
      return {
        asset: {
          id: assetId,
          type: "image",
          uri: `media://${assetId}.png`,
          hash: `sha256:${"a".repeat(64)}`,
          metadata: { mime: "image/png", codec: "png", ...dimensions }
        }
      } as VerifiedStoredMedia;
    });
    const resolver = new TenantMediaEffectToolInputResolver({ resolve: resolveMedia } as never);
    const brush = EFFECT_TOOL_REGISTRY.getByToolName("brush_reveal")!;
    await expect(resolver.outputDimensions(principal, brush, {
      source_frame: "asset_landscape",
      target_frame: "asset_portrait"
    })).resolves.toEqual({ width: 640, height: 426 });
    await expect(resolver.outputDimensions(principal, brush, {
      source_frame: "asset_portrait",
      target_frame: "asset_landscape"
    })).resolves.toEqual({ width: 360, height: 640 });
    await expect(resolver.outputDimensions(principal, brush, {
      source_frame: "asset_square",
      target_frame: "asset_landscape"
    })).resolves.toEqual({ width: 640, height: 640 });
    expect(resolveMedia).toHaveBeenCalledTimes(3);

    const bounce = EFFECT_TOOL_REGISTRY.getByToolName("bounce")!;
    await expect(resolver.outputDimensions(principal, bounce, {})).resolves.toBeUndefined();
    expect(resolveMedia).toHaveBeenCalledTimes(3);
  });

  it("creates server-owned inputs for every reported prompt-only tool without resolving media", async () => {
    const resolveMedia = vi.fn(async () => { throw new Error("Prompt-only tools must not resolve uploaded media."); });
    const resolver = new TenantMediaEffectToolInputResolver({ resolve: resolveMedia } as never);
    const render = { time: 0.45, fps: 30, width: 96, height: 64, seed: 20260818, quality: "preview" } as const;
    const toolNames = [
      "blob_morph", "bounce", "brush_reveal",
      "character_cascade", "chart_reveal", "dash_flow"
    ] as const;

    for (const toolName of toolNames) {
      const definition = EFFECT_TOOL_REGISTRY.getByToolName(toolName)!;
      const inputs = await resolver.resolve(principal, definition, {}, render);
      expect(Object.keys(inputs).sort(), toolName).toEqual(definition.inputSlots.map((slot) => slot.name).sort());
      const result = await executeSelectedEffectTool(
        definition,
        toolName,
        { type: toolName, data: definition.defaults },
        {
          environment: "server",
          requestId: `prompt-only-${toolName}`,
          tenantId: principal.tenantId,
          userId: principal.userId,
          time: render.time,
          deltaTime: 1 / render.fps,
          frame: Math.floor(render.time * render.fps),
          fps: render.fps,
          width: render.width,
          height: render.height,
          seed: render.seed,
          quality: render.quality,
          backend: definition.primaryBackend,
          inputs
        }
      );
      expect(["frame", "metadata"], toolName).toContain(result.kind);
      if (result.kind === "frame") {
        const frame = result.output as { width: number; height: number; data: Uint8Array };
        expect([frame.width, frame.height, frame.data.length], toolName)
          .toEqual([render.width, render.height, render.width * render.height * 4]);
        expect(frame.data.some((value) => value > 0), toolName).toBe(true);
      }
    }
    expect(resolveMedia).not.toHaveBeenCalled();
  });

  it("feeds live_binding a changing server-owned preview stream without uploaded media", async () => {
    const resolveMedia = vi.fn(async () => { throw new Error("live_binding preview must not resolve media."); });
    const resolver = new TenantMediaEffectToolInputResolver({ resolve: resolveMedia } as never);
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("live_binding")!;
    const resolveAt = (time: number) => resolver.resolve(principal, definition, {}, {
      time, fps: 30, width: 96, height: 64, seed: 20260819, quality: "preview"
    });
    const early = await resolveAt(0.4);
    const later = await resolveAt(1.2);
    const valueOf = (inputs: AuthorizedEffectInputs) => {
      const input = inputs.validated_binding;
      expect(Array.isArray(input)).toBe(false);
      return (input as { binding: { value: number } }).binding.value;
    };
    expect(valueOf(early)).not.toBe(valueOf(later));
    expect(resolveMedia).not.toHaveBeenCalled();
  });

  it("derives structured image previews for the reported existing tools", async () => {
    const width = 96;
    const height = 64;
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = x * 9;
        pixels[offset + 1] = y * 15;
        pixels[offset + 2] = (x + y) % 2 === 0 ? 224 : 32;
        pixels[offset + 3] = 255;
      }
    }
    const media: VerifiedStoredMedia = {
      asset: {
        id: "asset_imageabcdefgh",
        type: "image",
        uri: "media://reported-preview.png",
        hash: "sha256:reported-preview",
        metadata: { mime: "image/png", width, height, codec: "png" }
      },
      descriptor: {
        id: "asset_imageabcdefgh",
        type: "media/image",
        cacheKey: "reported-preview",
        metadata: {}
      },
      storedPath: "D:\\authorized-media\\reported-preview.png",
      arkEligibility: { filesApi: false, videoTos: false, base64OrUrl: false, reason: "test" },
      trustedBytes: pixels.byteLength
    };
    const overlayPixels = Uint8Array.from(pixels, (value, offset) => offset % 4 === 3 ? value : 255 - value);
    const overlayAssetId = "asset_overlayabcdefgh";
    const decode = vi.fn(async (resolved: VerifiedStoredMedia) =>
      resolved.asset.id === overlayAssetId ? overlayPixels : pixels);
    const resolver = new TenantMediaEffectToolInputResolver(
      { resolve: vi.fn(async (_owner, assetId: string) => ({
        ...media,
        asset: { ...media.asset, id: assetId, uri: `media://${assetId}`, hash: `sha256:${assetId}` },
        descriptor: { ...media.descriptor, id: assetId, cacheKey: assetId }
      })) } as never,
      undefined,
      decode as never
    );
    const cases = [
      ["character_cascade", "text_raster", "text", true],
      ["kinetic_typography", "text_raster", "text", true],
      ["scramble_decode", "text_raster", "text", true],
      ["text_morph", "text_raster", "text", true],
      ["text_path_reveal", "text_raster", "text", true],
      ["typewriter", "text_raster", "text", true],
      ["word_explode", "text_raster", "text", true],
      ["text_extrude_3d", "text_raster", "text", true],
      ["path_trim", "vector_source", "shape", true],
      ["path_morph", "vector_source", "shape", true],
      ["radial_burst", "vector_source", "shape", true],
      ["shape_repeater", "vector_source", "shape", false],
      ["brush_reveal", "vector_source", "shape", true],
      ["handwriting", "vector_source", "shape", true],
      ["ink_spread", "vector_source", "shape", true],
      ["blend", "source_layer", "image", false]
    ] as const;

    for (const [toolName, primarySlot, sourceKind, animates] of cases) {
      const definition = EFFECT_TOOL_REGISTRY.getByToolName(toolName)!;
      const inputIds = toolName === "blend"
        ? { [primarySlot]: media.asset.id, overlay_layer: overlayAssetId }
        : { [primarySlot]: media.asset.id };
      const inputs = await resolver.resolve(principal, definition, inputIds,
        { time: 0.45, fps: 30, width, height, seed: 20260817, quality: "preview" });
      const primary = inputs[primarySlot];
      expect(primary).toBeDefined();
      expect(Array.isArray(primary)).toBe(false);
      const binding = (primary as { binding: {
        surface: { data: Uint8Array };
        rasterInput: { layerId: string; source: { kind: string; text?: string; glyphs?: readonly {
          coverage: { data: Uint8Array };
        }[] } };
      } }).binding;
      expect(binding.rasterInput.source.kind).toBe(sourceKind);
      if (sourceKind === "text") {
        expect(binding.rasterInput.source.text).toBe("笔唯思");
        expect(binding.rasterInput.source.glyphs).toHaveLength(3);
        expect(binding.rasterInput.source.glyphs?.every((glyph) =>
          glyph.coverage.data.some((value) => value > 0))).toBe(true);
        expect(binding.surface.data.some((value, offset) => offset % 4 === 3 && value === 0)).toBe(true);
        expect(binding.surface.data.some((value, offset) => offset % 4 === 3 && value > 0)).toBe(true);
      }
      if (toolName === "brush_reveal") {
        const brush = inputs.brush_texture as { binding: { coverage: { data: Uint8Array } } };
        expect(new Set(brush.binding.coverage.data).size).toBeGreaterThan(1);
      }
      if (toolName === "blend") {
        const overlay = (inputs.overlay_layer as { binding: {
          surface: { data: Uint8Array };
          rasterInput: { layerId: string; source: { kind: string } };
        } }).binding;
        expect(overlay.rasterInput.source.kind).toBe("image");
        expect(overlay.rasterInput.layerId).not.toBe(binding.rasterInput.layerId);
        expect(Buffer.from(overlay.surface.data)).toEqual(Buffer.from(overlayPixels));
        expect(Buffer.from(overlay.surface.data)).not.toEqual(Buffer.from(binding.surface.data));
      }
      const renderAt = (time: number) => executeSelectedEffectTool(
        definition, toolName, { type: toolName, data: definition.defaults }, {
          environment: "server",
          requestId: `reported-${toolName}-${time}`,
          tenantId: principal.tenantId,
          userId: principal.userId,
          time,
          deltaTime: 1 / 30,
          frame: Math.floor(time * 30),
          fps: 30,
          width,
          height,
          seed: 20260817,
          quality: "preview",
          backend: definition.primaryBackend,
          inputs
        }
      );
      const early = await renderAt(0.1);
      const later = await renderAt(0.65);
      expect([early.kind, later.kind]).toEqual(["frame", "frame"]);
      const earlyOutput = early.output as { width: number; height: number; data: Uint8Array };
      const laterOutput = later.output as { width: number; height: number; data: Uint8Array };
      expect([laterOutput.width, laterOutput.height, laterOutput.data.length])
        .toEqual([width, height, pixels.length]);
      expect(
        Buffer.from(earlyOutput.data).equals(Buffer.from(binding.surface.data))
          && Buffer.from(laterOutput.data).equals(Buffer.from(binding.surface.data)),
        `${toolName} applies effect`
      ).toBe(false);
      if (animates) {
        expect(Buffer.from(laterOutput.data).equals(Buffer.from(earlyOutput.data)), `${toolName} animates`).toBe(false);
      }
    }

    const geometryCases = [
      ["blob_morph", "source_shape", 32, true],
      ["dash_flow", "source_path", 32, true],
      ["electric_arc", "terminals", 4, false],
      ["lightning_trace", "guide_path", 11, false],
      ["shape_boolean_animate", "shape_a", 32, true],
      ["shape_boolean_animate", "shape_b", 32, true],
      ["wave_path", "source_path", 11, false]
    ] as const;
    for (const [toolName, slotName, pointCount, closed] of geometryCases) {
      const definition = EFFECT_TOOL_REGISTRY.getByToolName(toolName)!;
      const inputs = await resolver.resolve(principal, definition, {
        [slotName]: media.asset.id
      }, { time: 0.45, fps: 30, width, height, seed: 20260817, quality: "preview" });
      const input = inputs[slotName];
      expect(Array.isArray(input)).toBe(false);
      const binding = (input as { binding: {
        points: readonly { x: number; y: number }[];
        closed: boolean;
      } }).binding;
      expect(binding.points).toHaveLength(pointCount);
      expect(binding.closed).toBe(closed);
      expect(new Set(binding.points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`)).size)
        .toBeGreaterThan(3);
      expect(binding.points.every((point) => point.x >= 0 && point.x < width
        && point.y >= 0 && point.y < height)).toBe(true);
    }

    const depthDefinition = EFFECT_TOOL_REGISTRY.getByToolName("depth_of_field")!;
    const depthInputs = await resolver.resolve(principal, depthDefinition, {
      source_frame: media.asset.id
    }, { time: 0.45, fps: 30, width, height, seed: 20260817, quality: "preview" });
    const depthBinding = (depthInputs.depth_field as { binding: {
      width: number; height: number; data: readonly number[];
    } }).binding;
    expect([depthBinding.width, depthBinding.height, depthBinding.data.length])
      .toEqual([width, height, width * height]);
    expect(depthBinding.data.every((value) => value >= 0 && value <= 1)).toBe(true);

    const paintDefinition = EFFECT_TOOL_REGISTRY.getByToolName("paint_on")!;
    const paintInputs = await resolver.resolve(principal, paintDefinition, {
      source_image: media.asset.id
    }, { time: 0.45, fps: 30, width, height, seed: 20260817, quality: "preview" });
    const paintBinding = (paintInputs.stroke_plan as { binding: {
      strokes: readonly { points: readonly { x: number; y: number }[] }[];
    } }).binding;
    expect(paintBinding.strokes.length).toBeGreaterThanOrEqual(9);
    expect(paintBinding.strokes.every((stroke) => stroke.points.length >= 2)).toBe(true);

    const dollyZoomDefinition = EFFECT_TOOL_REGISTRY.getByToolName("dolly_zoom")!;
    const dollyZoomInputs = await resolver.resolve(principal, dollyZoomDefinition, {
      source_video: media.asset.id
    }, { time: 0.45, fps: 30, width, height, seed: 20260817, quality: "preview" });
    expect(dollyZoomInputs).toHaveProperty("source_video");
    expect(dollyZoomInputs).toHaveProperty("camera_target");

    const parallaxDefinition = EFFECT_TOOL_REGISTRY.getByToolName("parallax_layers")!;
    const parallaxInputs = await resolver.resolve(principal, parallaxDefinition, {
      source_video: media.asset.id
    }, { time: 0.45, fps: 30, width, height, seed: 20260817, quality: "preview" });
    const parallaxDepth = (parallaxInputs.depth_map as { binding: { data: Uint8Array } }).binding.data;
    expect(parallaxDepth).toHaveLength(width * height);

    const matchDefinition = EFFECT_TOOL_REGISTRY.getByToolName("object_match_cut")!;
    const matchInputs = await resolver.resolve(principal, matchDefinition, {
      from_video: media.asset.id,
      to_video: "asset_imageijklmnop"
    }, { time: 0.45, fps: 30, width, height, seed: 20260817, quality: "preview" });
    expect(matchInputs).toHaveProperty("from_match_mask");
    expect(matchInputs).toHaveProperty("to_match_mask");
    expect((matchInputs.from_match_mask as { binding: { data: Uint8Array } }).binding.data)
      .toHaveLength(width * height);
    expect((matchInputs.to_match_mask as { binding: { data: Uint8Array } }).binding.data)
      .toHaveLength(width * height);
    expect(decode).toHaveBeenCalled();
  });

  it("exposes versioned authenticated list, parameter, execute, and owner-scoped result routes", async () => {
    const provider = new RecordingProvider();
    const service = new EffectToolService(provider, new TestInputResolver());
    const calls: Array<[ApplicationScope, boolean]> = [];
    const auth = {
      authorize: vi.fn(async (
        _request: IncomingMessage,
        _response: ServerResponse,
        scope: ApplicationScope,
        stateChanging = false
      ) => {
        calls.push([scope, stateChanging]);
        return authenticated();
      })
    };

    await withApi(service, auth, async (baseUrl) => {
      const list = await fetch(`${baseUrl}/api/effect-tools/v1`);
      expect(list.status).toBe(200);
      const listed = await list.json() as { tools: unknown[]; model?: unknown };
      expect(listed.tools).toHaveLength(120);
      expect(listed.model).toBeUndefined();

      const parameters = await fetch(`${baseUrl}/api/effect-tools/v1/parameters`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolName: "particle_spark", prompt: "火花" })
      });
      expect(parameters.status).toBe(200);

      const execution = await fetch(`${baseUrl}/api/effect-tools/v1/executions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolName: "particle_spark", prompt: "火花", inputIds: { background_image: "asset_abcdefgh" } })
      });
      expect(execution.status).toBe(201);
      const created = await execution.json() as { execution: { id: string } };
      const queried = await fetch(`${baseUrl}/api/effect-tools/v1/executions/${created.execution.id}`);
      expect(queried.status).toBe(200);
    });
    expect(calls).toEqual([
      ["ai:plan", false],
      ["ai:plan", true],
      ["project:preview", true],
      ["project:preview", false]
    ]);
  });

  it("returns a safe denial when the shared Origin and CSRF authorization rejects", async () => {
    const service = new EffectToolService(new RecordingProvider(), new TestInputResolver());
    const auth = {
      authorize: vi.fn(async () => {
        throw new AuthHttpError(403, "ORIGIN_MISMATCH");
      })
    };
    await withApi(service, auth, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/effect-tools/v1/parameters`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolName: "particle_spark", prompt: "火花" })
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: { code: "ORIGIN_MISMATCH", retryable: false }
      });
    });
  });

  it("exposes only film_grain through the native v2 conversation route", async () => {
    const provider = new NativeRecordingProvider();
    const video = await testVideoService();
    const service = new EffectToolService(provider, new TestInputResolver(), EFFECT_TOOL_REGISTRY, video.service);
    const auth = {
      authorize: vi.fn(async () => authenticated()),
      verifySameOriginDownload: vi.fn()
    };
    await withApi(service, auth, async (baseUrl) => {
      const listed = await fetch(`${baseUrl}/api/effect-tools/v2`);
      expect(listed.status).toBe(200);
      await expect(listed.json()).resolves.toEqual({
        tool: {
          toolName: "film_grain",
          displayName: "胶片颗粒",
          category: "post",
          configured: true
        }
      });

      const answered = await fetch(`${baseUrl}/api/effect-tools/v2/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "temporal 是什么？", inputIds: {} })
      });
      expect(answered.status).toBe(200);
      await expect(answered.json()).resolves.toMatchObject({
        turn: { kind: "message", content: "temporal 控制颗粒随帧变化的活跃程度。" }
      });

      provider.turn = {
        reasoningContent: "需要执行胶片颗粒。",
        content: "开始执行。",
        toolCall: {
          id: "call-film-grain-api",
          name: "film_grain",
          arguments: {
            effectParams: { amount: 0.2, size: 2, monochrome: true, response: "uniform", temporal: 0.5 },
            output: { durationSeconds: 1 }
          }
        }
      };
      const called = await fetch(`${baseUrl}/api/effect-tools/v2/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: "添加胶片颗粒",
          inputIds: { source_image: "asset_imageabcdefgh" }
        })
      });
      expect(called.status).toBe(200);
      const calledBody = await called.json() as { turn: { execution: { id: string } } };
      await waitFor(() => service.videoExecution(principal, calledBody.turn.execution.id).status === "completed");
      const queried = await fetch(`${baseUrl}/api/effect-tools/v2/executions/${calledBody.turn.execution.id}`);
      expect(queried.status).toBe(200);
      await expect(queried.json()).resolves.toMatchObject({
        execution: { status: "completed", video: { format: "mp4", bytes: 15 } }
      });
      const renderedVideo = await fetch(`${baseUrl}/api/effect-tools/v2/executions/${calledBody.turn.execution.id}/video`, {
        headers: { range: "bytes=0-3" }
      });
      expect(renderedVideo.status).toBe(206);
      expect(renderedVideo.headers.get("content-type")).toBe("video/mp4");
      expect(renderedVideo.headers.get("content-range")).toBe("bytes 0-3/15");
      expect((await renderedVideo.arrayBuffer()).byteLength).toBe(4);

      const download = await fetch(`${baseUrl}/api/effect-tools/v2/executions/${calledBody.turn.execution.id}/download`);
      expect(download.status).toBe(200);
      expect(download.headers.get("content-disposition")).toContain("attachment");
      expect((await download.arrayBuffer()).byteLength).toBe(15);
      expect(auth.verifySameOriginDownload).toHaveBeenCalledOnce();
    });
  });

  it("exposes the strict 120-tool v3 catalog and keeps server-derived inputs off the upload count", async () => {
    const provider = new NativeRecordingProvider();
    const video = await testVideoService();
    const service = new EffectToolService(provider, new TestInputResolver(), EFFECT_TOOL_REGISTRY, video.service);
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("depth_of_field")!;
    const auth = {
      authorize: vi.fn(async () => authenticated()),
      verifySameOriginDownload: vi.fn()
    };

    await withApi(service, auth, async (baseUrl) => {
      const catalogResponse = await fetch(`${baseUrl}/api/effect-tools/v3`);
      expect(catalogResponse.status).toBe(200);
      const catalog = await catalogResponse.json() as {
        count: number;
        tools: Array<{ toolName: string; configured: boolean; inputRequirements: unknown[] }>;
      };
      expect(catalog.count).toBe(120);
      expect(catalog.tools).toHaveLength(120);
      expect(new Set(catalog.tools.map((item) => item.toolName)).size).toBe(120);
      expect(catalog.tools.find((item) => item.toolName === "depth_of_field")).toMatchObject({
        configured: true,
        inputRequirements: [
          { name: "source_frame", kind: "image", required: true, acceptsUploadedImage: true },
          { name: "depth_field", kind: "depth-map", required: true, acceptsUploadedImage: false }
        ]
      });
      expect(catalog.tools.find((item) => item.toolName === "paint_on")).toMatchObject({
        inputRequirements: [
          { name: "source_image", kind: "image", required: true, acceptsUploadedImage: true },
          { name: "stroke_plan", kind: "data", required: true, acceptsUploadedImage: false }
        ]
      });
      for (const toolName of ["marker_stroke", "chalk_stroke", "neon_glow"]) {
        expect(catalog.tools.find((item) => item.toolName === toolName)).toMatchObject({
          inputRequirements: [
            { name: "source_image", kind: "image", required: true, acceptsUploadedImage: true },
            {
              name: "subject_mask", kind: "mask", required: true,
              acceptsUploadedImage: false, acceptsUploadedVideo: false, acceptsUploadedAudio: false
            }
          ]
        });
      }
      expect(catalog.tools.find((item) => item.toolName === "blend")).toMatchObject({
        inputRequirements: [
          { name: "source_layer", required: true, acceptsUploadedImage: true },
          { name: "overlay_layer", required: true, acceptsUploadedImage: true }
        ]
      });
      expect(catalog.tools.find((item) => item.toolName === "mask_reveal")).toMatchObject({
        inputRequirements: [
          {
            name: "source_frame",
            required: true,
            acceptsUploadedImage: true,
            acceptsUploadedVideo: true
          },
          {
            name: "target_frame",
            required: true,
            acceptsUploadedImage: true,
            acceptsUploadedVideo: true
          },
          {
            name: "mask_layer",
            required: false,
            acceptsUploadedImage: true,
            acceptsUploadedVideo: false
          }
        ]
      });
      for (const toolName of ["blob_morph", "bounce", "chart_reveal"]) {
        const promptOnly = catalog.tools.find((item) => item.toolName === toolName)! as {
          inputRequirements: Array<{
            required: boolean;
            acceptsUploadedImage: boolean;
            acceptsUploadedVideo: boolean;
            acceptsUploadedAudio: boolean;
          }>;
        };
        expect(promptOnly.inputRequirements.every((item) => item.required
          && !item.acceptsUploadedImage && !item.acceptsUploadedVideo && !item.acceptsUploadedAudio), toolName)
          .toBe(true);
      }
      expect(catalog.tools.find((item) => item.toolName === "dolly_zoom")).toMatchObject({
        inputRequirements: [
          { name: "source_video", required: true, acceptsUploadedImage: true },
          { name: "camera_target", required: true, acceptsUploadedImage: false }
        ]
      });
      expect(catalog.tools.find((item) => item.toolName === "object_match_cut")).toMatchObject({
        inputRequirements: [
          { name: "from_video", required: true, acceptsUploadedImage: true },
          { name: "to_video", required: true, acceptsUploadedImage: true },
          { name: "from_match_mask", required: true, acceptsUploadedImage: false },
          { name: "to_match_mask", required: true, acceptsUploadedImage: false }
        ]
      });
      expect(catalog.tools.find((item) => item.toolName === "parallax_layers")).toMatchObject({
        inputRequirements: [
          { name: "source_video", required: true, acceptsUploadedImage: true },
          { name: "depth_map", required: true, acceptsUploadedImage: false },
          { name: "camera_target", required: false, acceptsUploadedImage: false }
        ]
      });
      expect(catalog.tools.find((item) => item.toolName === "background_remove_compose")).toMatchObject({
        inputRequirements: [
          { name: "foreground_video", acceptsUploadedVideo: true },
          { name: "foreground_matte", acceptsUploadedImage: false, acceptsUploadedVideo: false },
          { name: "background_image", acceptsUploadedImage: true, acceptsUploadedVideo: false }
        ]
      });
      expect(catalog.tools.find((item) => item.toolName === "image_depth_parallax")).toMatchObject({
        inputRequirements: [
          { name: "source_image", acceptsUploadedImage: true },
          { name: "source_depth", acceptsUploadedImage: false }
        ]
      });
      expect(catalog.tools.find((item) => item.toolName === "smart_crop_animate")).toMatchObject({
        inputRequirements: [
          { name: "source_video", acceptsUploadedVideo: true },
          { name: "subject_tracks", acceptsUploadedImage: false, acceptsUploadedVideo: false }
        ]
      });
      for (const toolName of ["speed_ramp", "video_freeze_frame"]) {
        expect(catalog.tools.find((item) => item.toolName === toolName)).toMatchObject({
          inputRequirements: [{ name: "source_video", acceptsUploadedVideo: true }]
        });
      }

      const inquiry = await fetch(`${baseUrl}/api/effect-tools/v3/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: "depth_of_field",
          prompt: "这个工具有哪些参数？",
          inputIds: {}
        })
      });
      expect(inquiry.status).toBe(200);
      await expect(inquiry.json()).resolves.toMatchObject({
        turn: {
          kind: "message",
          tool: { toolName: "depth_of_field", displayName: definition.displayName }
        }
      });
      expect(provider.requests.at(-1)).toMatchObject({ toolName: "depth_of_field" });
      expect(provider.requests.at(-1)!.fieldSpec).toContain("depth_of_field");

      provider.turn = {
        reasoningContent: "用户要求执行景深工具。",
        content: "准备调用景深工具。",
        toolCall: {
          id: "call-depth-of-field",
          name: "depth_of_field",
          arguments: { effectParams: definition.defaults, output: { durationSeconds: 1 } }
        }
      };

      const execution = await fetch(`${baseUrl}/api/effect-tools/v3/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolName: "depth_of_field",
          prompt: "生成景深视频",
          inputIds: {
            source_frame: "asset_imageabcdefgh"
          }
        })
      });
      expect(execution.status).toBe(200);
      await expect(execution.json()).resolves.toMatchObject({
        turn: {
          kind: "tool_call",
          tool: { toolName: "depth_of_field" },
          executionInput: {
            authorizedInputs: [
              { name: "source_frame", kind: "image", count: 1 },
              { name: "depth_field", kind: "depth-map", count: 1 }
            ]
          }
        }
      });

      const extra = await fetch(`${baseUrl}/api/effect-tools/v3/turns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolName: "film_grain", prompt: "执行", inputIds: {}, extra: true })
      });
      expect(extra.status).toBe(400);
      await expect(extra.json()).resolves.toMatchObject({ error: { code: "EFFECT_TOOL_REQUEST_INVALID" } });
    });
  });
});
