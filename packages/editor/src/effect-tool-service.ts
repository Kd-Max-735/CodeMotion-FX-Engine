import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { RenderQuality } from "@codemotion/core";
import {
  EFFECT_TOOL_REGISTRY,
  EffectToolContractError,
  executeSelectedEffectTool,
  loadEffectFieldSpec,
  validateAndNormalizeEffectEnvelope,
  type AuthorizedEffectInput,
  type AuthorizedEffectInputs,
  type EffectInputSlotDefinition,
  type EffectRenderResult,
  type EffectToolDefinition,
  type EffectToolRegistry,
  type ServerEffectRenderContext
} from "@codemotion/effect-functions";
import {
  ProviderError,
  SELECTED_TOOL_MAX_DURATION_SECONDS,
  SELECTED_TOOL_MIN_DURATION_SECONDS,
  VolcengineArkSelectedToolProvider,
  type SelectedToolConversationProvider,
  type SelectedToolModelTurn,
  type SelectedToolParameterProvider
} from "@codemotion/ai-planner";
import {
  OwnedTaskStore,
  decodeAudioPreview,
  decodeMediaFrame,
  type OwnerContext,
  type TenantMediaStore,
  type VerifiedStoredMedia
} from "@codemotion/exporter";
import type { LayerRasterizationInput } from "@codemotion/renderer-api";
import { AuthHttpError, type AuthSessionService } from "./auth-session-service.js";
import {
  EffectToolVideoService,
  type EffectToolVideoExecutionView,
  type EffectToolVideoFile
} from "./effect-tool-video-service.js";

const MAX_BODY_BYTES = 64 * 1024;
const RESOURCE_ID = /^[a-z][a-z0-9_-]{7,127}$/u;
const EXISTING_BACKEND = "effect-functions-existing-cpu-v1";
export const NATIVE_EFFECT_TOOL_NAME = "film_grain" as const;

export interface EffectToolPrincipal {
  readonly tenantId: string;
  readonly userId: string;
  readonly scopes: readonly string[];
}

export interface EffectToolRenderSettings {
  readonly time: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly quality: RenderQuality;
}

export type EffectToolInputIds = Readonly<Record<string, string | readonly string[]>>;

export interface EffectToolServerResourceResolver {
  resolve(
    owner: OwnerContext,
    definition: EffectToolDefinition,
    slot: EffectInputSlotDefinition,
    resourceId: string,
    render: EffectToolRenderSettings,
    signal?: AbortSignal
  ): Promise<unknown>;
}

export interface EffectToolInputResolver {
  resolve(
    principal: EffectToolPrincipal,
    definition: EffectToolDefinition,
    inputIds: EffectToolInputIds,
    render: EffectToolRenderSettings,
    signal?: AbortSignal
  ): Promise<AuthorizedEffectInputs>;
}

export interface EffectToolListItem {
  readonly toolName: string;
  readonly displayName: string;
  readonly category: string;
}

interface SafeRenderResult {
  readonly kind: EffectRenderResult["kind"];
  readonly backendId: string;
  readonly degraded: boolean;
  readonly warnings: readonly string[];
  readonly output: unknown;
}

export interface EffectToolExecutionView {
  readonly id: string;
  readonly status: "completed";
  readonly toolName: string;
  readonly createdAt: string;
  readonly result: SafeRenderResult;
}

export interface EffectToolFrameView {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface EffectToolNativeCallView {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: typeof NATIVE_EFFECT_TOOL_NAME;
    readonly arguments: Readonly<Record<string, unknown>>;
  };
}

export interface EffectToolExecutionInputView {
  readonly source_image: string;
  readonly effectParams: Readonly<Record<string, unknown>>;
  readonly output: {
    readonly durationSeconds: number;
    readonly fps: number;
    readonly format: "mp4";
  };
}

export type EffectToolTurnView = Readonly<{
  kind: "message";
  reasoningContent: string;
  content: string;
}> | Readonly<{
  kind: "tool_call";
  reasoningContent: string;
  content: string;
  toolCall: EffectToolNativeCallView;
  executionInput: EffectToolExecutionInputView;
  execution: EffectToolVideoExecutionView;
}>;

interface StoredExecution {
  readonly view: EffectToolExecutionView;
  readonly result: EffectRenderResult;
}

function ownerOf(principal: EffectToolPrincipal): OwnerContext {
  if (typeof principal.tenantId !== "string" || principal.tenantId.length === 0
    || typeof principal.userId !== "string" || principal.userId.length === 0) {
    throw new TypeError("Authenticated effect-tool principal is invalid.");
  }
  return { tenantId: principal.tenantId, userId: principal.userId };
}

function exactObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((key) => !accepted.has(key))) {
    throw new TypeError(`${label} contains an unknown field.`);
  }
}

function nativeConversationArguments(value: unknown): {
  readonly effectParams: Readonly<Record<string, unknown>>;
  readonly durationSeconds: number;
} {
  const argumentsObject = exactObject(value, "tool arguments");
  exactKeys(argumentsObject, ["effectParams", "output"], "tool arguments");
  const effectParams = exactObject(argumentsObject.effectParams, "effectParams");
  const output = exactObject(argumentsObject.output, "output");
  exactKeys(output, ["durationSeconds"], "output");
  const durationSeconds = output.durationSeconds;
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds)
    || durationSeconds < SELECTED_TOOL_MIN_DURATION_SECONDS
    || durationSeconds > SELECTED_TOOL_MAX_DURATION_SECONDS
    || Math.abs(durationSeconds * 10 - Math.round(durationSeconds * 10)) > 1e-8) {
    throw new RangeError("Tool output duration is outside the server limits.");
  }
  return { effectParams, durationSeconds };
}

function renderSettings(value: unknown): EffectToolRenderSettings {
  const input = value === undefined ? {} : exactObject(value, "render");
  exactKeys(input, ["time", "fps", "width", "height", "seed", "quality"], "render");
  const time = input.time ?? 0;
  const fps = input.fps ?? 30;
  const width = input.width ?? 640;
  const height = input.height ?? 360;
  const seed = input.seed ?? 1;
  const quality = input.quality ?? "preview";
  if (typeof time !== "number" || !Number.isFinite(time) || time < 0 || time > 3_600
    || typeof fps !== "number" || !Number.isFinite(fps) || fps < 1 || fps > 120
    || !Number.isInteger(width) || (width as number) < 1 || (width as number) > 4_096
    || !Number.isInteger(height) || (height as number) < 1 || (height as number) > 4_096
    || !Number.isInteger(seed) || (seed as number) < 0 || (seed as number) > 0xffff_ffff
    || (quality !== "draft" && quality !== "preview" && quality !== "final")) {
    throw new RangeError("Render settings are outside the server limits.");
  }
  return { time, fps, width: width as number, height: height as number, seed: seed as number, quality };
}

