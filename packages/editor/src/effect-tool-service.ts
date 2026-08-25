import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { JsonObject, RenderQuality } from "@codemotion/core";
import { PNG } from "pngjs";
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
  DEFAULT_VIDEO_GENERATION_MODE,
  ProviderError,
  parseExplicitOutputDuration,
  SELECTED_TOOL_MAX_DURATION_SECONDS,
  SELECTED_TOOL_MIN_DURATION_SECONDS,
  VIDEO_GENERATION_MODE_FPS,
  VIDEO_GENERATION_MODES,
  VolcengineArkSelectedToolProvider,
  type SelectedToolConversationProvider,
  type SelectedToolModelTurn,
  type SelectedToolParameterProvider,
  type SelectedToolVisionImage,
  type VideoGenerationMode
} from "@codemotion/ai-planner";
import { DEFAULT_CJK_GLYPH_PATTERNS } from "@codemotion/effects-2d";
import {
  OwnedTaskStore,
  decodeAudioPreview,
  decodeMediaFrame,
  type OwnerContext,
  type TenantMediaStore,
  type VerifiedStoredMedia
} from "@codemotion/exporter";
import type {
  LayerRasterizationInput,
  TextRasterSource,
  VectorPathCommand,
  VectorRasterSource
} from "@codemotion/renderer-api";
import { AuthHttpError, type AuthSessionService } from "./auth-session-service.js";
import {
  EffectToolVideoService,
  type EffectToolEvidenceFile,
  type EffectToolVideoExecutionView,
  type EffectToolVideoFile
} from "./effect-tool-video-service.js";
import { VolcengineArkWavePathSelfCheckReviewer } from "./wave-path-self-check.js";
import { VolcengineArkObservedMotionSelfCheckReviewer } from "./observed-motion-self-check.js";
import { VolcengineArkDedicatedSelfCheckReviewer } from "./dedicated-effect-self-check-common.js";
import { VolcengineArkVisualSelfCheckReviewer } from "./visual-effect-self-check.js";
import { VolcengineArkObservableSelfCheckReviewer } from "./self-checks/index.js";
import { VolcengineArkUnifiedSelfCheckReviewer } from "./unified-self-check-review.js";
import {
  Sam31SegmentationError,
  Sam31SegmentationService,
  createSam31SegmentationService
} from "./sam31-segmentation-service.js";

const MAX_BODY_BYTES = 64 * 1024;
const MIN_MANY_INPUTS = 2;
const MAX_MANY_INPUTS = 32;
const RESOURCE_ID = /^[a-z][a-z0-9_-]{7,127}$/u;
const EXISTING_BACKEND = "effect-functions-existing-cpu-v1";
const TOOL_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const HAN_TEXT = /\p{Script=Han}/u;
const SENSITIVE_PATH = /(?:https?:\/\/|file:\/\/|[a-z]:\\|\/(?:home|tmp|var|etc|users)\/)/iu;
const IMAGE_DERIVED_TEXT_TOOLS = new Set([
  "kinetic_typography", "text_extrude_3d"
]);
const IMAGE_DERIVED_VECTOR_TOOLS = new Set([
  "path_trim", "path_morph", "radial_burst", "shape_repeater",
  "handwriting", "ink_spread"
]);
const SAM_DERIVED_MASK_SOURCES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  marker_stroke: Object.freeze({ subject_mask: "source_image" }),
  chalk_stroke: Object.freeze({ subject_mask: "source_image" }),
  neon_glow: Object.freeze({ subject_mask: "source_image" }),
  object_match_cut: Object.freeze({
    from_match_mask: "from_video",
    to_match_mask: "to_video"
  }),
  particle_logo_assemble: Object.freeze({ subject_mask: "logo_image" }),
  path_trim: Object.freeze({ subject_mask: "source_image" }),
  texture_overlay: Object.freeze({ subject_mask: "base_image" }),
  track_matte: Object.freeze({ subject_mask: "source_image" })
});
const SAM_DERIVED_MASK_TOOLS = new Set(Object.keys(SAM_DERIVED_MASK_SOURCES));
const PROMPT_ONLY_SERVER_INPUTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  blob_morph: Object.freeze(["source_shape"]),
  bounce: Object.freeze(["source_layer"]),
  brush_reveal: Object.freeze(["brush_texture"])
});
const VISION_POSITIONING_SLOTS: Readonly<Record<string, string>> = Object.freeze({
  energy_pulse: "source_frame",
  dash_flow: "source_image",
  ken_burns: "source_image",
  kinetic_typography: "source_image",
  text_morph: "source_image",
  typewriter: "source_image",
  word_explode: "source_image",
  lens_flare: "source_frame",
  marker_stroke: "source_image",
  chalk_stroke: "source_image",
  neon_glow: "source_image",
  neon_trace: "source_image",
  number_counter: "source_image",
  live_binding: "source_image",
  particle_spark: "background_image",
  particle_trail: "source_image",
  particle_emitter: "background_image",
  particle_logo_assemble: "logo_image",
  path_trim: "source_image",
  object_match_cut: "from_video",
  sim_rope: "source_image",
  sim_spring: "source_image",
  texture_overlay: "base_image",
  track_matte: "source_image",
  wave_path: "source_image",
  volumetric_ray: "source_image"
});
const MAX_VISION_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_MATERIAL_OUTPUT_EDGE = 640;
const VIDEO_IN_IMAGE_SLOT_TOOLS = new Set([
  "live_binding", "particle_emitter", "particle_flow_field", "particle_orbit_field",
  "particle_snow_rain", "particle_spark", "particle_trail"
]);
const STRICT_VIDEO_INPUT_TOOLS = new Set([
  "smart_crop_animate", "speed_ramp", "video_freeze_frame"
]);
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
    signal?: AbortSignal,
    effectParams?: Readonly<JsonObject>
  ): Promise<AuthorizedEffectInputs>;
  visionImage?(
    principal: EffectToolPrincipal,
    definition: EffectToolDefinition,
    inputIds: EffectToolInputIds,
    signal?: AbortSignal
  ): Promise<SelectedToolVisionImage | undefined>;
  outputDimensions?(
    principal: EffectToolPrincipal,
    definition: EffectToolDefinition,
    inputIds: EffectToolInputIds,
    signal?: AbortSignal
  ): Promise<Readonly<{ width: number; height: number }> | undefined>;
}

export interface EffectToolListItem {
  readonly toolName: string;
  readonly displayName: string;
  readonly category: string;
}

export interface EffectToolInputRequirementView {
  readonly name: string;
  readonly kind: EffectInputSlotDefinition["kind"];
  readonly required: boolean;
  readonly cardinality: EffectInputSlotDefinition["cardinality"];
  readonly description: string;
  readonly acceptedMimeTypes: readonly string[];
  readonly acceptsUploadedImage: boolean;
  readonly acceptsUploadedVideo: boolean;
  readonly acceptsUploadedAudio: boolean;
}

export interface EffectToolCatalogItem extends EffectToolListItem {
  readonly configured: boolean;
  readonly inputRequirements: readonly EffectToolInputRequirementView[];
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
    readonly generationMode: VideoGenerationMode;
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

export interface SelectedEffectToolExecutionInputView {
  readonly authorizedInputs: readonly Readonly<{
    name: string;
    kind: EffectInputSlotDefinition["kind"];
    count: number;
  }>[];
  readonly effectParams: Readonly<Record<string, unknown>>;
  readonly output: {
    readonly durationSeconds: number;
    readonly generationMode: VideoGenerationMode;
    readonly fps: number;
    readonly format: "mp4";
  };
}

export interface SelectedEffectToolNativeCallView {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
  };
}

export type SelectedEffectToolTurnView = Readonly<{
  kind: "message";
  tool: EffectToolListItem;
  reasoningContent: string;
  content: string;
}> | Readonly<{
  kind: "tool_call";
  tool: EffectToolListItem;
  reasoningContent: string;
  content: string;
  toolCall: SelectedEffectToolNativeCallView;
  executionInput: SelectedEffectToolExecutionInputView;
  execution: EffectToolVideoExecutionView;
}>;

interface StoredExecution {
  readonly view: EffectToolExecutionView;
  readonly result: EffectRenderResult;
}

class MissingEffectToolInputError extends TypeError {
  constructor(readonly requirements: readonly EffectToolInputRequirementView[]) {
    super(`Required input slots are missing: ${requirements.map((item) => item.name).join(", ")}.`);
  }
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

function safeChineseBody(value: string, inputIds: EffectToolInputIds = {}): string {
  const content = value.trim();
  if (content.length === 0 || !HAN_TEXT.test(content)) {
    throw new ProviderError("provider_response", "Ark did not return a non-empty Chinese response.");
  }
  const ids = Object.values(inputIds).flatMap((item) => typeof item === "string" ? [item] : [...item]);
  if (SENSITIVE_PATH.test(content)
    || /\b(?:asset|resource|file)_[a-z0-9_-]{7,}\b/iu.test(content)
    || ids.some((id) => content.includes(id))) {
    throw new ProviderError("security", "Ark final response contained protected resource information.");
  }
  return content;
}

function validateSelectedInputIds(
  definition: EffectToolDefinition,
  inputIds: EffectToolInputIds,
  requireRequired = true
): EffectToolInputIds {
  const raw = exactObject(inputIds, "inputIds");
  const declared = new Map(definition.inputSlots.map((slot) => [slot.name, slot]));
  if (Object.keys(raw).some((name) => !declared.has(name))) {
    throw new TypeError("inputIds contains an unknown slot.");
  }
  const missing = definition.inputSlots
    .filter((slot) => slot.required && raw[slot.name] === undefined
      && !isServerDerivedInputSlot(definition, slot))
    .map((slot) => requirementView(definition, slot));
  if (requireRequired && missing.length > 0) throw new MissingEffectToolInputError(missing);
  const normalized: Record<string, string | readonly string[]> = {};
  for (const [name, value] of Object.entries(raw)) {
    const slot = declared.get(name)!;
    if (slot.cardinality === "one") {
      if (typeof value !== "string" || !RESOURCE_ID.test(value)) {
        throw new TypeError(`${name} requires one safe opaque resource ID.`);
      }
      normalized[name] = value;
      continue;
    }
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MANY_INPUTS
      || requireRequired && value.length < MIN_MANY_INPUTS
      || value.some((id) => typeof id !== "string" || !RESOURCE_ID.test(id))) {
      throw new TypeError(`${name} requires ${MIN_MANY_INPUTS}–${MAX_MANY_INPUTS} safe opaque resource IDs.`);
    }
    normalized[name] = Object.freeze([...value] as string[]);
  }
  const ids = Object.values(normalized).flatMap((value) => typeof value === "string" ? [value] : [...value]);
  if (new Set(ids).size !== ids.length) {
    throw new TypeError("Each input slot requires a distinct authorized resource.");
  }
  return Object.freeze(normalized);
}

function authorizedInputSummary(
  definition: EffectToolDefinition,
  inputs: AuthorizedEffectInputs
): SelectedEffectToolExecutionInputView["authorizedInputs"] {
  return Object.freeze(definition.inputSlots.flatMap((slot) => {
    const value = inputs[slot.name];
    if (value === undefined) return [];
    return [Object.freeze({
      name: slot.name,
      kind: slot.kind,
      count: Array.isArray(value) ? value.length : 1
    })];
  }));
}

function isServerDerivedInputSlot(
  definition: EffectToolDefinition,
  slot: EffectInputSlotDefinition
): boolean {
  return isSyntheticDerivedInputSlot(definition, slot)
    || SAM_DERIVED_MASK_SOURCES[definition.toolName]?.[slot.name] !== undefined
    || definition.toolName === "depth_of_field" && slot.name === "depth_field"
    || definition.toolName === "volumetric_ray" && slot.name === "occlusion_mask"
    || definition.toolName === "paint_on" && slot.name === "stroke_plan"
    || ["dolly", "dolly_zoom", "orbit", "pan_tilt", "parallax_layers"].includes(definition.toolName)
      && slot.name === "camera_target"
    || definition.toolName === "parallax_layers" && slot.name === "depth_map"
    || definition.toolName === "background_remove_compose" && slot.name === "foreground_matte"
    || definition.toolName === "image_depth_parallax" && slot.name === "source_depth"
    || definition.toolName === "smart_crop_animate" && slot.name === "subject_tracks"
    || definition.toolName === "onset_trigger" && slot.name === "target_effect"
    || definition.toolName === "vocal_reactive_text"
      && (slot.name === "text_layer" || slot.name === "text_font")
    || definition.toolName === "live_binding"
      && slot.kind === "data"
    || ["glass", "hologram", "metal"].includes(definition.toolName)
      && slot.name !== "source_image";
}

function isSyntheticDerivedInputSlot(
  definition: EffectToolDefinition,
  slot: EffectInputSlotDefinition
): boolean {
  return PROMPT_ONLY_SERVER_INPUTS[definition.toolName]?.includes(slot.name) === true
    || definition.toolName === "text_path_reveal" && slot.name === "motion_path"
    || definition.toolName === "onset_trigger" && slot.name === "target_effect"
    || definition.toolName === "vocal_reactive_text"
      && (slot.name === "text_layer" || slot.name === "text_font")
    || definition.toolName === "live_binding"
      && slot.kind === "data";
}

function acceptsUploadedImage(
  definition: EffectToolDefinition,
  slot: EffectInputSlotDefinition
): boolean {
  if (isServerDerivedInputSlot(definition, slot)) return false;
  if (slot.kind === "video" && STRICT_VIDEO_INPUT_TOOLS.has(definition.toolName)) return false;
  // The current picker accepts visual files for every non-audio required slot;
  // the server converts data, mask, LUT, depth, model and texture slots after authorization.
  return slot.kind !== "audio" && slot.kind !== "font";
}

function acceptsUploadedVideo(
  definition: EffectToolDefinition,
  slot: EffectInputSlotDefinition
): boolean {
  if (isServerDerivedInputSlot(definition, slot)) return false;
  return slot.kind === "video"
    || definition.toolName === "glass" && slot.name === "source_image"
    || VIDEO_IN_IMAGE_SLOT_TOOLS.has(definition.toolName) && slot.kind === "image"
    || definition.toolName === "mask_reveal"
      && (slot.name === "source_frame" || slot.name === "target_frame");
}

function acceptsUploadedAudio(
  definition: EffectToolDefinition,
  slot: EffectInputSlotDefinition
): boolean {
  if (isServerDerivedInputSlot(definition, slot)) return false;
  return slot.kind === "audio";
}

function derivedInputResourceId(
  definition: EffectToolDefinition,
  slot: EffectInputSlotDefinition,
  inputIds: Readonly<Record<string, unknown>>
): string | undefined {
  if (!isServerDerivedInputSlot(definition, slot)) return undefined;
  const samSourceSlot = SAM_DERIVED_MASK_SOURCES[definition.toolName]?.[slot.name];
  const sourceSlot = samSourceSlot ?? (definition.toolName === "depth_of_field" ? "source_frame"
      : definition.toolName === "volumetric_ray" ? "source_image"
      : definition.toolName === "paint_on" ? "source_image"
      : definition.toolName === "onset_trigger" || definition.toolName === "vocal_reactive_text"
        ? "audio_analysis"
      : ["glass", "hologram", "metal"].includes(definition.toolName)
        ? "source_image"
      : definition.toolName === "background_remove_compose" && slot.name === "foreground_matte"
        ? "foreground_video"
      : definition.toolName === "parallax_layers" ? "source_image"
      : definition.toolName === "image_depth_parallax" && slot.name === "source_depth"
        ? "source_image" : "source_video");
  const value = inputIds[sourceSlot];
  return typeof value === "string" && RESOURCE_ID.test(value) ? value : undefined;
}

function requirementView(
  definition: EffectToolDefinition,
  slot: EffectInputSlotDefinition
): EffectToolInputRequirementView {
  return Object.freeze({
    name: slot.name,
    kind: slot.kind,
    required: slot.required,
    cardinality: slot.cardinality,
    description: slot.description,
    acceptedMimeTypes: Object.freeze([...(slot.acceptedMimeTypes ?? [])]),
    acceptsUploadedImage: acceptsUploadedImage(definition, slot),
    acceptsUploadedVideo: acceptsUploadedVideo(definition, slot),
    acceptsUploadedAudio: acceptsUploadedAudio(definition, slot)
  });
}

function assertRequiredInputCoverage(definition: EffectToolDefinition): void {
  const uncovered = definition.inputSlots.filter((slot) => slot.required
    && !isServerDerivedInputSlot(definition, slot)
    && !acceptsUploadedImage(definition, slot)
    && !acceptsUploadedVideo(definition, slot)
    && !acceptsUploadedAudio(definition, slot));
  if (uncovered.length > 0) {
    throw new TypeError(`Required input slots have no upload or server binding route: ${definition.toolName}: ${
      uncovered.map((slot) => slot.name).join(", ")}.`);
  }
}

function toolIdentity(definition: EffectToolDefinition): EffectToolListItem {
  return Object.freeze({
    toolName: definition.toolName,
    displayName: definition.displayName,
    category: definition.category
  });
}

function nativeConversationArguments(value: unknown): {
  readonly effectParams: Readonly<Record<string, unknown>>;
  readonly durationSeconds: number;
  readonly generationMode: VideoGenerationMode;
} {
  const argumentsObject = exactObject(value, "tool arguments");
  exactKeys(argumentsObject, ["effectParams", "output"], "tool arguments");
  const effectParams = exactObject(argumentsObject.effectParams, "effectParams");
  const output = exactObject(argumentsObject.output, "output");
  exactKeys(output, ["durationSeconds", "generationMode"], "output");
  const durationSeconds = output.durationSeconds;
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds)
    || durationSeconds < SELECTED_TOOL_MIN_DURATION_SECONDS
    || durationSeconds > SELECTED_TOOL_MAX_DURATION_SECONDS
    || Math.abs(durationSeconds * 10 - Math.round(durationSeconds * 10)) > 1e-8) {
    throw new RangeError("Tool output duration is outside the server limits.");
  }
  const generationMode = output.generationMode ?? DEFAULT_VIDEO_GENERATION_MODE;
  if (typeof generationMode !== "string" || !VIDEO_GENERATION_MODES.includes(generationMode as VideoGenerationMode)) {
    throw new TypeError("Tool output generation mode is invalid.");
  }
  return { effectParams, durationSeconds, generationMode: generationMode as VideoGenerationMode };
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