function safeOutput(result: EffectRenderResult): unknown {
  if (result.kind !== "frame" || typeof result.output !== "object" || result.output === null) {
    return structuredClone(result.output);
  }
  const output = result.output as Record<string, unknown>;
  const data = output.data;
  if (!Array.isArray(data) && !(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray)) {
    return structuredClone(result.output);
  }
  const bytes = Buffer.from(data as ArrayLike<number>);
  return {
    width: output.width,
    height: output.height,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

function safeResult(result: EffectRenderResult): SafeRenderResult {
  return Object.freeze({
    kind: result.kind,
    backendId: result.backendId,
    degraded: result.degraded,
    warnings: Object.freeze([...result.warnings]),
    output: safeOutput(result)
  });
}

function conversationProvider(
  provider: SelectedToolParameterProvider | undefined
): SelectedToolConversationProvider {
  if (provider === undefined
    || typeof (provider as Partial<SelectedToolConversationProvider>).respond !== "function"
    || typeof (provider as Partial<SelectedToolConversationProvider>).finalize !== "function") {
    throw new ProviderError("provider_unavailable", "Native Ark Tool Call is not configured.");
  }
  return provider as SelectedToolConversationProvider;
}

function visualKind(asset: VerifiedStoredMedia["asset"]): "image" | "video" | undefined {
  return asset.type === "image" || asset.type === "svg" ? "image"
    : asset.type === "video" ? "video" : undefined;
}

function alphaValues(data: Uint8Array): number[] {
  const values: number[] = [];
  for (let offset = 0; offset < data.length; offset += 4) values.push(data[offset + 3]! / 255);
  return values;
}

function luminanceValues(data: Uint8Array): number[] {
  const values: number[] = [];
  for (let offset = 0; offset < data.length; offset += 4) {
    values.push((data[offset]! * 0.2126 + data[offset + 1]! * 0.7152 + data[offset + 2]! * 0.0722) / 255);
  }
  return values;
}

function audioBinding(pcm: Uint8Array, duration: number): Record<string, unknown> {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples: number[] = [];
  let square = 0;
  let peak = 0;
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 4) {
    const value = view.getInt16(offset, true) / 32768;
    samples.push(value);
    square += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = samples.length === 0 ? 0 : Math.min(1, Math.sqrt(square / samples.length));
  return {
    version: "audio-analysis-v1",
    duration,
    frames: [{
      time: 0,
      rms,
      peak,
      bass: rms,
      mid: rms,
      vocal: rms,
      high: rms,
      beatConfidence: 0,
      onsetStrength: 0
    }]
  };
}

function legacyRasterBinding(
  definition: EffectToolDefinition,
  slot: EffectInputSlotDefinition,
  media: VerifiedStoredMedia,
  pixels: Uint8Array,
  render: EffectToolRenderSettings
) {
  const kind = visualKind(media.asset)!;
  const layerId = `single-tool:${slot.name}:${media.asset.id}`;
  const rasterInput: LayerRasterizationInput = {
    layerId,
    layerType: kind,
    source: {
      kind,
      assetId: media.asset.id,
      assetHash: media.asset.hash ?? "",
      frameTime: render.time,
      pixels: {
        width: render.width,
        height: render.height,
        data: pixels,
        colorSpace: "srgb",
        alphaMode: "straight",
        rowOrder: "top-to-bottom"
      }
    },
    time: {
      contractVersion: "1.1.0",
      layerId,
      active: true,
      projectTime: render.time,
      localTime: render.time,
      sourceTime: render.time,
      deltaTime: 1 / render.fps
    },
    transform: {
      matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      anchor: [0, 0]
    },
    opacity: 1,
    masks: [],
    target: {
      width: render.width,
      height: render.height,
      format: "rgba8",
      colorSpace: "srgb",
      samples: 1,
      usage: slot.kind === "mask" ? "mask" : "input"
    }
  };
  return {
    surface: {
      width: render.width,
      height: render.height,
      data: new Uint8ClampedArray(pixels),
      colorSpace: "srgb" as const,
      alphaMode: "straight" as const
    },
    rasterInput
  };
}

export class TenantMediaEffectToolInputResolver implements EffectToolInputResolver {
  constructor(
    private readonly media: TenantMediaStore,
    private readonly serverResources?: EffectToolServerResourceResolver
  ) {}

  async resolve(
    principal: EffectToolPrincipal,
    definition: EffectToolDefinition,
    inputIds: EffectToolInputIds,
    render: EffectToolRenderSettings,
    signal?: AbortSignal
  ): Promise<AuthorizedEffectInputs> {
    const owner = ownerOf(principal);
    const raw = exactObject(inputIds, "inputIds");
    const declared = new Map(definition.inputSlots.map((slot) => [slot.name, slot]));
    if (Object.keys(raw).some((name) => !declared.has(name))) {
      throw new TypeError("inputIds contains an unknown slot.");
    }
    const output: Record<string, AuthorizedEffectInput | readonly AuthorizedEffectInput[]> = {};
    for (const slot of definition.inputSlots) {
      const value = raw[slot.name];
      if (value === undefined) {
        if (slot.required) throw new TypeError(`Required input slot ${slot.name} is missing.`);
        continue;
      }
      const ids = slot.cardinality === "many" ? value : [value];
      if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string" || !RESOURCE_ID.test(id))) {
        throw new TypeError(`Input slot ${slot.name} requires safe opaque resource IDs.`);
      }
      if (slot.cardinality === "one" && ids.length !== 1) {
        throw new TypeError(`Input slot ${slot.name} accepts exactly one resource ID.`);
      }
      const bindings = await Promise.all(ids.map(async (id) => Object.freeze({
        slot: slot.name,
        kind: slot.kind,
        tenantId: principal.tenantId,
        userId: principal.userId,
        locked: true as const,
        binding: await this.binding(owner, definition, slot, id, render, signal)
      })));
      output[slot.name] = slot.cardinality === "many" ? Object.freeze(bindings) : bindings[0]!;
    }
    return Object.freeze(output);
  }

  private async binding(
    owner: OwnerContext,
    definition: EffectToolDefinition,
    slot: EffectInputSlotDefinition,
    resourceId: string,
    render: EffectToolRenderSettings,
    signal?: AbortSignal
  ): Promise<unknown> {
    const existing = definition.primaryBackend.backendId === EXISTING_BACKEND;
    const mediaKind = slot.kind === "image" || slot.kind === "video" || slot.kind === "audio"
      || slot.kind === "mask" || slot.kind === "depth-map" || slot.kind === "texture" || slot.kind === "lut"
      || existing && ["source_layer", "source_frame", "target_frame", "overlay_layer",
        "displacement_map", "mask_layer", "matte_layer", "brush_texture"].includes(slot.name);
    if (!mediaKind) {
      if (this.serverResources === undefined) {
        throw new TypeError(`No server resource resolver is configured for ${slot.kind}.`);
      }
      return this.serverResources.resolve(owner, definition, slot, resourceId, render, signal);
    }
    const media = await this.media.resolve(owner, resourceId, signal);
    if (slot.kind === "audio") {
      if (media.asset.type !== "audio") throw new TypeError(`${slot.name} requires authorized audio.`);
      const pcm = await decodeAudioPreview(media, 0.1, signal === undefined ? {} : { signal });
      return audioBinding(pcm, Math.max(0.1, Number(media.asset.metadata.duration ?? 0.1)));
    }
    const kind = visualKind(media.asset);
    if (kind === undefined || slot.kind === "video" && kind !== "video"
      || slot.kind === "image" && kind !== "image") {
      throw new TypeError(`${slot.name} requires an authorized ${slot.kind} visual resource.`);
    }
    const pixels = await decodeMediaFrame(media, {
      frame: Math.floor(render.time * render.fps),
      time: render.time,
      deltaTime: 1 / render.fps,
      fps: render.fps,
      width: render.width,
      height: render.height
    }, signal === undefined ? {} : { signal });
    if (existing) {
      if (slot.name === "brush_texture") {
        return {
          reference: `asset://${media.asset.id}`,
          coverage: {
            width: render.width,
            height: render.height,
            data: Uint8Array.from(alphaValues(pixels), (value) => Math.round(value * 255)),
            rowOrder: "top-to-bottom"
          }
        };
      }
      return legacyRasterBinding(definition, slot, media, pixels, render);
    }
    if (slot.kind === "mask") {
      const values = alphaValues(pixels);
      return { width: render.width, height: render.height, data: values, values };
    }
    if (slot.kind === "depth-map") {
      const data = luminanceValues(pixels);
      if (definition.toolName === "hologram" && slot.name === "depth_map") {
        return { version: "depth-sample-v1", depth: data[0] ?? 0 };
      }
      return { width: render.width, height: render.height, data };
    }
    if (slot.kind === "texture" || slot.kind === "lut") {
      return {
        version: "texture-sample-v1",
        width: render.width,
        height: render.height,
        sample: [pixels[0]! / 255, pixels[1]! / 255, pixels[2]! / 255, pixels[3]! / 255]
      };
    }
    return { width: render.width, height: render.height, data: pixels };
  }
}

export class EffectToolService {
  private readonly executions = new OwnedTaskStore<StoredExecution>();
  private readonly activeAssets = new Map<string, number>();
  private readonly controllers = new Set<AbortController>();
  private closing = false;

  constructor(
    private readonly provider: SelectedToolParameterProvider | undefined,
    private readonly inputs: EffectToolInputResolver,
    private readonly registry: EffectToolRegistry = EFFECT_TOOL_REGISTRY,
    private readonly nativeVideos?: EffectToolVideoService
  ) {}

  get configured(): boolean { return this.provider !== undefined; }

  list(): readonly EffectToolListItem[] {
    return Object.freeze(this.registry.list().map((definition) => Object.freeze({
      toolName: definition.toolName,
      displayName: definition.displayName,
      category: definition.category
    })));
  }

  nativeTool(): EffectToolListItem & { readonly configured: boolean } {
    const definition = this.selected(NATIVE_EFFECT_TOOL_NAME);
    return Object.freeze({
      toolName: definition.toolName,
      displayName: definition.displayName,
      category: definition.category,
      configured: this.configured
    });
  }

  usesAsset(owner: OwnerContext, assetId: string): boolean {
    return (this.activeAssets.get(JSON.stringify([owner.tenantId, owner.userId, assetId])) ?? 0) > 0
      || this.nativeVideos?.usesAsset(owner, assetId) === true;
  }

  async generate(
    principal: EffectToolPrincipal,
    toolName: string,
    prompt: string,
    signal?: AbortSignal
  ) {
    if (this.closing) throw new ProviderError("cancelled", "Effect tool service is closing.");
    ownerOf(principal);
    const definition = this.selected(toolName);
    const controller = new AbortController();
    this.controllers.add(controller);
    const linkedSignal = signal === undefined
      ? controller.signal
      : AbortSignal.any([signal, controller.signal]);
    try {
      return await this.generateForDefinition(principal, definition, prompt, linkedSignal);
    } finally {
      this.controllers.delete(controller);
    }
  }

  async execute(
    principal: EffectToolPrincipal,
    request: {
      readonly toolName: string;
      readonly prompt: string;
      readonly inputIds: EffectToolInputIds;
      readonly render?: unknown;
    }
  ): Promise<EffectToolExecutionView> {
    if (this.closing) throw new ProviderError("cancelled", "Effect tool service is closing.");
    const owner = ownerOf(principal);
    const definition = this.selected(request.toolName);
    const render = renderSettings(request.render);
    const ids = Object.values(exactObject(request.inputIds, "inputIds")).flatMap((value) =>
      Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string");
    const activeKeys = ids.map((id) => JSON.stringify([owner.tenantId, owner.userId, id]));
    activeKeys.forEach((key) => this.activeAssets.set(key, (this.activeAssets.get(key) ?? 0) + 1));
    const controller = new AbortController();
    this.controllers.add(controller);
    const signal = controller.signal;
    try {
      const inputs = await this.inputs.resolve(principal, definition, request.inputIds, render, signal);
      const envelope = await this.generateForDefinition(principal, definition, request.prompt, signal);
      const id = randomUUID();
      const context: ServerEffectRenderContext = {
        environment: "server",
        requestId: id,
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
        inputs,
        signal
      };
      const result = await executeSelectedEffectTool(definition, definition.toolName, envelope, context);
      const view = Object.freeze({
        id,
        status: "completed" as const,
        toolName: definition.toolName,
        createdAt: new Date().toISOString(),
        result: safeResult(result)
      });
      this.executions.put(owner, id, { view, result });
      return structuredClone(view);
    } finally {
      this.controllers.delete(controller);
      activeKeys.forEach((key) => {
        const remaining = (this.activeAssets.get(key) ?? 1) - 1;
        if (remaining > 0) this.activeAssets.set(key, remaining);
        else this.activeAssets.delete(key);
      });
    }
  }

  async turn(
    principal: EffectToolPrincipal,
    request: {
      readonly prompt: string;
      readonly inputIds: EffectToolInputIds;
    }
  ): Promise<EffectToolTurnView> {
    if (this.closing) throw new ProviderError("cancelled", "Effect tool service is closing.");
    const owner = ownerOf(principal);
    const definition = this.selected(NATIVE_EFFECT_TOOL_NAME);
    if (typeof request.prompt !== "string" || request.prompt.trim().length === 0
      || request.prompt.length > 10_000) {
      throw new TypeError("prompt is required and must not exceed 10000 characters.");
    }
    const rawInputIds = exactObject(request.inputIds, "inputIds");
    exactKeys(rawInputIds, ["source_image"], "inputIds");
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const fieldSpec = await loadEffectFieldSpec(definition.toolName);
      const provider = conversationProvider(this.provider);
      const providerRequest = {
        requestId: randomUUID(),
        tenantId: principal.tenantId,
        userId: principal.userId,
        toolName: definition.toolName,
        prompt: request.prompt,
        fieldSpec,
        parameterSchema: definition.parameterSchema,
        signal: controller.signal
      } as const;
      const modelTurn: SelectedToolModelTurn = await provider.respond(providerRequest);
      if (modelTurn.toolCall === undefined) {
        return Object.freeze({
          kind: "message",
          reasoningContent: modelTurn.reasoningContent,
          content: modelTurn.content
        });
      }
      const nativeArguments = nativeConversationArguments(modelTurn.toolCall.arguments);
      const envelope = validateAndNormalizeEffectEnvelope(definition, definition.toolName, {
        type: definition.toolName,
        data: nativeArguments.effectParams
      });
      const sourceImage = rawInputIds.source_image;
      if (typeof sourceImage !== "string" || !RESOURCE_ID.test(sourceImage)) {
        throw new TypeError("source_image requires one safe opaque resource ID.");
      }
      if (this.nativeVideos === undefined) throw new Error("Effect video service is unavailable.");
      const execution = await this.nativeVideos.create(
        owner,
        sourceImage,
        definition,
        envelope,
        20260814,
        nativeArguments.durationSeconds
      );
      const normalizedArguments = Object.freeze({
        effectParams: structuredClone(envelope.data),
        output: Object.freeze({ durationSeconds: nativeArguments.durationSeconds })
      });
      const normalizedCall = Object.freeze({
        id: modelTurn.toolCall.id,
        name: NATIVE_EFFECT_TOOL_NAME,
        arguments: normalizedArguments
      });
      const finalTurn = await provider.finalize(providerRequest, normalizedCall, Object.freeze({
        status: execution.status,
        output: Object.freeze({
          format: execution.video.format,
          mime: execution.video.mime,
          durationSeconds: execution.video.durationSeconds,
          fps: execution.video.fps,
          width: execution.video.width,
          height: execution.video.height
        })
      }));
      if (finalTurn.toolCall !== undefined) {
        throw new ProviderError("security", "Ark attempted another tool call after execution.");
      }
      return Object.freeze({
        kind: "tool_call",
        reasoningContent: [modelTurn.reasoningContent, finalTurn.reasoningContent]
          .filter((value) => value.trim().length > 0).join("\n\n"),
        content: finalTurn.content,
        toolCall: Object.freeze({
          id: modelTurn.toolCall.id,
          type: "function",
          function: Object.freeze({
            name: NATIVE_EFFECT_TOOL_NAME,
            arguments: structuredClone(normalizedArguments)
          })
        }),
        executionInput: Object.freeze({
          source_image: sourceImage,
          effectParams: structuredClone(envelope.data),
          output: Object.freeze({
            durationSeconds: execution.video.durationSeconds,
            fps: execution.video.fps,
            format: "mp4" as const
          })
        }),
        execution
      });
    } finally {
      this.controllers.delete(controller);
    }
  }

  videoExecution(principal: EffectToolPrincipal, id: string): EffectToolVideoExecutionView {
    if (this.nativeVideos === undefined) throw new Error("Effect video service is unavailable.");
    return this.nativeVideos.get(ownerOf(principal), id);
  }

  openVideo(
    principal: EffectToolPrincipal,
    id: string,
    range?: { start: number; end: number }
  ): Promise<EffectToolVideoFile> {
    if (this.nativeVideos === undefined) throw new Error("Effect video service is unavailable.");
    return this.nativeVideos.open(ownerOf(principal), id, range);
  }

  get(principal: EffectToolPrincipal, id: string): EffectToolExecutionView {
    return structuredClone(this.executions.get(ownerOf(principal), id).value.view);
  }

  frame(principal: EffectToolPrincipal, id: string): EffectToolFrameView {
    const result = this.executions.get(ownerOf(principal), id).value.result;
    if (result.kind !== "frame" || typeof result.output !== "object" || result.output === null) {
      throw new RangeError("Execution has no frame output.");
    }
    const output = result.output as Record<string, unknown>;
    const width = output.width;
    const height = output.height;
    const data = output.data;
    if (!Number.isInteger(width) || !Number.isInteger(height)
      || (width as number) < 1 || (height as number) < 1
      || (!Array.isArray(data) && !(data instanceof Uint8Array) && !(data instanceof Uint8ClampedArray))) {
      throw new TypeError("Stored frame output is invalid.");
    }
    const bytes = Uint8Array.from(data as ArrayLike<number>);
    if (bytes.byteLength !== (width as number) * (height as number) * 4) {
      throw new TypeError("Stored frame byte length is invalid.");
    }
    return { width: width as number, height: height as number, data: bytes };
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const controller of this.controllers) controller.abort(new ProviderError("cancelled", "Effect tool service is closing."));
    while (this.controllers.size > 0) await new Promise((resolve) => setTimeout(resolve, 0));
    await this.nativeVideos?.close();
  }

  private selected(toolName: string): EffectToolDefinition {
    if (typeof toolName !== "string") throw new TypeError("toolName is required.");
    const definition = this.registry.getByToolName(toolName);
    if (definition === undefined) throw new RangeError("Unknown effect tool name.");
    return definition;
  }

  private async generateForDefinition(
    principal: EffectToolPrincipal,
    definition: EffectToolDefinition,
    prompt: string,
    signal?: AbortSignal
  ) {
    if (this.provider === undefined) throw new ProviderError("provider_unavailable", "Ark is not configured.");
    if (typeof prompt !== "string" || prompt.trim().length === 0 || prompt.length > 10_000) {
      throw new TypeError("prompt is required and must not exceed 10000 characters.");
    }
    const fieldSpec = await loadEffectFieldSpec(definition.toolName);
    const output = await this.provider.generate({
      requestId: randomUUID(),
      tenantId: principal.tenantId,
      userId: principal.userId,
      toolName: definition.toolName,
      prompt,
      fieldSpec,
      parameterSchema: definition.parameterSchema,
      ...(signal === undefined ? {} : { signal })
    });
    return validateAndNormalizeEffectEnvelope(definition, definition.toolName, output);
  }

  private async renderEnvelope(
    principal: EffectToolPrincipal,
    definition: EffectToolDefinition,
    inputIds: EffectToolInputIds,
    render: EffectToolRenderSettings,
    envelope: ReturnType<typeof validateAndNormalizeEffectEnvelope>,
    signal: AbortSignal
  ): Promise<EffectToolExecutionView> {
    const inputs = await this.inputs.resolve(principal, definition, inputIds, render, signal);
    const id = randomUUID();
    const context: ServerEffectRenderContext = {
      environment: "server",
      requestId: id,
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
      inputs,
      signal
    };
    const result = await executeSelectedEffectTool(definition, definition.toolName, envelope, context);
    const view = Object.freeze({
      id,
      status: "completed" as const,
      toolName: definition.toolName,
      createdAt: new Date().toISOString(),
      result: safeResult(result)
    });
    this.executions.put(ownerOf(principal), id, { view, result });
    return structuredClone(view);
  }
}