function luminanceValues(data: Uint8Array): number[] {
  const values: number[] = [];
  for (let offset = 0; offset < data.length; offset += 4) {
    values.push((data[offset]! * 0.2126 + data[offset + 1]! * 0.7152 + data[offset + 2]! * 0.0722) / 255);
  }
  return values;
}

function materialOutputDimensions(width: unknown, height: unknown): Readonly<{ width: number; height: number }> | undefined {
  if (typeof width !== "number" || !Number.isInteger(width) || width < 2
    || typeof height !== "number" || !Number.isInteger(height) || height < 2) {
    return undefined;
  }
  const scale = Math.min(1, MAX_MATERIAL_OUTPUT_EDGE / Math.max(width, height));
  const even = (value: number) => Math.max(2, Math.min(MAX_MATERIAL_OUTPUT_EDGE, Math.round(value * scale / 2) * 2));
  return Object.freeze({ width: even(width), height: even(height) });
}

function derivedBrushCoverage(data: Uint8Array, render: EffectToolRenderSettings): Uint8Array {
  const coverage = new Uint8Array(render.width * render.height);
  for (let y = 0; y < render.height; y += 1) {
    for (let x = 0; x < render.width; x += 1) {
      const pixel = y * render.width + x;
      const offset = pixel * 4;
      const luminance = (data[offset]! * 0.2126 + data[offset + 1]! * 0.7152
        + data[offset + 2]! * 0.0722) / 255;
      const alpha = data[offset + 3]! / 255;
      const bristle = (x * 7 + y * 13) % 19 < 3 ? 0.28 : 1;
      coverage[pixel] = Math.round(alpha * (0.25 + luminance * 0.75) * bristle * 255);
    }
  }
  return coverage;
}

function audioBinding(
  pcm: Uint8Array,
  duration: number,
  definition?: EffectToolDefinition
): Record<string, unknown> {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples: number[] = [];
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 4) {
    const value = view.getInt16(offset, true) / 32768;
    samples.push(value);
  }
  if (definition?.toolName === "spectrum_bars" || definition?.toolName === "waveform") {
    const seriesLength = Math.min(65_536, samples.length);
    const series = Array.from({ length: seriesLength }, (_, index) =>
      samples[Math.min(samples.length - 1, Math.floor(index / Math.max(1, seriesLength - 1)
        * Math.max(0, samples.length - 1)))]!);
    const waveformSamples = series.length > 0 ? series : [0];
    const frequencyBins = waveformSamples.map((value) => Math.min(1, Math.abs(value)));
    return {
      version: "audio-analysis-v1",
      sampleRate: waveformSamples.length / duration,
      duration,
      frequencyBins,
      previousFrequencyBins: frequencyBins.map((value) => value * 0.92),
      waveformSamples,
      previousWaveformSamples: waveformSamples.map((value) => value * 0.92)
    };
  }
  const frameSize = 2_400;
  const frameCount = Math.max(1, Math.ceil(samples.length / frameSize));
  let priorEnergy = 0;
  const frames = Array.from({ length: frameCount }, (_, frameIndex) => {
    const start = frameIndex * frameSize;
    const end = Math.min(samples.length, start + frameSize);
    let energy = 0;
    let localPeak = 0;
    let low = 0;
    let middle = 0;
    let high = 0;
    let average = 0;
    for (let index = start; index < end; index += 1) {
      const value = samples[index]!;
      const previous = samples[Math.max(start, index - 1)]!;
      average = average * 0.94 + value * 0.06;
      energy += value * value;
      localPeak = Math.max(localPeak, Math.abs(value));
      low += average * average;
      high += (value - previous) ** 2;
      middle += (value - average) ** 2;
    }
    const count = Math.max(1, end - start);
    const frameRms = Math.min(1, Math.sqrt(energy / count));
    const bass = Math.min(1, Math.sqrt(low / count) * 2.2);
    const highBand = Math.min(1, Math.sqrt(high / count) * 1.8);
    const mid = Math.min(1, Math.sqrt(middle / count) * 1.5);
    const onsetStrength = Math.min(1, Math.max(0, frameRms - priorEnergy) * 6);
    const beatConfidence = Math.min(1, onsetStrength * 0.75 + bass * 0.45);
    priorEnergy = priorEnergy * 0.55 + frameRms * 0.45;
    return {
      time: Math.min(duration, start / 48_000),
      rms: frameRms,
      peak: localPeak,
      bass,
      mid,
      vocal: Math.min(1, mid * 0.72 + frameRms * 0.38),
      high: highBand,
      beatConfidence,
      onsetStrength
    };
  });
  return {
    version: "audio-analysis-v1",
    duration,
    frames
  };
}

function previewAudioBinding(definition: EffectToolDefinition, render: EffectToolRenderSettings) {
  const sampleCount = 64;
  const frequencyBins = Array.from({ length: sampleCount }, (_, index) =>
    Math.max(0, Math.min(1, 0.2 + 0.55 * Math.abs(Math.sin(index * 0.31 + render.time * 2.4)))));
  const waveformSamples = Array.from({ length: sampleCount }, (_, index) =>
    Math.sin(index / sampleCount * Math.PI * 4 + render.time * Math.PI * 2) * 0.62);
  if (definition.toolName === "spectrum_bars" || definition.toolName === "waveform") {
    return {
      version: "audio-analysis-v1",
      frequencyBins,
      previousFrequencyBins: frequencyBins.map((value) => value * 0.92),
      waveformSamples,
      previousWaveformSamples: waveformSamples.map((value) => value * 0.92)
    };
  }
  const duration = 30;
  const frames = Array.from({ length: 301 }, (_, index) => {
    const time = index / 10;
    const energy = Math.max(0, Math.min(1,
      0.46 + Math.sin(time * Math.PI * 2.4) * 0.26 + Math.sin(time * Math.PI * 5.1) * 0.12));
    return {
      time,
      rms: energy * 0.72,
      peak: energy,
      bass: energy,
      mid: Math.max(0, energy * 0.82),
      vocal: Math.max(0, energy * 0.76),
      high: Math.max(0, energy * 0.64),
      beatConfidence: energy > 0.68 ? 0.9 : 0.2,
      onsetStrength: energy > 0.72 ? 0.85 : 0.12
    };
  });
  return {
    version: "audio-analysis-v1",
    duration,
    frames
  };
}

function previewColor(pixels: Uint8Array): readonly [number, number, number, number] {
  const pixelCount = Math.max(1, pixels.length / 4);
  const step = Math.max(1, Math.floor(pixelCount / 128));
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;
  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const offset = pixel * 4;
    red += pixels[offset]!;
    green += pixels[offset + 1]!;
    blue += pixels[offset + 2]!;
    alpha += pixels[offset + 3]!;
    count += 1;
  }
  return [red / count / 255, green / count / 255, blue / count / 255, alpha / count / 255];
}

function derivedPreviewPixels(
  source: Uint8Array,
  slot: EffectInputSlotDefinition,
  render: EffectToolRenderSettings
): Uint8Array {
  const output = new Uint8Array(source);
  if (slot.kind === "mask" || /mask|matte/u.test(slot.name)) {
    let edgeColor: readonly [number, number, number] | undefined;
    if (slot.name === "foreground_matte") {
      let red = 0; let green = 0; let blue = 0; let count = 0;
      for (let y = 0; y < render.height; y += 1) for (let x = 0; x < render.width; x += 1) {
        if (x !== 0 && y !== 0 && x !== render.width - 1 && y !== render.height - 1) continue;
        const offset = (y * render.width + x) * 4;
        red += source[offset]!; green += source[offset + 1]!; blue += source[offset + 2]!; count += 1;
      }
      edgeColor = [red / count, green / count, blue / count];
    }
    for (let offset = 0; offset < output.length; offset += 4) {
      const matte = edgeColor === undefined
        ? Math.round(output[offset]! * 0.2126 + output[offset + 1]! * 0.7152 + output[offset + 2]! * 0.0722)
        : Math.round(Math.max(0, Math.min(255, (Math.hypot(
            output[offset]! - edgeColor[0], output[offset + 1]! - edgeColor[1], output[offset + 2]! - edgeColor[2]
          ) - 18) * 4.2)));
      output[offset] = matte;
      output[offset + 1] = matte;
      output[offset + 2] = matte;
      output[offset + 3] = matte;
    }
    return output;
  }
  if (/target|\bto_|overlay|background/u.test(slot.name)) {
    const rowBytes = render.width * 4;
    for (let y = 0; y < render.height; y += 1) {
      const row = y * rowBytes;
      for (let x = 0; x < Math.floor(render.width / 2); x += 1) {
        const left = row + x * 4;
        const right = row + (render.width - 1 - x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          const temporary = output[left + channel]!;
          output[left + channel] = output[right + channel]!;
          output[right + channel] = temporary;
        }
      }
    }
    for (let offset = 0; offset < output.length; offset += 4) {
      output[offset] = Math.min(255, Math.round(output[offset]! * 0.72 + 38));
      output[offset + 1] = Math.min(255, Math.round(output[offset + 1]! * 0.86 + 18));
      output[offset + 2] = Math.min(255, Math.round(output[offset + 2]! * 1.08 + 12));
    }
  } else if (/previous|history/u.test(slot.name)) {
    const snapshot = new Uint8Array(output);
    for (let y = 0; y < render.height; y += 1) {
      for (let x = 0; x < render.width; x += 1) {
        const sourceX = Math.max(0, x - 4);
        const sourceOffset = (y * render.width + sourceX) * 4;
        const targetOffset = (y * render.width + x) * 4;
        output[targetOffset] = snapshot[sourceOffset]!;
        output[targetOffset + 1] = snapshot[sourceOffset + 1]!;
        output[targetOffset + 2] = snapshot[sourceOffset + 2]!;
        output[targetOffset + 3] = snapshot[sourceOffset + 3]!;
      }
    }
  }
  return output;
}

function previewPath(render: EffectToolRenderSettings) {
  return [
    { x: render.width * 0.12, y: render.height * 0.68 },
    { x: render.width * 0.32, y: render.height * 0.28 },
    { x: render.width * 0.58, y: render.height * 0.72 },
    { x: render.width * 0.86, y: render.height * 0.34 }
  ];
}

function defaultTextRasterBinding(
  media: VerifiedStoredMedia,
  pixels: Uint8Array,
  render: EffectToolRenderSettings
): { readonly source: TextRasterSource; readonly pixels: Uint8Array } {
  const text = "笔唯思";
  const characters = [...text];
  const gap = Math.max(1, Math.floor(render.width * 0.015));
  const glyphHeight = Math.max(1, Math.min(Math.max(1, render.height - 2), Math.floor(render.height * 0.38)));
  const maximumGlyphWidth = Math.max(1, Math.floor((render.width - gap * (characters.length - 1) - 2) / characters.length));
  const glyphWidth = Math.max(1, Math.min(maximumGlyphWidth, Math.round(glyphHeight * 14 / 18)));
  const totalWidth = glyphWidth * characters.length + gap * (characters.length - 1);
  const startX = Math.max(0, Math.floor((render.width - totalWidth) / 2));
  const top = Math.max(0, Math.floor((render.height - glyphHeight) / 2));
  const surfacePixels = new Uint8Array(render.width * render.height * 4);
  const glyphs = characters.map((character, index) => {
    const left = startX + index * (glyphWidth + gap);
    const pattern = DEFAULT_CJK_GLYPH_PATTERNS[character]!;
    const coverage = new Uint8Array(glyphWidth * glyphHeight);
    for (let y = 0; y < glyphHeight; y += 1) {
      for (let x = 0; x < glyphWidth; x += 1) {
        const patternY = Math.min(pattern.length - 1, Math.floor(y * pattern.length / glyphHeight));
        const row = pattern[patternY]!;
        const patternX = Math.min(row.length - 1, Math.floor(x * row.length / glyphWidth));
        const alpha = row[patternX] === "1" ? 255 : 0;
        coverage[y * glyphWidth + x] = alpha;
        if (alpha === 0 || left + x >= render.width || top + y >= render.height) continue;
        const targetOffset = ((top + y) * render.width + left + x) * 4;
        const backgroundLuminance = pixels[targetOffset]! * 0.2126
          + pixels[targetOffset + 1]! * 0.7152 + pixels[targetOffset + 2]! * 0.0722;
        const ink = backgroundLuminance > 150 ? [24, 35, 48] : [238, 248, 255];
        surfacePixels[targetOffset] = ink[0]!;
        surfacePixels[targetOffset + 1] = ink[1]!;
        surfacePixels[targetOffset + 2] = ink[2]!;
        surfacePixels[targetOffset + 3] = alpha;
      }
    }
    return Object.freeze({
      glyphId: character.codePointAt(0)!,
      cluster: index,
      advance: glyphWidth + gap,
      offsetX: 0,
      offsetY: 0,
      bounds: Object.freeze({ x: left, y: top, width: glyphWidth, height: glyphHeight }),
      coverage: Object.freeze({
        width: glyphWidth,
        height: glyphHeight,
        data: coverage,
        rowOrder: "top-to-bottom" as const
      })
    });
  });
  return Object.freeze({
    source: Object.freeze({
      kind: "text",
      text,
      font: Object.freeze({
        fontId: "codemotion.default-cjk-text-v1",
        assetId: `server-derived:${media.asset.id}`,
        assetHash: media.asset.hash ?? "sha256:codemotion-default-cjk-text-v1",
        family: "Noto Sans CJK",
        style: "normal",
        weight: 500,
        unitsPerEm: 1000,
        missingGlyphPolicy: "error" as const
      }),
      glyphs: Object.freeze(glyphs)
    }),
    pixels: surfacePixels
  });
}

function sourceLuminance(
  pixels: Uint8Array,
  render: EffectToolRenderSettings,
  u: number,
  v: number
): number {
  const x = Math.max(0, Math.min(render.width - 1, Math.round(u * (render.width - 1))));
  const y = Math.max(0, Math.min(render.height - 1, Math.round(v * (render.height - 1))));
  const offset = (y * render.width + x) * 4;
  const alpha = pixels[offset + 3]! / 255;
  return alpha * (pixels[offset]! * 0.2126 + pixels[offset + 1]! * 0.7152
    + pixels[offset + 2]! * 0.0722) / 255;
}

function derivedVisualContour(
  pixels: Uint8Array,
  render: EffectToolRenderSettings
): readonly Readonly<{ x: number; y: number }>[] {
  const count = 32;
  const radii = Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + index / count * Math.PI * 2;
    let radius = 0.32;
    let strongest = -1;
    for (let step = 4; step <= 22; step += 1) {
      const candidate = 0.1 + step / 22 * 0.38;
      const outer = Math.min(0.49, candidate + 0.018);
      const innerValue = sourceLuminance(
        pixels,
        render,
        0.5 + Math.cos(angle) * candidate,
        0.5 + Math.sin(angle) * candidate
      );
      const outerValue = sourceLuminance(
        pixels,
        render,
        0.5 + Math.cos(angle) * outer,
        0.5 + Math.sin(angle) * outer
      );
      const score = Math.abs(innerValue - outerValue);
      if (score > strongest) {
        strongest = score;
        radius = candidate;
      }
    }
    return strongest < 0.025 ? 0.34 + Math.sin(angle * 3) * 0.035 : radius;
  });
  return Object.freeze(radii.map((radius, index) => {
    const previous = radii[(index + count - 1) % count]!;
    const next = radii[(index + 1) % count]!;
    const smoothed = previous * 0.2 + radius * 0.6 + next * 0.2;
    const angle = -Math.PI / 2 + index / count * Math.PI * 2;
    return Object.freeze({
      x: 0.5 + Math.cos(angle) * smoothed,
      y: 0.5 + Math.sin(angle) * smoothed
    });
  }));
}

function pixelContour(
  pixels: Uint8Array,
  render: EffectToolRenderSettings
): readonly Readonly<{ x: number; y: number }>[] {
  return Object.freeze(derivedVisualContour(pixels, render).map((point) => Object.freeze({
    x: point.x * (render.width - 1),
    y: point.y * (render.height - 1)
  })));
}

function derivedFeaturePath(
  pixels: Uint8Array,
  render: EffectToolRenderSettings
): readonly Readonly<{ x: number; y: number }>[] {
  const pointCount = 11;
  return Object.freeze(Array.from({ length: pointCount }, (_, index) => {
    const u = 0.08 + index / (pointCount - 1) * 0.84;
    let bestV = 0.5 + Math.sin(index * 1.17) * 0.08;
    let bestScore = 0;
    for (let step = 2; step <= 18; step += 1) {
      const v = 0.12 + step / 20 * 0.76;
      const score = Math.abs(
        sourceLuminance(pixels, render, u, Math.max(0, v - 0.025))
        - sourceLuminance(pixels, render, u, Math.min(1, v + 0.025))
      );
      if (score > bestScore) {
        bestScore = score;
        bestV = v;
      }
    }
    return Object.freeze({ x: u * (render.width - 1), y: bestV * (render.height - 1) });
  }));
}

function transformedContour(
  pixels: Uint8Array,
  render: EffectToolRenderSettings,
  scale: number,
  shiftX: number,
  rotation: number
): readonly Readonly<{ x: number; y: number }>[] {
  const contour = pixelContour(pixels, render);
  const centerX = contour.reduce((sum, point) => sum + point.x, 0) / contour.length;
  const centerY = contour.reduce((sum, point) => sum + point.y, 0) / contour.length;
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  return Object.freeze(contour.map((point) => {
    const dx = (point.x - centerX) * scale;
    const dy = (point.y - centerY) * scale;
    return Object.freeze({
      x: centerX + dx * cosine - dy * sine + render.width * shiftX,
      y: centerY + dx * sine + dy * cosine
    });
  }));
}