export function createProductionEffectToolService(
  media: TenantMediaStore,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
  serverResources?: EffectToolServerResourceResolver,
  videoOutputRoot = resolve("tmp/effect-tool-video-exports")
): EffectToolService {
  const apiKey = env.ARK_API_KEY;
  const provider = apiKey && apiKey.trim().length >= 10
    ? new VolcengineArkSelectedToolProvider({
      apiKey,
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
      audit: (record) => process.stderr.write(`[effect-tool] ${JSON.stringify(record)}\n`)
    })
    : undefined;
  return new EffectToolService(
    provider,
    new TenantMediaEffectToolInputResolver(media, serverResources),
    EFFECT_TOOL_REGISTRY,
    new EffectToolVideoService({
      media,
      outputRoot: videoOutputRoot,
      ...(env.FFMPEG_PATH === undefined ? {} : { ffmpegPath: env.FFMPEG_PATH })
    })
  );
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const length = request.headers["content-length"];
  if (typeof length === "string" && (!/^\d+$/u.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new RangeError("Request body exceeds the server limit.");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new RangeError("Request body exceeds the server limit.");
    chunks.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new TypeError("Request body must be valid JSON."); }
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(value));
}

function safeError(error: unknown): { status: number; code: string } {
  if (error instanceof AuthHttpError) return { status: error.status, code: error.code };
  if (error instanceof EffectToolContractError) return { status: 422, code: error.code };
  if (error instanceof ProviderError) {
    return {
      status: error.code === "rate_limited" ? 429
        : error.code === "provider_unavailable" ? 503
          : error.code === "authentication" ? 502 : 422,
      code: `ARK_${error.code.toUpperCase()}`
    };
  }
  if (error instanceof RangeError && error.message === "Unknown effect tool name.") {
    return { status: 404, code: "TOOL_NOT_FOUND" };
  }
  if (error instanceof RangeError && error.message === "Execution has no frame output.") {
    return { status: 409, code: "FRAME_NOT_AVAILABLE" };
  }
  if (error instanceof RangeError && error.message === "Video is not available.") {
    return { status: 409, code: "VIDEO_NOT_AVAILABLE" };
  }
  if (error instanceof RangeError && error.message === "Invalid video byte range.") {
    return { status: 416, code: "INVALID_VIDEO_RANGE" };
  }
  if (error instanceof Error && error.message === "Task not found or access denied.") {
    return { status: 404, code: "EXECUTION_NOT_FOUND" };
  }
  return { status: 400, code: "EFFECT_TOOL_REQUEST_INVALID" };
}