function derivedPaintStrokes(
  pixels: Uint8Array,
  render: EffectToolRenderSettings
): readonly Readonly<{
  points: readonly Readonly<{ x: number; y: number }>[];
  closed: boolean;
}>[] {
  const rowCount = Math.max(8, Math.min(24, Math.ceil(render.height / 18)));
  const rows = Array.from({ length: rowCount }, (_, row) => {
    const progress = row / Math.max(1, rowCount - 1);
    const baseY = 0.08 + progress * 0.84;
    const points = Array.from({ length: 9 }, (_, column) => {
      const forward = row % 2 === 0;
      const u = 0.06 + (forward ? column : 8 - column) / 8 * 0.88;
      const detail = (sourceLuminance(pixels, render, u, baseY) - 0.5) * 0.035;
      return Object.freeze({
        x: u * (render.width - 1),
        y: Math.max(0, Math.min(1, baseY + detail)) * (render.height - 1)
      });
    });
    return Object.freeze({ points: Object.freeze(points), closed: false });
  });
  return Object.freeze([
    ...rows,
    Object.freeze({ points: pixelContour(pixels, render), closed: true })
  ]);
}

function derivedVectorRasterSource(
  pixels: Uint8Array,
  render: EffectToolRenderSettings
): VectorRasterSource {
  const points = derivedVisualContour(pixels, render);
  const commands: VectorPathCommand[] = points.map((point, index) => index === 0
    ? { op: "move", x: point.x, y: point.y }
    : { op: "line", x: point.x, y: point.y });
  commands.push({ op: "close" });
  return Object.freeze({
    kind: "shape",
    viewport: Object.freeze({ x: 0, y: 0, width: 1, height: 1 }),
    paths: Object.freeze([Object.freeze({
      commands: Object.freeze(commands),
      fillRule: "nonzero" as const,
      fill: null,
      stroke: "#42c8ff",
      strokeWidth: 0.03
    })])
  });
}

function previewDataBinding(
  definition: EffectToolDefinition,
  slot: EffectInputSlotDefinition,
  pixels: Uint8Array,
  render: EffectToolRenderSettings
): unknown {
  const sample = previewColor(pixels);
  const path = previewPath(render);
  if (definition.toolName === "blob_morph" && slot.name === "source_shape") {
    return { points: pixelContour(pixels, render), closed: true };
  }
  if (definition.toolName === "lightning_trace" && slot.name === "guide_path") {
    return { points: derivedFeaturePath(pixels, render), closed: false };
  }
  if (definition.toolName === "shape_boolean_animate" && slot.name === "shape_a") {
    return { points: transformedContour(pixels, render, 0.86, -0.08, -0.08), closed: true };
  }
  if (definition.toolName === "shape_boolean_animate" && slot.name === "shape_b") {
    return { points: transformedContour(pixels, render, 0.68, 0.12, 0.38), closed: true };
  }
  if (definition.toolName === "wave_path" && slot.name === "source_path") {
    return { points: derivedFeaturePath(pixels, render), closed: false };
  }
  if (definition.toolName === "paint_on" && slot.name === "stroke_plan") {
    return { strokes: derivedPaintStrokes(pixels, render) };
  }
  if (definition.toolName === "smart_crop_animate" && slot.name === "subject_tracks") {
    const contour = derivedVisualContour(pixels, render);
    const centerX = contour.reduce((sum, point) => sum + point.x, 0) / contour.length;
    const centerY = contour.reduce((sum, point) => sum + point.y, 0) / contour.length;
    return {
      subjects: [{ samples: [
        { time: 0, centerX, centerY, width: 0.28, height: 0.46 },
        { time: 30, centerX: Math.max(0.2, Math.min(0.8, centerX + 0.12)), centerY, width: 0.28, height: 0.46 }
      ] }]
    };
  }
  switch (slot.name) {
    case "audio_analysis": return previewAudioBinding(definition, render);
    case "validated_binding": {
      const cycleSeconds = 3.2;
      const phase = render.time / cycleSeconds * Math.PI * 2 - Math.PI / 2;
      const previousPhase = (render.time - 1 / Math.max(1, render.fps))
        / cycleSeconds * Math.PI * 2 - Math.PI / 2;
      return {
        version: "validated-live-binding-v1",
        value: 0.5 + Math.sin(phase) * 0.46,
        previousValue: 0.5 + Math.sin(previousPhase) * 0.46,
        minimum: 0,
        maximum: 1,
        targetHandle: "preview-layer",
        targetProperty: "opacity"
      };
    }
    case "target_effect": return { version: "effect-target-v1", handle: "preview-effect" };
    case "text_layer": return { version: "text-layer-v1", layerHandle: "preview-text" };
    case "text_font": return { version: "font-binding-v1", fontHandle: "preview-font" };
    case "target_layer":
      return definition.toolName === "glass" || definition.toolName === "hologram" || definition.toolName === "metal"
        ? { version: "material-surface-v1", baseColor: sample, facing: 0.72, luminance: (sample[0] + sample[1] + sample[2]) / 3 }
        : { version: "pixel-layer-v1", sample };
    case "backdrop_layer":
    case "base_layer": return { version: "pixel-layer-v1", sample };
    case "camera_target": return { x: 0, y: 0, z: 0 };
    case "motion_path":
    case "stroke_path": return definition.primaryBackend.backendId === EXISTING_BACKEND
      ? { path: definition.toolName === "text_path_reveal" || definition.toolName === "handwriting"
        ? "M 0.08 0.68 C 0.28 0.15 0.72 0.85 0.92 0.28"
        : "M 48 240 C 180 48 420 312 592 120" }
      : { points: path, closed: false };
    case "morph_paths": return {
      fromPath: "M 0.18 0.22 L 0.82 0.22 L 0.82 0.78 L 0.18 0.78 Z",
      toPath: "M 0.5 0.08 C 0.86 0.08 0.92 0.38 0.92 0.5 C 0.92 0.78 0.72 0.92 0.5 0.92 C 0.2 0.92 0.08 0.7 0.08 0.5 C 0.08 0.2 0.28 0.08 0.5 0.08 Z"
    };
    case "stroke_plan": return { strokes: [{ points: path, closed: false }] };
    case "vector_field": return {
      columns: 2, rows: 2,
      vectors: [{ x: 0.4, y: -0.2 }, { x: 0.2, y: 0.4 }, { x: -0.3, y: 0.2 }, { x: -0.2, y: -0.4 }]
    };
    case "pins": return { indices: [0, 1] };
    case "environment_texture":
    case "overlay_texture": return {
      version: "texture-sample-v1", width: render.width, height: render.height, sample
    };
    case "depth_map": return definition.toolName === "hologram"
      ? { version: "depth-sample-v1", depth: 0.58 }
      : { width: render.width, height: render.height, data: luminanceValues(pixels) };
    default:
      if (slot.kind === "font") return { version: "font-binding-v1", fontHandle: "preview-font" };
      if (slot.kind === "model") return { version: "model-binding-v1", modelHandle: "preview-model" };
      if (/path|shape|terminals|contour/u.test(slot.name)) return { points: path, closed: /shape|contour/u.test(slot.name) };
      if (/mask/u.test(slot.name)) return {
        width: render.width, height: render.height, values: luminanceValues(pixels)
      };
      return { version: "preview-data-v1", width: render.width, height: render.height, sample };
  }
}

function syntheticPreviewPixels(
  definition: EffectToolDefinition,
  render: EffectToolRenderSettings
): Uint8Array {
  const output = new Uint8Array(render.width * render.height * 4);
  let hash = 2166136261;
  for (const code of definition.toolName) hash = Math.imul(hash ^ code.charCodeAt(0), 16777619);
  const accent = [72 + (hash >>> 16 & 63), 132 + (hash >>> 8 & 79), 156 + (hash & 79)] as const;
  for (let y = 0; y < render.height; y += 1) {
    for (let x = 0; x < render.width; x += 1) {
      const u = (x + 0.5) / render.width;
      const v = (y + 0.5) / render.height;
      const dx = (u - 0.5) / 0.31;
      const dy = (v - 0.5) / 0.34;
      const edge = dx * dx + dy * dy;
      const ripple = Math.sin(Math.atan2(dy, dx) * 5 + hash * 0.000001) * 0.08;
      if (edge > 1 + ripple) continue;
      const offset = (y * render.width + x) * 4;
      const light = Math.max(0, 1 - edge) * 54;
      output[offset] = Math.min(255, Math.round(accent[0] + light));
      output[offset + 1] = Math.min(255, Math.round(accent[1] + light));
      output[offset + 2] = Math.min(255, Math.round(accent[2] + light));
      output[offset + 3] = 255;
    }
  }
  return output;
}

function syntheticMedia(
  definition: EffectToolDefinition,
  render: EffectToolRenderSettings,
  byteLength: number
): VerifiedStoredMedia {
  const id = `server_generated_${definition.toolName}`;
  return {
    asset: {
      id,
      type: "image",
      uri: `media://${id}`,
      hash: `sha256:${id}`,
      metadata: { mime: "image/png", width: render.width, height: render.height, codec: "png" }
    },
    descriptor: { id, type: "media/image", cacheKey: id, metadata: {} },
    storedPath: `server-generated:${definition.toolName}`,
    arkEligibility: { filesApi: false, videoTos: false, base64OrUrl: false, reason: "server-generated" },
    trustedBytes: byteLength
  };
}

function syntheticInputBinding(
  definition: EffectToolDefinition,
  slot: EffectInputSlotDefinition,
  render: EffectToolRenderSettings
): unknown {
  const pixels = syntheticPreviewPixels(definition, render);
  if (definition.primaryBackend.backendId !== EXISTING_BACKEND) {
    return previewDataBinding(definition, slot, pixels, render);
  }
  if (slot.name === "brush_texture") {
    return {
      reference: "builtin://codemotion/default-brush",
      coverage: {
        width: render.width,
        height: render.height,
        data: derivedBrushCoverage(pixels, render),
        rowOrder: "top-to-bottom"
      }
    };
  }
  if (definition.toolName === "text_path_reveal" && slot.name === "motion_path") {
    return Object.freeze({ path: "M 0.08 0.62 C 0.3 0.18 0.7 0.82 0.92 0.38" });
  }
  return legacyRasterBinding(
    definition,
    slot,
    syntheticMedia(definition, render, pixels.byteLength),
    pixels,
    render
  );
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
  const derivedText = slot.name === "text_raster" && IMAGE_DERIVED_TEXT_TOOLS.has(definition.toolName)
    ? defaultTextRasterBinding(media, pixels, render)
    : undefined;
  const derivedVector = slot.name === "vector_source" && IMAGE_DERIVED_VECTOR_TOOLS.has(definition.toolName);
  const source = derivedText?.source
    ?? (derivedVector
      ? derivedVectorRasterSource(pixels, render)
      : {
          kind,
          assetId: media.asset.id,
          assetHash: media.asset.hash ?? "",
          frameTime: render.time,
          pixels: {
            width: render.width,
            height: render.height,
            data: pixels,
            colorSpace: "srgb" as const,
            alphaMode: "straight" as const,
            rowOrder: "top-to-bottom" as const
          }
        });
  const rasterInput: LayerRasterizationInput = {
    layerId,
    layerType: source.kind,
    source,
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
      data: new Uint8ClampedArray(derivedText?.pixels ?? pixels),
      colorSpace: "srgb" as const,
      alphaMode: "straight" as const
    },
    rasterInput
  };
}

interface EffectToolResolveCache {
  readonly media: Map<string, Promise<VerifiedStoredMedia>>;
  readonly pixels: Map<string, Promise<Uint8Array>>;
}

export class TenantMediaEffectToolInputResolver implements EffectToolInputResolver {
  constructor(
    private readonly media: TenantMediaStore,
    private readonly serverResources?: EffectToolServerResourceResolver,
    private readonly decodeFrame: typeof decodeMediaFrame = decodeMediaFrame,
    private readonly segmentation?: Sam31SegmentationService
  ) {}