function videoRange(value: string | undefined, bytes: number): { start: number; end: number } | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d+)-(\d*)$/u.exec(value);
  if (match === null) throw new RangeError("Invalid video byte range.");
  const start = Number(match[1]);
  const end = match[2] === "" ? bytes - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= bytes) {
    throw new RangeError("Invalid video byte range.");
  }
  return { start, end };
}

async function pipeVideo(
  response: ServerResponse,
  file: EffectToolVideoFile,
  range: { start: number; end: number } | undefined,
  disposition: "inline" | "attachment"
): Promise<void> {
  const length = range === undefined ? file.bytes : range.end - range.start + 1;
  response.statusCode = range === undefined ? 200 : 206;
  response.setHeader("content-type", "video/mp4");
  response.setHeader("content-length", String(length));
  response.setHeader("accept-ranges", "bytes");
  response.setHeader("cache-control", "private, no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("content-disposition", `${disposition}; filename="${file.name}"`);
  if (range !== undefined) response.setHeader("content-range", `bytes ${range.start}-${range.end}/${file.bytes}`);
  try {
    await new Promise<void>((resolvePipe, rejectPipe) => {
      const done = (): void => { cleanup(); resolvePipe(); };
      const failed = (error: Error): void => { cleanup(); rejectPipe(error); };
      const cleanup = (): void => {
        file.stream.off("error", failed);
        response.off("finish", done);
        response.off("close", done);
      };
      file.stream.once("error", failed);
      response.once("finish", done);
      response.once("close", done);
      file.stream.pipe(response);
    });
  } finally {
    await file.close();
  }
}

export function createEffectToolApi(
  service: EffectToolService,
  auth?: Pick<AuthSessionService, "authorize"> & Partial<Pick<AuthSessionService, "verifySameOriginDownload">>
) {
  return async (request: IncomingMessage, response: ServerResponse, next: () => void): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const collection = url.pathname === "/api/effect-tools/v1";
    const parameters = url.pathname === "/api/effect-tools/v1/parameters";
    const executions = url.pathname === "/api/effect-tools/v1/executions";
    const nativeTool = url.pathname === "/api/effect-tools/v2";
    const nativeTurns = url.pathname === "/api/effect-tools/v2/turns";
    const execution = /^\/api\/effect-tools\/v1\/executions\/([^/]+)$/u.exec(url.pathname);
    const nativeExecution = /^\/api\/effect-tools\/v2\/executions\/([^/]+)$/u.exec(url.pathname);
    const nativeVideo = /^\/api\/effect-tools\/v2\/executions\/([^/]+)\/video$/u.exec(url.pathname);
    const nativeDownload = /^\/api\/effect-tools\/v2\/executions\/([^/]+)\/download$/u.exec(url.pathname);
    const matched = request.method === "GET" && (collection || nativeTool || execution !== null)
      || request.method === "GET" && (nativeExecution !== null || nativeVideo !== null || nativeDownload !== null)
      || request.method === "POST" && (parameters || executions || nativeTurns);
    if (!matched) return next();
    try {
      if (auth === undefined) throw new AuthHttpError(401, "UNAUTHENTICATED");
      if (request.method === "GET" && collection) {
        await auth.authorize(request, response, "ai:plan", false);
        return sendJson(response, 200, { tools: service.list() });
      }
      if (request.method === "GET" && nativeTool) {
        await auth.authorize(request, response, "ai:plan", false);
        return sendJson(response, 200, { tool: service.nativeTool() });
      }
      if (request.method === "GET" && nativeExecution) {
        const principal = await auth.authorize(request, response, "project:preview", false);
        return sendJson(response, 200, {
          execution: service.videoExecution(principal, decodeURIComponent(nativeExecution[1]!))
        });
      }
      if (request.method === "GET" && (nativeVideo || nativeDownload)) {
        const download = nativeDownload !== null;
        const match = nativeDownload ?? nativeVideo!;
        const principal = await auth.authorize(request, response, download ? "export:read" : "project:preview", false);
        if (download) {
          if (auth.verifySameOriginDownload === undefined) throw new AuthHttpError(401, "UNAUTHENTICATED");
          auth.verifySameOriginDownload(request);
        }
        const id = decodeURIComponent(match[1]!);
        const view = service.videoExecution(principal, id);
        if (view.status !== "completed" || view.video.bytes === undefined) {
          throw new RangeError("Video is not available.");
        }
        const range = download ? undefined : videoRange(request.headers.range, view.video.bytes);
        const file = await service.openVideo(principal, id, range);
        await pipeVideo(response, file, range, download ? "attachment" : "inline");
        return;
      }
      if (request.method === "GET" && execution) {
        const principal = await auth.authorize(request, response, "project:preview", false);
        return sendJson(response, 200, { execution: service.get(principal, decodeURIComponent(execution[1]!)) });
      }
      if (parameters) {
        const principal = await auth.authorize(request, response, "ai:plan", true);
        const body = exactObject(await jsonBody(request), "request body");
        exactKeys(body, ["toolName", "prompt"], "request body");
        const envelope = await service.generate(principal, body.toolName as string, body.prompt as string);
        return sendJson(response, 200, { envelope });
      }
      if (nativeTurns) {
        const principal = await auth.authorize(request, response, "project:preview", true);
        if (!principal.scopes.includes("ai:plan")) throw new AuthHttpError(403, "FORBIDDEN");
        const body = exactObject(await jsonBody(request), "request body");
        exactKeys(body, ["prompt", "inputIds"], "request body");
        const turn = await service.turn(principal, {
          prompt: body.prompt as string,
          inputIds: body.inputIds as EffectToolInputIds
        });
        return sendJson(response, 200, { turn });
      }
      const principal = await auth.authorize(request, response, "project:preview", true);
      if (!principal.scopes.includes("ai:plan")) throw new AuthHttpError(403, "FORBIDDEN");
      const body = exactObject(await jsonBody(request), "request body");
      exactKeys(body, ["toolName", "prompt", "inputIds", "render"], "request body");
      const view = await service.execute(principal, {
        toolName: body.toolName as string,
        prompt: body.prompt as string,
        inputIds: body.inputIds as EffectToolInputIds,
        ...(body.render === undefined ? {} : { render: body.render })
      });
      return sendJson(response, 201, { execution: view });
    } catch (error) {
      const safe = safeError(error);
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, safe.status, { error: { code: safe.code, retryable: safe.status >= 500 } });
      }
    }
  };
}