  async visionImage(
    principal: EffectToolPrincipal,
    definition: EffectToolDefinition,
    inputIds: EffectToolInputIds,
    signal?: AbortSignal
  ): Promise<SelectedToolVisionImage | undefined> {
    const slotName = VISION_POSITIONING_SLOTS[definition.toolName];
    if (slotName === undefined) return undefined;
    const value = inputIds[slotName];
    const resourceId = typeof value === "string" ? value : value?.[0];
    if (resourceId === undefined) return undefined;
    const media = await this.media.resolve(ownerOf(principal), resourceId, signal);
    if (media.asset.type === "video") {
      const dimensions = materialOutputDimensions(media.asset.metadata.width, media.asset.metadata.height);
      if (dimensions === undefined) return undefined;
      const pixels = await this.decodeFrame(media, {
        frame: 0,
        time: 0,
        deltaTime: 1 / 30,
        fps: 30,
        width: dimensions.width,
        height: dimensions.height
      }, signal === undefined ? {} : { signal });
      if (pixels.length !== dimensions.width * dimensions.height * 4) return undefined;
      const png = new PNG({ width: dimensions.width, height: dimensions.height });
      png.data = Buffer.from(pixels);
      const bytes = PNG.sync.write(png);
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_VISION_IMAGE_BYTES) return undefined;
      return Object.freeze({ mimeType: "image/png", base64Data: bytes.toString("base64") });
    }
    if (media.asset.type !== "image" && media.asset.type !== "svg") return undefined;
    const proxy = media.asset.type === "svg";
    const path = proxy ? media.rasterProxyPath : media.storedPath;
    const mimeType = proxy ? "image/png" : media.asset.metadata.mime;
    const expectedHash = proxy ? media.asset.metadata.rasterProxyHash : media.asset.hash;
    if (path === undefined || (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp")
      || typeof expectedHash !== "string" || !/^sha256:[a-f0-9]{64}$/iu.test(expectedHash)) {
      return undefined;
    }
    const bytes = await readFile(path, signal === undefined ? undefined : { signal });
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_VISION_IMAGE_BYTES) return undefined;
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (`sha256:${actualHash}`.toLowerCase() !== expectedHash.toLowerCase()) {
      throw new ProviderError("security", "Authorized vision image changed before model positioning.");
    }
    return Object.freeze({ mimeType, base64Data: bytes.toString("base64") });
  }

  async outputDimensions(
    principal: EffectToolPrincipal,
    definition: EffectToolDefinition,
    inputIds: EffectToolInputIds,
    signal?: AbortSignal
  ): Promise<Readonly<{ width: number; height: number }> | undefined> {
    for (const slot of definition.inputSlots) {
      if (!acceptsUploadedImage(definition, slot) && !acceptsUploadedVideo(definition, slot)) continue;
      const value = inputIds[slot.name];
      const resourceId = typeof value === "string" ? value : value?.[0];
      if (resourceId === undefined) continue;
      const media = await this.media.resolve(ownerOf(principal), resourceId, signal);
      if (media.asset.type !== "image" && media.asset.type !== "svg" && media.asset.type !== "video") continue;
      const dimensions = materialOutputDimensions(media.asset.metadata.width, media.asset.metadata.height);
      if (dimensions !== undefined) return dimensions;
    }
    return undefined;
  }

  async resolve(
    principal: EffectToolPrincipal,
    definition: EffectToolDefinition,
    inputIds: EffectToolInputIds,
    render: EffectToolRenderSettings,
    signal?: AbortSignal,
    effectParams?: Readonly<JsonObject>
  ): Promise<AuthorizedEffectInputs> {
    const owner = ownerOf(principal);
    const raw = exactObject(inputIds, "inputIds");
    const declared = new Map(definition.inputSlots.map((slot) => [slot.name, slot]));
    if (Object.keys(raw).some((name) => !declared.has(name))) {
      throw new TypeError("inputIds contains an unknown slot.");
    }
    const output: Record<string, AuthorizedEffectInput | readonly AuthorizedEffectInput[]> = {};
    const cache: EffectToolResolveCache = { media: new Map(), pixels: new Map() };
    const previewResourceId = Object.values(raw).flatMap((value) =>
      typeof value === "string" ? [value] : Array.isArray(value) ? value : [])
      .find((value): value is string => typeof value === "string" && RESOURCE_ID.test(value));
    for (const slot of definition.inputSlots) {
      if (isSyntheticDerivedInputSlot(definition, slot)) {
        output[slot.name] = Object.freeze({
          slot: slot.name,
          kind: slot.kind,
          tenantId: principal.tenantId,
          userId: principal.userId,
          locked: true as const,
          binding: syntheticInputBinding(definition, slot, render)
        });
        continue;
      }
      if (SAM_DERIVED_MASK_SOURCES[definition.toolName]?.[slot.name] !== undefined
        && effectParams === undefined) continue;
      const derivedResourceId = derivedInputResourceId(definition, slot, raw);
      const value = raw[slot.name] ?? derivedResourceId ?? (slot.required && previewResourceId !== undefined
        ? slot.cardinality === "many" ? [previewResourceId] : previewResourceId
        : undefined);
      if (value === undefined) {
        if (slot.required) {
          throw new MissingEffectToolInputError([requirementView(definition, slot)]);
        }
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
        binding: await this.binding(owner, definition, slot, id, render, signal, cache, effectParams)
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
    signal?: AbortSignal,
    cache?: EffectToolResolveCache,
    effectParams?: Readonly<JsonObject>
  ): Promise<unknown> {
    const existing = definition.primaryBackend.backendId === EXISTING_BACKEND;
    const derivedFromImage = ["glass", "hologram", "metal"].includes(definition.toolName)
      && isServerDerivedInputSlot(definition, slot);
    const mediaKind = slot.kind === "image" || slot.kind === "video" || slot.kind === "audio"
      || slot.kind === "mask" || slot.kind === "depth-map" || slot.kind === "texture" || slot.kind === "lut"
      || derivedFromImage
      || existing && ["source_layer", "source_frame", "target_frame", "overlay_layer",
        "displacement_map", "mask_layer", "matte_layer", "brush_texture"].includes(slot.name);
    if (!mediaKind && this.serverResources !== undefined) {
      return this.serverResources.resolve(owner, definition, slot, resourceId, render, signal);
    }
    let mediaPromise = cache?.media.get(resourceId);
    if (mediaPromise === undefined) {
      mediaPromise = this.media.resolve(owner, resourceId, signal);
      cache?.media.set(resourceId, mediaPromise);
    }
    const media = await mediaPromise;
    if (SAM_DERIVED_MASK_SOURCES[definition.toolName]?.[slot.name] !== undefined) {
      const target = effectParams?.target;
      if (this.segmentation === undefined || typeof target !== "string") {
        throw new Error("SAM3.1 segmentation is unavailable for this effect.");
      }
      if (media.asset.type === "video") {
        const frame = await this.decodeFrame(media, {
          frame: 0,
          time: 0,
          deltaTime: 1 / render.fps,
          fps: render.fps,
          width: render.width,
          height: render.height
        }, signal === undefined ? {} : { signal });
        return this.segmentation.segmentRgbaFrame(frame, render.width, render.height, target, signal);
      }
      return this.segmentation.segment(media, target, render.width, render.height, signal);
    }
    if (slot.kind === "audio" && media.asset.type === "audio") {
      const analysisDuration = Math.min(10,
        Math.max(0.1, Number(media.asset.metadata.duration ?? 0.1)));
      const pcm = await decodeAudioPreview(media, analysisDuration, signal === undefined ? {} : { signal });
      return audioBinding(
        pcm,
        analysisDuration,
        definition
      );
    }
    const kind = visualKind(media.asset);
    if (kind === undefined) {
      throw new TypeError(`${slot.name} requires an authorized ${slot.kind} visual resource.`);
    }
    if (STRICT_VIDEO_INPUT_TOOLS.has(definition.toolName) && slot.kind === "video" && kind !== "video") {
      throw new TypeError(`${slot.name} requires an authorized video asset.`);
    }
    if (["background_remove_compose", "image_depth_parallax", "ken_burns", "object_explode", "photo_stack", "text_logo_reveal"]
      .includes(definition.toolName) && slot.kind === "image" && kind !== "image") {
      throw new TypeError(`${slot.name} requires an authorized image asset.`);
    }
    const pixelCacheKey = JSON.stringify([
      resourceId, render.time, render.fps, render.width, render.height
    ]);
    let pixelsPromise = cache?.pixels.get(pixelCacheKey);
    if (pixelsPromise === undefined) {
      pixelsPromise = this.decodeFrame(media, {
        frame: Math.floor(render.time * render.fps),
        time: render.time,
        deltaTime: 1 / render.fps,
        fps: render.fps,
        width: render.width,
        height: render.height
      }, signal === undefined ? {} : { signal });
      cache?.pixels.set(pixelCacheKey, pixelsPromise);
    }
    const decodedPixels = await pixelsPromise;
    const pixels = definition.toolName === "blend"
      ? new Uint8Array(decodedPixels)
      : derivedPreviewPixels(decodedPixels, slot, render);
    if (existing) {
      if (slot.name === "brush_texture") {
        return {
          reference: `asset://${media.asset.id}`,
          coverage: {
            width: render.width,
            height: render.height,
            data: derivedBrushCoverage(pixels, render),
            rowOrder: "top-to-bottom"
          }
        };
      }
      if (slot.name === "motion_path" || slot.name === "stroke_path" || slot.name === "morph_paths") {
        return previewDataBinding(definition, slot, pixels, render);
      }
      return legacyRasterBinding(definition, slot, media, pixels, render);
    }
    if (!mediaKind || slot.kind === "audio" || slot.kind === "font" || slot.kind === "model"
      || slot.kind === "data") {
      return previewDataBinding(definition, slot, pixels, render);
    }
    if (slot.kind === "mask") {
      const values = luminanceValues(pixels);
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
    if (slot.kind === "video" || slot.kind === "image") {
      return { version: "rgba8-frame-v1", width: render.width, height: render.height, data: pixels };
    }
    return previewDataBinding(definition, slot, pixels, render);
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
    return Object.freeze(this.registry.list().map(toolIdentity));
  }

  catalog(): readonly EffectToolCatalogItem[] {
    return Object.freeze(this.registry.list().map((definition) => {
      assertRequiredInputCoverage(definition);
      return Object.freeze({
        ...toolIdentity(definition),
        configured: this.configured,
        inputRequirements: Object.freeze(definition.inputSlots.map((slot) =>
          requirementView(definition, slot)))
      });
    }));
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
      const preliminaryInputs = await this.inputs.resolve(principal, definition, request.inputIds, render, signal);
      const envelope = await this.generateForDefinition(principal, definition, request.prompt, signal);
      const inputs = SAM_DERIVED_MASK_TOOLS.has(definition.toolName)
        ? await this.inputs.resolve(principal, definition, request.inputIds, render, signal, envelope.data)
        : preliminaryInputs;
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
          content: safeChineseBody(modelTurn.content)
        });
      }
      if (modelTurn.toolCall.name !== definition.toolName) {
        throw new ProviderError("security", "Ark attempted an unexpected tool call.");
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
        nativeArguments.durationSeconds,
        VIDEO_GENERATION_MODE_FPS[nativeArguments.generationMode],
        request.prompt
      );
      const normalizedArguments = Object.freeze({
        effectParams: structuredClone(envelope.data),
        output: Object.freeze({
          durationSeconds: nativeArguments.durationSeconds,
          generationMode: nativeArguments.generationMode
        })
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
          generationMode: nativeArguments.generationMode,
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
        content: safeChineseBody(finalTurn.content),
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
            generationMode: nativeArguments.generationMode,
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

  async selectedTurn(
    principal: EffectToolPrincipal,
    request: {
      readonly toolName: string;
      readonly prompt: string;
      readonly inputIds: EffectToolInputIds;
    }
  ): Promise<SelectedEffectToolTurnView> {
    if (this.closing) throw new ProviderError("cancelled", "Effect tool service is closing.");
    const owner = ownerOf(principal);
    const definition = this.selected(request.toolName);
    const identity = toolIdentity(definition);
    if (typeof request.prompt !== "string" || request.prompt.trim().length === 0
      || request.prompt.length > 10_000) {
      throw new TypeError("prompt is required and must not exceed 10000 characters.");
    }
    validateSelectedInputIds(definition, request.inputIds, false);
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      const fieldSpec = await loadEffectFieldSpec(definition.toolName);
      const provider = conversationProvider(this.provider);
      const visionImage = await this.inputs.visionImage?.(
        principal,
        definition,
        request.inputIds,
        controller.signal
      );
      const providerRequest = {
        requestId: randomUUID(),
        tenantId: principal.tenantId,
        userId: principal.userId,
        toolName: definition.toolName,
        prompt: request.prompt,
        fieldSpec,
        parameterSchema: definition.parameterSchema,
        ...(visionImage === undefined ? {} : { visionImage }),
        signal: controller.signal
      } as const;
      const modelTurn = await provider.respond(providerRequest);
      if (modelTurn.toolCall === undefined) {
        return Object.freeze({
          kind: "message",
          tool: identity,
          reasoningContent: modelTurn.reasoningContent,
          content: safeChineseBody(modelTurn.content)
        });
      }
      if (modelTurn.toolCall.name !== definition.toolName) {
        throw new ProviderError("security", "Ark attempted an unexpected tool call.");
      }
      const nativeArguments = nativeConversationArguments(modelTurn.toolCall.arguments);
      const explicitOutputDuration = parseExplicitOutputDuration(request.prompt);
      if (explicitOutputDuration.kind === "invalid") {
        throw new RangeError(`Explicit output duration is invalid: ${explicitOutputDuration.code}.`);
      }
      const requestedDuration = explicitOutputDuration.kind === "valid"
        ? explicitOutputDuration.seconds : nativeArguments.durationSeconds;
      if (requestedDuration < SELECTED_TOOL_MIN_DURATION_SECONDS
        || requestedDuration > SELECTED_TOOL_MAX_DURATION_SECONDS) {
        throw new RangeError("Explicit output duration is outside the selected-tool limits.");
      }
      const envelope = validateAndNormalizeEffectEnvelope(definition, definition.toolName, {
        type: definition.toolName,
        data: nativeArguments.effectParams
      });
      const rawInputIds = validateSelectedInputIds(definition, request.inputIds, true);
      const dimensions = await this.inputs.outputDimensions?.(
        principal,
        definition,
        rawInputIds,
        controller.signal
      );
      const render = renderSettings(dimensions);
      const authorizedInputs = await this.inputs.resolve(
        principal,
        definition,
        rawInputIds,
        render,
        controller.signal,
        envelope.data
      );
      if (this.nativeVideos === undefined) throw new Error("Effect video service is unavailable.");
      const assetIds = Object.values(rawInputIds).flatMap((value) => typeof value === "string" ? [value] : [...value]);
      const declaredSourceImageId = definition.inputSlots.flatMap((slot) => {
        if (slot.kind !== "image") return [];
        const value = rawInputIds[slot.name];
        return typeof value === "string" ? [value] : value === undefined ? [] : [...value];
      })[0];
      const blendSourceId = definition.toolName === "blend" ? rawInputIds.source_layer : undefined;
      const sourceImageId = definition.toolName === "glass" ? undefined
        : typeof blendSourceId === "string" ? blendSourceId : declaredSourceImageId;
      const execution = await this.nativeVideos.createPrepared(
        owner,
        definition,
        envelope,
        authorizedInputs,
        assetIds,
        20260814,
        requestedDuration,
        render.width,
        render.height,
        sourceImageId,
        VIDEO_GENERATION_MODE_FPS[nativeArguments.generationMode],
        rawInputIds,
        explicitOutputDuration.kind === "none",
        request.prompt
      );
      const normalizedArguments = Object.freeze({
        effectParams: structuredClone(envelope.data),
        output: Object.freeze({
          durationSeconds: execution.video.durationSeconds,
          generationMode: nativeArguments.generationMode
        })
      });
      const normalizedCall = Object.freeze({
        id: modelTurn.toolCall.id,
        name: definition.toolName,
        arguments: normalizedArguments
      });
      const finalTurn = await provider.finalize(providerRequest, normalizedCall, Object.freeze({
        status: execution.status,
        output: Object.freeze({
          format: execution.video.format,
          mime: execution.video.mime,
          durationSeconds: execution.video.durationSeconds,
          generationMode: nativeArguments.generationMode,
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
        tool: identity,
        reasoningContent: [modelTurn.reasoningContent, finalTurn.reasoningContent]
          .filter((value) => value.trim().length > 0).join("\n\n"),
        content: safeChineseBody(finalTurn.content, rawInputIds),
        toolCall: Object.freeze({
          id: modelTurn.toolCall.id,
          type: "function",
          function: Object.freeze({
            name: definition.toolName,
            arguments: structuredClone(normalizedArguments)
          })
        }),
        executionInput: Object.freeze({
          authorizedInputs: authorizedInputSummary(definition, authorizedInputs),
          effectParams: structuredClone(envelope.data),
          output: Object.freeze({
            durationSeconds: execution.video.durationSeconds,
            generationMode: nativeArguments.generationMode,
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

  openSelfCheckEvidence(
    principal: EffectToolPrincipal,
    id: string,
    evidenceId: string
  ): Promise<EffectToolEvidenceFile> {
    if (this.nativeVideos === undefined) throw new Error("Effect video service is unavailable.");
    return this.nativeVideos.openSelfCheckEvidence(ownerOf(principal), id, evidenceId);
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
    if (typeof toolName !== "string" || !TOOL_NAME.test(toolName)) {
      throw new TypeError("toolName must be an exact snake_case tool name.");
    }
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
    const inputs = await this.inputs.resolve(principal, definition, inputIds, render, signal, envelope.data);
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
    new TenantMediaEffectToolInputResolver(
      media,
      serverResources,
      decodeMediaFrame,
      createSam31SegmentationService(env, fetchImpl)
    ),
    EFFECT_TOOL_REGISTRY,
    new EffectToolVideoService({
      media,
      outputRoot: videoOutputRoot,
      ...(env.FFMPEG_PATH === undefined ? {} : { ffmpegPath: env.FFMPEG_PATH }),
      ...(apiKey === undefined || apiKey.trim().length < 10 ? {} : {
        requestedSelfCheckApiKey: apiKey,
        ...(fetchImpl === undefined ? {} : { requestedSelfCheckFetchImpl: fetchImpl }),
        finalVideoSelfCheckReviewer: new VolcengineArkUnifiedSelfCheckReviewer({
          apiKey,
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
          audit: (record) => process.stderr.write(`[effect-tool-self-check] ${JSON.stringify(record)}\n`)
        }),
        listedToolSelfCheckReviewer: new VolcengineArkUnifiedSelfCheckReviewer({
          apiKey,
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
          audit: (record) => process.stderr.write(`[effect-tool-self-check] ${JSON.stringify(record)}\n`)
        }),
        additionalSelfCheckReviewer: new VolcengineArkUnifiedSelfCheckReviewer({
          apiKey,
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
          audit: (record) => process.stderr.write(`[effect-tool-self-check] ${JSON.stringify(record)}\n`)
        }),
        wavePathSelfCheckReviewer: new VolcengineArkWavePathSelfCheckReviewer({
          apiKey,
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
          audit: (record) => process.stderr.write(`[effect-tool-self-check] ${JSON.stringify(record)}\n`)
        }),
        observedMotionSelfCheckReviewer: new VolcengineArkObservedMotionSelfCheckReviewer({
          apiKey,
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
          audit: (record) => process.stderr.write(`[effect-tool-self-check] ${JSON.stringify(record)}\n`)
        }),
        dedicatedSelfCheckReviewer: new VolcengineArkDedicatedSelfCheckReviewer({
          apiKey,
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
          audit: (record) => process.stderr.write(`[effect-tool-self-check] ${JSON.stringify(record)}\n`)
        }),
        visualSelfCheckReviewer: new VolcengineArkVisualSelfCheckReviewer({
          apiKey,
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
          audit: (record) => process.stderr.write(`[effect-tool-self-check] ${JSON.stringify(record)}\n`)
        }),
        observableSelfCheckReviewer: new VolcengineArkObservableSelfCheckReviewer({
          apiKey,
          ...(fetchImpl === undefined ? {} : { fetchImpl }),
          audit: (record) => process.stderr.write(`[effect-tool-self-check] ${JSON.stringify(record)}\n`)
        })
      })
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

function safeError(error: unknown): {
  status: number;
  code: string;
  requirements?: readonly EffectToolInputRequirementView[];
} {
  if (error instanceof AuthHttpError) return { status: error.status, code: error.code };
  if (error instanceof MissingEffectToolInputError) {
    return { status: 422, code: "MISSING_REQUIRED_INPUTS", requirements: error.requirements };
  }
  if (error instanceof Sam31SegmentationError) {
    if (error.code === "target_not_found") return { status: 422, code: "SAM31_TARGET_NOT_FOUND" };
    if (error.code === "unsupported_media") return { status: 422, code: "SAM31_UNSUPPORTED_MEDIA" };
    if (error.code === "invalid_input") return { status: 422, code: "SAM31_INPUT_INVALID" };
    if (error.code === "gateway_unavailable") return { status: 503, code: "SAM31_GATEWAY_UNAVAILABLE" };
    if (error.code === "model_unavailable") return { status: 503, code: "SAM31_MODEL_UNAVAILABLE" };
    return { status: 503, code: "SAM31_UNAVAILABLE" };
  }
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

async function pipeSelfCheckEvidence(response: ServerResponse, file: EffectToolEvidenceFile): Promise<void> {
  response.statusCode = 200;
  response.setHeader("content-type", file.mime);
  response.setHeader("content-length", String(file.bytes));
  response.setHeader("cache-control", "private, no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("content-disposition", `inline; filename="${file.name}"`);
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
    const selectedTools = url.pathname === "/api/effect-tools/v3";
    const selectedTurns = url.pathname === "/api/effect-tools/v3/turns";
    const execution = /^\/api\/effect-tools\/v1\/executions\/([^/]+)$/u.exec(url.pathname);
    const nativeExecution = /^\/api\/effect-tools\/v2\/executions\/([^/]+)$/u.exec(url.pathname);
    const nativeVideo = /^\/api\/effect-tools\/v2\/executions\/([^/]+)\/video$/u.exec(url.pathname);
    const nativeDownload = /^\/api\/effect-tools\/v2\/executions\/([^/]+)\/download$/u.exec(url.pathname);
    const selectedExecution = /^\/api\/effect-tools\/v3\/executions\/([^/]+)$/u.exec(url.pathname);
    const selectedVideo = /^\/api\/effect-tools\/v3\/executions\/([^/]+)\/video$/u.exec(url.pathname);
    const selectedDownload = /^\/api\/effect-tools\/v3\/executions\/([^/]+)\/download$/u.exec(url.pathname);
    const selectedEvidence = /^\/api\/effect-tools\/v3\/executions\/([^/]+)\/self-check\/evidence\/([a-z][a-z0-9_]{2,63})$/u
      .exec(url.pathname);
    const matched = request.method === "GET" && (collection || nativeTool || selectedTools || execution !== null)
      || request.method === "GET" && (nativeExecution !== null || nativeVideo !== null || nativeDownload !== null
        || selectedExecution !== null || selectedVideo !== null || selectedDownload !== null
        || selectedEvidence !== null)
      || request.method === "POST" && (parameters || executions || nativeTurns || selectedTurns);
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
      if (request.method === "GET" && selectedTools) {
        await auth.authorize(request, response, "ai:plan", false);
        const tools = service.catalog();
        return sendJson(response, 200, { tools, count: tools.length });
      }
      if (request.method === "GET" && (nativeExecution || selectedExecution)) {
        const principal = await auth.authorize(request, response, "project:preview", false);
        const match = nativeExecution ?? selectedExecution!;
        return sendJson(response, 200, {
          execution: service.videoExecution(principal, decodeURIComponent(match[1]!))
        });
      }
      if (request.method === "GET" && selectedEvidence) {
        const principal = await auth.authorize(request, response, "project:preview", false);
        const file = await service.openSelfCheckEvidence(
          principal,
          decodeURIComponent(selectedEvidence[1]!),
          selectedEvidence[2]!
        );
        await pipeSelfCheckEvidence(response, file);
        return;
      }
      if (request.method === "GET" && (nativeVideo || nativeDownload || selectedVideo || selectedDownload)) {
        const download = nativeDownload !== null || selectedDownload !== null;
        const match = nativeDownload ?? nativeVideo ?? selectedDownload ?? selectedVideo!;
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
      if (selectedTurns) {
        const principal = await auth.authorize(request, response, "project:preview", true);
        if (!principal.scopes.includes("ai:plan")) throw new AuthHttpError(403, "FORBIDDEN");
        const body = exactObject(await jsonBody(request), "request body");
        exactKeys(body, ["toolName", "prompt", "inputIds"], "request body");
        const turn = await service.selectedTurn(principal, {
          toolName: body.toolName as string,
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
        sendJson(response, safe.status, {
          error: {
            code: safe.code,
            retryable: safe.status >= 500,
            ...(safe.requirements === undefined ? {} : { requirements: safe.requirements })
          }
        });
      }
    }
  };
}
