import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  ENGINE_VERSION,
  PROJECT_SCHEMA_VERSION,
  TIME_CONTRACT_VERSION,
  type Animatable,
  type AssetDefinition,
  type EffectInstance,
  type JsonObject,
  type JsonValue,
  type LayerDefinition,
  type MotionProject,
  type TransformDefinition
} from "@codemotion/core";
import {
  P0_EFFECTS,
  P0_EFFECTS_BY_ID,
  effectCardForEffectId,
  effectCardSearchTerms,
  explicitEffectCardRequest,
  resolveFormal2dRasterSourceV1,
  type P0CatalogEffectDefinition
} from "@codemotion/effects-2d";
import {
  createProjectFrameProducer,
  decodeMediaFrame,
  verifyStoredMediaAsset,
  type ImportedMedia
} from "@codemotion/exporter";
import type { CoverageBuffer } from "@codemotion/renderer-api";
import { validateContract } from "@codemotion/schema";
import type {
  BrandConstraint,
  LocalResourceInput,
  ModelEffectSelection,
  ModelStoryboard,
  NormalizedUnderstanding,
  TimeRange,
  UnderstandingResult
} from "./provider.js";
import { coverageAsset } from "./raster-sources.js";

interface StoryboardLayerBase extends JsonObject {
  id: string;
  description: string;
}

export type StoryboardLayer =
  | (StoryboardLayerBase & { type: "text"; text: string; localAssetId?: never })
  | (StoryboardLayerBase & { type: "svg"; text?: never; localAssetId?: never })
  | (StoryboardLayerBase & {
    type: "image" | "video";
    text?: never;
    localAssetId: string;
  });

export interface StoryboardEffect extends JsonObject {
  sourceId: string;
  effectId: string;
  effectVersion: string;
  targetLayerId: string;
  params: JsonObject;
}

export interface StoryboardShot extends JsonObject {
  id: string;
  range: TimeRange;
  description: string;
  layers: StoryboardLayer[];
  effects: StoryboardEffect[];
}

export interface Storyboard extends JsonObject {
  intent: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  style: string[];
  brand: ModelStoryboard["brand"];
  requirements: string[];
  constraints: string[];
  shots: StoryboardShot[];
}

export interface StaticIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface LowResolutionPreview {
  readonly width: 160;
  readonly height: 90;
  readonly projectId: string;
  readonly timeContractVersion: typeof TIME_CONTRACT_VERSION;
  readonly frameNumbers: readonly number[];
  readonly frameTimes: readonly number[];
  readonly frameHashes: readonly string[];
  readonly quality: "draft";
}

/**
 * @deprecated Server-only planning DTO. Never serialize this value as a browser or API response;
 * use serializeAiPlanCompletedResultV2 instead.
 */
export interface PlannedAnimation {
  readonly understanding: NormalizedUnderstanding;
  readonly storyboard: Storyboard;
  readonly dsl: MotionProject;
  readonly issues: readonly StaticIssue[];
  readonly preview: LowResolutionPreview;
  readonly trace: UnderstandingResult["trace"];
}

export interface PlanningOptions {
  readonly resources?: readonly LocalResourceInput[];
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly duration?: number;
  readonly style?: readonly string[];
  readonly brand?: BrandConstraint;
  readonly maxHeavyEffects?: number;
  readonly text?: string;
  readonly prompt?: string;
  readonly transform?: TransformDefinition;
  readonly effectIds?: readonly string[];
  readonly previewFrameLimit?: number;
  readonly ffmpegPath?: string;
  readonly signal?: AbortSignal;
}

const constant = <T extends JsonValue>(value: T): Animatable<T> => ({ mode: "constant", value });

function defaultTransform(duration: number, width: number): TransformDefinition {
  return {
    anchorPoint: constant({ x: 0, y: 0, z: 0 }),
    position: {
      mode: "keyframes",
      keyframes: [
        { time: 0, value: { x: 0, y: 0, z: 0 }, interpolation: "linear" },
        { time: duration, value: { x: width * 0.03, y: 0, z: 0 }, interpolation: "linear" }
      ]
    },
    scale: constant({ x: 100, y: 100, z: 100 }),
    rotation: constant({ x: 0, y: 0, z: 0 })
  };
}

function centeredTextTransform(width: number, height: number): TransformDefinition {
  return {
    anchorPoint: constant({ x: width / 2, y: height / 2, z: 0 }),
    position: constant({ x: width / 2, y: height / 2, z: 0 }),
    scale: constant({ x: 100, y: 100, z: 100 }),
    rotation: constant({ x: 0, y: 0, z: 0 })
  };
}

function visibleLayerName(layer: StoryboardLayer, index: number): string {
  if (layer.type === "text") {
    const text = layer.text.trim();
    return text.length > 0 ? `文字：${[...text].slice(0, 10).join("")}${[...text].length > 10 ? "…" : ""}` : "文字层";
  }
  if (layer.type === "image") return `图片素材 ${index + 1}`;
  if (layer.type === "video") return `视频素材 ${index + 1}`;
  return `图形层 ${index + 1}`;
}

function semanticTerms(value: NormalizedUnderstanding): string[] {
  const ignored = new Set(["with", "from", "this", "that", "the", "and", "for", "create", "make"]);
  return [
    ...value.text.requirements,
    ...value.text.constraints,
    ...value.images.flatMap((image) => [...image.subjects, ...image.style, ...image.colors]),
    ...value.audio.flatMap((audio) => [...audio.emotion, audio.bgm, audio.rhythm]),
    ...value.video.flatMap((video) => video.shots.flatMap((shot) => [shot.action, shot.event]))
  ].join(" ").toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .map((term) => term.replace(/(?:ing|ed|es|s)$/u, ""))
    .filter((term) => term.length > 1 && !ignored.has(term));
}

function semanticText(value: NormalizedUnderstanding): string {
  return [
    ...value.text.requirements,
    ...value.text.constraints,
    ...value.images.flatMap((image) => [...image.subjects, ...image.style, ...image.colors]),
    ...value.audio.flatMap((audio) => [...audio.emotion, audio.bgm, audio.rhythm]),
    ...value.video.flatMap((video) => video.shots.flatMap((shot) => [shot.action, shot.event]))
  ].join(" ").toLocaleLowerCase();
}

export function retrieveP0Effects(
  understanding: NormalizedUnderstanding,
  limit = 3
): readonly P0CatalogEffectDefinition[] {
  const terms = new Set(semanticTerms(understanding));
  const fullText = semanticText(understanding);
  const explicit = explicitEffectCardRequest(fullText);
  return [...P0_EFFECTS].map((effect, index) => {
    const card = effectCardForEffectId(effect.effectId);
    const searchable = [
      effect.effectId,
      effect.displayName,
      effect.description,
      effect.category,
      ...effect.tags,
      ...(card ? effectCardSearchTerms(card) : [])
    ].join(" ").toLowerCase();
    let score = 0;
    for (const term of terms) if (searchable.includes(term)) score += 1;
    if (card) {
      for (const phrase of effectCardSearchTerms(card)) {
        const normalized = phrase.toLocaleLowerCase();
        if (normalized.length >= 2 && fullText.includes(normalized)) score += 3;
      }
    }
    if (explicit?.effectId === effect.effectId) score += 100;
    if (effect.performanceClass === "light") score += 0.25;
    return { effect, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Math.min(limit, P0_EFFECTS.length)))
    .map((entry) => entry.effect);
}

function effectCanRender(
  effect: P0CatalogEffectDefinition,
  resources: readonly LocalResourceInput[]
): boolean {
  const visualResources = resources.filter((item) => item.modality === "image" || item.modality === "video");
  if (effect.category === "light" || effect.category === "post") return visualResources.length === 1;
  if (effect.category === "transition" || effect.category === "composite") {
    return visualResources.length === 2;
  }
  return true;
}

function targetLayer(
  effect: P0CatalogEffectDefinition,
  layers: readonly StoryboardLayer[]
): StoryboardLayer {
  const matching = effect.category === "text" || effect.effectId === "fx.draw.handwriting"
    ? layers.find((layer) => layer.type === "text")
    : effect.category === "vector" || effect.category === "draw"
      ? layers.find((layer) => layer.type === "svg")
      : effect.category === "light" || effect.category === "post"
        ? layers.find((layer) => layer.type === "image" || layer.type === "video")
        : effect.category === "transition" || effect.category === "composite"
          ? layers.find((layer) => layer.type === "image" || layer.type === "video")
          : layers.find((layer) => layer.type === "image" || layer.type === "video")
            ?? layers.find((layer) => layer.type === "text" || layer.type === "svg");
  if (matching === undefined) {
    throw new Error(`No compatible target layer exists for ${effect.effectId}.`);
  }
  return matching;
}

function fallbackVectorLayer(
  effect: P0CatalogEffectDefinition,
  layers: StoryboardLayer[],
  shotLayerIds: Set<string>
): StoryboardLayer | undefined {
  if (effect.effectId === "fx.draw.handwriting"
    || (effect.category !== "vector" && effect.category !== "draw")) return undefined;
  const existing = layers.find((layer) => layer.id === "layer_vector" && layer.type === "svg");
  const layer: StoryboardLayer = existing ?? {
    id: "layer_vector",
    type: "svg",
    description: "Server-authored vector layer for a registered legacy effect"
  };
  if (existing === undefined) layers.push(layer);
  shotLayerIds.add(layer.id);
  return layer;
}

function exactIds(label: string, expected: readonly string[], actual: readonly string[]): void {
  if (actual.length !== expected.length || new Set(actual).size !== actual.length) {
    throw new Error(`${label} contains duplicate, missing, or extra localAssetId values.`);
  }
  const expectedSet = new Set(expected);
  if (actual.some((id) => !expectedSet.has(id)) || expected.some((id) => !actual.includes(id))) {
    throw new Error(`${label} contains an unknown or missing localAssetId.`);
  }
}

function forbiddenModelValue(value: unknown): boolean {
  if (typeof value === "string") {
    return /(?:https?|file):\/\//iu.test(value)
      || /(?:^|[\s"'(])(?:[A-Za-z]:\\|\/(?:etc|home|Users|var|tmp)\/)/u.test(value)
      || /(?:bearer|api[_-]?key|secret)\s+[A-Za-z0-9._-]{12,}/iu.test(value);
  }
  if (Array.isArray(value)) return value.some(forbiddenModelValue);
  return typeof value === "object" && value !== null && Object.values(value).some(forbiddenModelValue);
}

function effectMatchesLayer(
  definition: P0CatalogEffectDefinition,
  layer: StoryboardLayer
): boolean {
  if (definition.category === "text" || definition.effectId === "fx.draw.handwriting") return layer.type === "text";
  if (definition.category === "vector" || definition.category === "draw") return layer.type === "svg";
  if (definition.category === "light" || definition.category === "post"
    || definition.category === "transition" || definition.category === "composite") {
    return layer.type === "image" || layer.type === "video";
  }
  return true;
}

function authoritativeDefaultParams(definition: P0CatalogEffectDefinition): JsonObject {
  return structuredClone(effectCardForEffectId(definition.effectId)?.defaultParams ?? definition.defaultPreset);
}

function effectSelection(
  selection: ModelEffectSelection,
  layers: readonly StoryboardLayer[],
  shotLayerIds: ReadonlySet<string>,
  resources: readonly LocalResourceInput[]
): StoryboardEffect {
  const definition = P0_EFFECTS_BY_ID.get(selection.effectId);
  if (definition === undefined
    || definition.sourceId !== selection.sourceId
    || definition.version !== selection.effectVersion) {
    throw new Error(`Model effect selection ${selection.effectId} does not match the authoritative P0 definition.`);
  }
  const layer = layers.find((candidate) => candidate.id === selection.targetLayerId);
  if (layer === undefined || !shotLayerIds.has(layer.id)) {
    throw new Error(`Model effect ${selection.effectId} targets an undeclared shot layer.`);
  }
  if (!effectMatchesLayer(definition, layer)) {
    throw new Error(`Model effect ${selection.effectId} is incompatible with layer ${layer.id}.`);
  }
  if (!effectCanRender(definition, resources)) {
    throw new Error(`Model effect ${selection.effectId} does not match the supplied visual asset count.`);
  }
  return {
    sourceId: definition.sourceId,
    effectId: definition.effectId,
    effectVersion: definition.version,
    targetLayerId: layer.id,
    params: authoritativeDefaultParams(definition)
  };
}

function validatedStoryboard(
  result: UnderstandingResult,
  resources: readonly LocalResourceInput[],
  options: PlanningOptions
): Storyboard {
  if (result.contract !== "ai-task/v1" || result.storyboard === undefined) {
    throw new Error("AI provider did not return the required ai-task/v1 Storyboard.");
  }
  if (forbiddenModelValue(result.storyboard)) {
    throw new Error("AI Storyboard contains a forbidden external identity or credential-like value.");
  }
  const retrieved = retrieveP0Effects(result.understanding, P0_EFFECTS.length);
  if (retrieved.length !== 40 || retrieved.length !== P0_EFFECTS.length
    || retrieved.some((entry) => P0_EFFECTS_BY_ID.get(entry.effectId) !== entry)) {
    throw new Error("AI retrieval did not use the complete authoritative P0 catalog.");
  }
  const expectedByModality = {
    image: resources.filter((item) => item.modality === "image").map((item) => item.localAssetId),
    audio: resources.filter((item) => item.modality === "audio").map((item) => item.localAssetId),
    video: resources.filter((item) => item.modality === "video").map((item) => item.localAssetId)
  };
  exactIds("Image understanding", expectedByModality.image, result.understanding.images.map((item) => item.localAssetId));
  exactIds("Audio understanding", expectedByModality.audio, result.understanding.audio.map((item) => item.localAssetId));
  exactIds("Video understanding", expectedByModality.video, result.understanding.video.map((item) => item.localAssetId));

  const model = result.storyboard;
  const layers: StoryboardLayer[] = model.layers.map((layer) => ({ ...layer }));
  const layerIds = layers.map((layer) => layer.id);
  if (new Set(layerIds).size !== layerIds.length) throw new Error("AI Storyboard contains duplicate layer IDs.");
  const visualLayers = layers.filter((layer) => layer.type === "image" || layer.type === "video");
  const visualIds = visualLayers.map((layer) => layer.localAssetId).filter((id): id is string => id !== undefined);
  exactIds("Storyboard visual layers", [...expectedByModality.image, ...expectedByModality.video], visualIds);
  for (const layer of layers) {
    if ((layer.type === "image" || layer.type === "video") !== (layer.localAssetId !== undefined)) {
      throw new Error(`Storyboard layer ${layer.id} has an invalid localAssetId binding.`);
    }
    if (layer.localAssetId !== undefined) {
      const resource = resources.find((item) => item.localAssetId === layer.localAssetId);
      if (resource === undefined || resource.modality !== layer.type) {
        throw new Error(`Storyboard layer ${layer.id} has an unknown or mismatched localAssetId.`);
      }
    }
  }
  const expectedStyle = options.style;
  if (expectedStyle !== undefined && JSON.stringify(model.style) !== JSON.stringify(expectedStyle)) {
    throw new Error("AI Storyboard did not preserve the requested style constraints.");
  }
  if (options.brand !== undefined && JSON.stringify(model.brand) !== JSON.stringify(options.brand)) {
    throw new Error("AI Storyboard did not preserve the requested brand constraints.");
  }
  const authorizedLogos = new Set(resources
    .filter((item) => item.modality === "image")
    .map((item) => item.localAssetId));
  if (model.brand.logoAssetIds.some((id) => !authorizedLogos.has(id))) {
    throw new Error("AI Storyboard brand references an unauthorized logo asset.");
  }
  const displayTexts = layers
    .filter((layer): layer is Extract<StoryboardLayer, { type: "text" }> => layer.type === "text")
    .map((layer) => layer.text);
  if (displayTexts.some((text) => text.trim().length === 0)) {
    throw new Error("AI Storyboard contains an empty text layer display value.");
  }
  if (model.brand.requiredText.some((required) =>
    !displayTexts.some((displayText) => displayText.includes(required)))) {
    throw new Error("AI Storyboard omitted required brand text from its visible text layers.");
  }
  const plannedContent = [
    model.intent,
    ...layers.flatMap((layer) => layer.type === "text"
      ? [layer.description, layer.text]
      : [layer.description]),
    ...model.shots.map((shot) => shot.description)
  ].join("\n");
  if (model.brand.forbiddenContent.some((text) =>
    text.length > 0 && plannedContent.toLowerCase().includes(text.toLowerCase()))) {
    throw new Error("AI Storyboard contains forbidden brand content.");
  }

  const duration = options.duration ?? model.duration;
  const width = options.width ?? model.width;
  const height = options.height ?? model.height;
  const fps = options.fps ?? model.fps;
  if (!Number.isFinite(duration) || duration < 0.5 || duration > 60
    || !Number.isInteger(width) || width < 2 || width > 8192
    || !Number.isInteger(height) || height < 2 || height > 8192
    || width * height > 33_554_432
    || !Number.isInteger(fps) || fps < 1 || fps > 60) {
    throw new Error("AI Storyboard canvas, fps, or duration is outside ai-task/v1 limits.");
  }
  const scale = duration / model.duration;
  const shotIds = model.shots.map((shot) => shot.id);
  if (new Set(shotIds).size !== shotIds.length) throw new Error("AI Storyboard contains duplicate shot IDs.");
  const requestedEffectIds = options.effectIds;
  const requestedDefinitions = requestedEffectIds?.map((effectId) => {
    const definition = P0_EFFECTS_BY_ID.get(effectId);
    if (definition === undefined) throw new RangeError(`Unknown planning effect ${effectId}.`);
    if (!effectCanRender(definition, resources)) {
      throw new RangeError(`Effect ${effectId} requires visual media that was not supplied.`);
    }
    return definition;
  });
  if (requestedDefinitions !== undefined
    && (requestedDefinitions.length === 0
      || new Set(requestedDefinitions.map((item) => item.effectId)).size !== requestedDefinitions.length)) {
    throw new RangeError("Planning effectIds must be non-empty and unique.");
  }
  const shots = model.shots.map((shot): StoryboardShot => {
    if (shot.end <= shot.start || shot.end > model.duration) {
      throw new Error(`AI Storyboard shot ${shot.id} has an invalid range.`);
    }
    const shotLayerIds = new Set(shot.layerIds);
    if (shotLayerIds.size !== shot.layerIds.length
      || shot.layerIds.some((id) => !layerIds.includes(id))) {
      throw new Error(`AI Storyboard shot ${shot.id} references duplicate or unknown layers.`);
    }
    const effects = requestedDefinitions === undefined
      ? shot.effects.map((selection) => effectSelection(selection, layers, shotLayerIds, resources))
      : requestedDefinitions.map((definition): StoryboardEffect => {
        const modelTargetId = shot.effects[0]?.targetLayerId;
        const modelTarget = layers.find((item) => item.id === modelTargetId && shotLayerIds.has(item.id));
        let layer = modelTarget && effectMatchesLayer(definition, modelTarget)
          ? modelTarget
          : layers.filter((item) => shotLayerIds.has(item.id))
            .find((item) => effectMatchesLayer(definition, item));
        layer ??= fallbackVectorLayer(definition, layers, shotLayerIds);
        layer ??= targetLayer(definition, layers.filter((item) => shotLayerIds.has(item.id)));
        return {
          sourceId: definition.sourceId,
          effectId: definition.effectId,
          effectVersion: definition.version,
          targetLayerId: layer.id,
          params: authoritativeDefaultParams(definition)
        };
      });
    if (effects.length === 0) throw new Error(`AI Storyboard shot ${shot.id} has no model-planned effect.`);
    return {
      id: shot.id,
      range: { start: shot.start * scale, end: shot.end * scale },
      description: shot.description,
      layers: layers.filter((layer) => shotLayerIds.has(layer.id)),
      effects
    };
  });
  return {
    intent: model.intent,
    duration,
    width,
    height,
    fps,
    style: [...model.style],
    brand: structuredClone(model.brand),
    requirements: result.understanding.text.requirements,
    constraints: result.understanding.text.constraints,
    shots
  };
}

function effectInstance(effect: StoryboardEffect, range: TimeRange, identity: string): EffectInstance {
  const definition = P0_EFFECTS_BY_ID.get(effect.effectId);
  if (definition === undefined
    || effect.sourceId !== definition.sourceId
    || effect.effectVersion !== definition.version) {
    throw new RangeError(`Unknown or stale planned effect ${effect.effectId}.`);
  }
  return {
    id: `effect_${identity}`,
    effectId: effect.effectId,
    version: definition.version,
    enabled: true,
    startTime: range.start,
    endTime: range.end,
    mix: constant(1),
    params: effect.params,
    renderQuality: "draft",
    cachePolicy: "range"
  };
}

function fixedEffectRange(effectId: string, range: TimeRange): TimeRange {
  const duration = effectId === "fx.motion.fade" || effectId === "fx.motion.slide" ? 1.2
    : effectId === "fx.transition.wipe" || effectId === "fx.composite.maskReveal" ? 1
      : range.end - range.start;
  return { start: range.start, end: Math.min(range.end, range.start + duration) };
}

function baseLayer(
  id: string,
  name: string,
  duration: number,
  effects: EffectInstance[],
  zIndex: number,
  layerTransform: TransformDefinition
) {
  return {
    id,
    name,
    visible: true,
    locked: false,
    solo: false,
    startTime: 0,
    endTime: duration,
    inPoint: 0,
    outPoint: duration,
    zIndex,
    transform: layerTransform,
    opacity: constant(1),
    blendMode: "normal" as const,
    masks: [],
    effects
  };
}

function generatedVectorPath(value: string): string {
  const digest = createHash("sha256").update(value).digest();
  const point = (index: number, floor: number, span: number) =>
    (floor + digest[index]! / 255 * span).toFixed(4);
  return `M${point(0, 0.06, 0.18)},${point(1, 0.5, 0.3)} `
    + `C${point(2, 0.18, 0.18)},${point(3, 0.05, 0.25)} `
    + `${point(4, 0.56, 0.18)},${point(5, 0.08, 0.24)} `
    + `${point(6, 0.78, 0.16)},${point(7, 0.5, 0.3)} `
    + `L${point(8, 0.58, 0.22)},${point(9, 0.76, 0.16)} `
    + `L${point(10, 0.18, 0.18)},${point(11, 0.76, 0.16)} Z`;
}

function toLayer(
  layer: StoryboardLayer,
  asset: AssetDefinition | undefined,
  storyboard: Storyboard,
  options: PlanningOptions,
  zIndex: number
): LayerDefinition {
  const mediaDuration = asset?.metadata.duration;
  const layerDuration = layer.type === "video"
    && typeof mediaDuration === "number"
    && Number.isFinite(mediaDuration)
    && mediaDuration > 0
    ? Math.min(storyboard.duration, mediaDuration)
    : storyboard.duration;
  const effects = storyboard.shots.flatMap((shot, shotIndex) => shot.effects
    .filter((item) => item.targetLayerId === layer.id && shot.range.start < layerDuration)
    .map((item, effectIndex) => effectInstance(
      item,
      fixedEffectRange(item.effectId, { start: shot.range.start, end: Math.min(shot.range.end, layerDuration) }),
      `${shotIndex + 1}_${effectIndex + 1}_${layer.id}`
    )));
  const base = baseLayer(
    layer.id,
    visibleLayerName(layer, zIndex),
    layerDuration,
    effects,
    zIndex,
    options.transform ?? (layer.type === "text"
      ? centeredTextTransform(storyboard.width, storyboard.height)
      : defaultTransform(storyboard.duration, storyboard.width))
  );
  if (layer.type === "image") {
    if (asset === undefined) throw new Error(`Storyboard image layer ${layer.id} has no verified asset.`);
    return { ...base, type: "image", source: { assetId: asset.id }, properties: { fit: "contain" } };
  }
  if (layer.type === "video") {
    if (asset === undefined) throw new Error(`Storyboard video layer ${layer.id} has no verified asset.`);
    return { ...base, type: "video", source: { assetId: asset.id }, properties: { loop: false, muted: false } };
  }
  if (layer.type === "svg") {
    return {
      ...base,
      type: "svg",
      properties: {
        svg: generatedVectorPath(options.text ?? (storyboard.requirements.join("\n") || layer.description))
      }
    };
  }
  if (layer.type === "text") return {
    ...base,
    type: "text",
    properties: {
      text: layer.text,
      fontFamily: "Codemotion Planner Unicode Bitmap",
      fontSize: Math.max(48, Math.min(96, Math.floor(storyboard.width / Math.max(4, [...layer.text].length + 1)))),
      color: "#ffffff"
    }
  };
  throw new Error(`Storyboard layer ${layer.id} has an unsupported type.`);
}

function toDsl(
  storyboard: Storyboard,
  resources: readonly LocalResourceInput[],
  result: UnderstandingResult,
  options: PlanningOptions
): MotionProject {
  const assets = resources.map((resource) => resource.asset);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const storyboardLayers = [...new Map(storyboard.shots
    .flatMap((shot) => shot.layers)
    .map((layer) => [layer.id, layer])).values()];
  const layers = storyboardLayers.map((layer, index) =>
    toLayer(
      layer,
      layer.localAssetId === undefined ? undefined : assetById.get(layer.localAssetId),
      storyboard,
      options,
      index
    )
  );
  const sourceAudioTracks = resources.filter((resource) => resource.modality === "video"
    && Number(resource.asset.metadata.audioStreams ?? 0) > 0).map((resource, index) => ({
    id: `audio_source_${index + 1}`,
    assetId: resource.localAssetId,
    startTime: 0,
    endTime: Math.min(storyboard.duration, Number(resource.asset.metadata.duration ?? storyboard.duration)),
    volume: constant(/(?:去掉|移除|关闭|静音).{0,6}原声|原声.{0,6}(?:去掉|移除|关闭|静音)/u.test(options.prompt ?? "") ? 0 : 1)
  }));
  const backgroundAudioTracks = resources.filter((resource) => resource.modality === "audio").map((resource, index) => ({
    id: `audio_bgm_${index + 1}`,
    assetId: resource.localAssetId,
    startTime: 0,
    endTime: Math.min(storyboard.duration, Number(resource.asset.metadata.duration ?? storyboard.duration)),
    volume: constant(0.35)
  }));
  const audioTracks = [...sourceAudioTracks, ...backgroundAudioTracks];
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    id: `project_${result.trace.inputHash.slice(-24)}`,
    name: "AI 生成动画",
    width: storyboard.width,
    height: storyboard.height,
    fps: storyboard.fps,
    duration: storyboard.duration,
    background: { type: "color", color: "#101014" },
    colorSpace: "srgb",
    seed: Number.parseInt(result.trace.inputHash.slice(-8), 16),
    assets,
    compositions: [{
      id: "composition_main",
      name: "Main",
      width: storyboard.width,
      height: storyboard.height,
      duration: storyboard.duration,
      fps: storyboard.fps,
      layers
    }],
    fonts: [{
      id: "font.codemotion.unicode-bitmap-v1",
      family: "Codemotion Planner Unicode Bitmap"
    }],
    audioTracks,
    renderPresets: [],
    metadata: {
      timeContractVersion: TIME_CONTRACT_VERSION,
      ai: {
        provider: result.trace.provider,
        modelId: result.trace.modelId,
        requestFingerprint: result.trace.requestFingerprint,
        inputHash: result.trace.inputHash,
        confidence: result.understanding.confidence,
        risks: result.understanding.risks,
        usage: result.trace.usage
      }
    }
  };
}

function assertFinalBrandText(project: MotionProject, brand: BrandConstraint): void {
  const displayTexts = project.compositions.flatMap((composition) => composition.layers
    .filter((layer): layer is Extract<LayerDefinition, { type: "text" }> => layer.type === "text")
    .map((layer) => layer.properties.text));
  if (brand.requiredText.some((required) =>
    !displayTexts.some((displayText) => displayText.includes(required)))) {
    throw new Error("Final AI DSL omitted required brand text from its visible text layers.");
  }
  if (brand.forbiddenContent.some((forbidden) => forbidden.length > 0
    && displayTexts.some((displayText) => displayText.toLowerCase().includes(forbidden.toLowerCase())))) {
    throw new Error("Final AI DSL contains forbidden brand content in a visible text layer.");
  }
}

function isAnimatableValue(value: unknown): value is Animatable {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && "mode" in value
    && ((value as { mode?: unknown }).mode === "constant"
      || (value as { mode?: unknown }).mode === "keyframes"
      || (value as { mode?: unknown }).mode === "expression"
      || (value as { mode?: unknown }).mode === "binding");
}

function parameterSnapshots(params: EffectInstance["params"]): readonly JsonObject[] {
  const base: JsonObject = {};
  const keyed = new Map<string, JsonValue[]>();
  for (const [name, value] of Object.entries(params)) {
    if (!isAnimatableValue(value)) {
      base[name] = value;
    } else if (value.mode === "constant") {
      base[name] = value.value;
    } else if (value.mode === "keyframes") {
      const values = value.keyframes.map((keyframe) => keyframe.value);
      if (values.length > 0) {
        base[name] = values[0]!;
        keyed.set(name, values);
      }
    }
  }
  return [
    base,
    ...[...keyed].flatMap(([name, values]) => values.map((value) => ({ ...base, [name]: value })))
  ];
}

export function validatePlannedDsl(project: MotionProject, maxHeavyEffects = 3): readonly StaticIssue[] {
  const issues: StaticIssue[] = [];
  const schema = validateContract("MotionProject", project);
  if (!schema.valid) {
    for (const issue of schema.issues) {
      issues.push({ code: "schema", severity: "error", message: `${issue.instancePath}: ${issue.message}` });
    }
  }
  const assets = new Set(project.assets.map((asset) => asset.id));
  const effects = P0_EFFECTS_BY_ID;
  let heavy = 0;
  if (project.metadata.timeContractVersion !== TIME_CONTRACT_VERSION) {
    issues.push({ code: "time-contract", severity: "error", message: `AI projects require time contract ${TIME_CONTRACT_VERSION}.` });
  }
  for (const composition of project.compositions) {
    if (composition.duration <= 0 || composition.duration > project.duration) {
      issues.push({ code: "duration", severity: "error", message: "Composition duration is outside project duration." });
    }
    const layerIds = new Set(composition.layers.map((layer) => layer.id));
    for (const layer of composition.layers) {
      if (layer.endTime < layer.startTime || layer.outPoint < layer.inPoint || layer.endTime > composition.duration) {
        issues.push({ code: "duration", severity: "error", message: `Layer ${layer.id} has an invalid time range.` });
      }
      if (layer.source && !assets.has(layer.source.assetId)) {
        issues.push({ code: "reference", severity: "error", message: `Layer ${layer.id} references a missing asset.` });
      }
      if (layer.parentId && !layerIds.has(layer.parentId)) {
        issues.push({ code: "reference", severity: "error", message: `Layer ${layer.id} references a missing parent.` });
      }
      const parents = new Set<string>([layer.id]);
      let parentId = layer.parentId;
      while (parentId) {
        if (parents.has(parentId)) {
          issues.push({ code: "cycle", severity: "error", message: `Layer ${layer.id} has a parent cycle.` });
          break;
        }
        parents.add(parentId);
        parentId = composition.layers.find((candidate) => candidate.id === parentId)?.parentId;
      }
      for (const instance of layer.effects) {
        const definition = effects.get(instance.effectId);
        if (!definition) {
          issues.push({ code: "effect", severity: "error", message: `Unknown effect ${instance.effectId}.` });
          continue;
        }
        const validate = new Ajv2020({ allErrors: true, strict: false }).compile(definition.parameterSchema);
        if (instance.version !== definition.version) {
          issues.push({ code: "effect-version", severity: "error", message: `Effect ${instance.effectId} version is stale.` });
        }
        if (parameterSnapshots(instance.params).some((params) => !validate(params))) {
          issues.push({ code: "parameter", severity: "error", message: `Effect ${instance.effectId} parameters are invalid.` });
        }
        if (definition.performanceClass === "heavy" || definition.performanceClass === "extreme") heavy += 1;
      }
    }
  }
  for (const track of project.audioTracks) {
    if (!assets.has(track.assetId)) issues.push({ code: "reference", severity: "error", message: `Audio ${track.id} references a missing asset.` });
    if (track.endTime < track.startTime || track.endTime > project.duration) {
      issues.push({ code: "duration", severity: "error", message: `Audio ${track.id} has an invalid time range.` });
    }
  }
  if (heavy > maxHeavyEffects) {
    issues.push({ code: "performance", severity: "error", message: "Heavy effect budget exceeded." });
  }
  return issues;
}

function collectResourceIdentities(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value) && !value.startsWith("context://")) output.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectResourceIdentities(entry, output);
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) collectResourceIdentities(entry, output);
  }
}

function plannedCoverageAssets(project: MotionProject): ReadonlyMap<string, CoverageBuffer> {
  const identities = new Set<string>();
  for (const effect of project.compositions.flatMap((composition) =>
    composition.layers.flatMap((layer) => layer.effects))) {
    collectResourceIdentities(effect.params, identities);
  }
  return new Map([...identities].map((identity) => [identity, coverageAsset(identity)]));
}

async function verifiedVisualMedia(
  resources: readonly LocalResourceInput[],
  signal: AbortSignal | undefined
): Promise<ReadonlyMap<string, ImportedMedia>> {
  const visual = resources.filter((resource) =>
    resource.modality === "image" || resource.modality === "video");
  const imported = await Promise.all(visual.map((resource) => verifyStoredMediaAsset({
    asset: resource.asset,
    storageDirectory: resource.storageDirectory,
    ...(signal === undefined ? {} : { signal })
  })));
  return new Map(imported.map((entry) => [entry.asset.id, entry]));
}

function previewFrameNumbers(duration: number, fps: number, requestedLimit: number | undefined): readonly number[] {
  const limit = requestedLimit ?? 8;
  if (!Number.isInteger(limit) || limit < 1 || limit > 120) {
    throw new RangeError("previewFrameLimit must be an integer in [1, 120].");
  }
  const total = Math.max(1, Math.ceil(duration * fps));
  const count = Math.min(total, limit);
  if (count === 1) return [0];
  return [...new Set(Array.from({ length: count }, (_unused, index) =>
    Math.round(index * (total - 1) / (count - 1))))];
}

async function lowResolutionPreview(
  project: MotionProject,
  resources: readonly LocalResourceInput[],
  options: PlanningOptions
): Promise<LowResolutionPreview> {
  const width = 160;
  const height = 90;
  const frameNumbers = previewFrameNumbers(project.duration, project.fps, options.previewFrameLimit);
  options.signal?.throwIfAborted();
  const media = await verifiedVisualMedia(resources, options.signal);
  const producer = createProjectFrameProducer(project, media, {
    timeContractVersion: TIME_CONTRACT_VERSION,
    resolveRasterSource: async ({ composition, layer, request, projectTime, layerTime }) => {
      options.signal?.throwIfAborted();
      const formalSource = resolveFormal2dRasterSourceV1({
        layer,
        compositionWidth: composition.width,
        compositionHeight: composition.height,
        renderWidth: request.width,
        renderHeight: request.height,
        projectSeed: project.seed,
        projectTime: projectTime.projectTime,
        layerTime: layerTime.localTime,
        ...(options.signal === undefined ? {} : { signal: options.signal })
      });
      if (formalSource !== undefined) return formalSource;
      options.signal?.throwIfAborted();
      if ((layer.type !== "image" && layer.type !== "video") || layer.source === undefined) {
        throw new Error(`Layer ${layer.id} has no planned raster source.`);
      }
      const imported = media.get(layer.source.assetId);
      if (imported === undefined || imported.asset.hash === undefined) {
        throw new Error(`Layer ${layer.id} references unverified visual media.`);
      }
      const frameTime = layer.type === "image" ? 0 : layerTime.sourceTime;
      options.signal?.throwIfAborted();
      const pixels = await decodeMediaFrame(imported, { ...request, time: frameTime }, {
        ...(options.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath }),
        ...(options.signal === undefined ? {} : { signal: options.signal })
      });
      const metadataColorSpace = imported.asset.metadata.colorSpace;
      const colorSpace = metadataColorSpace === "display-p3" || metadataColorSpace === "linear-srgb"
        ? metadataColorSpace : "srgb";
      return {
        kind: layer.type,
        assetId: imported.asset.id,
        assetHash: imported.asset.hash,
        frameTime,
        pixels: {
          width: request.width,
          height: request.height,
          data: pixels,
          colorSpace,
          alphaMode: "straight",
          rowOrder: "top-to-bottom"
        }
      };
    },
    coverageAssets: plannedCoverageAssets(project),
    rejectBackgroundOnlyFrames: false,
    ...(options.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath })
  });
  const frames: string[] = [];
  for (const frame of frameNumbers) {
    options.signal?.throwIfAborted();
    const pixels = await producer({
      frame,
      time: frame / project.fps,
      deltaTime: frame === 0 ? 0 : 1 / project.fps,
      fps: project.fps,
      width,
      height
    }, options.signal);
    frames.push(`sha256:${createHash("sha256").update(pixels).digest("hex")}`);
  }
  return {
    width,
    height,
    projectId: project.id,
    timeContractVersion: TIME_CONTRACT_VERSION,
    frameNumbers,
    frameTimes: frameNumbers.map((frame) => frame / project.fps),
    frameHashes: frames,
    quality: "draft"
  };
}

export async function planAnimation(
  result: UnderstandingResult,
  options: PlanningOptions = {}
): Promise<PlannedAnimation> {
  const resources = options.resources ?? [];
  const storyboard = validatedStoryboard(result, resources, options);
  const dsl = toDsl(storyboard, resources, result, options);
  assertFinalBrandText(dsl, storyboard.brand);
  const issues = validatePlannedDsl(dsl, options.maxHeavyEffects);
  if (issues.some((issue) => issue.severity === "error")) {
    throw new Error(`AI planning static validation failed: ${issues.map((issue) => issue.code).join(", ")}`);
  }
  return {
    understanding: result.understanding,
    storyboard,
    dsl,
    issues,
    preview: await lowResolutionPreview(dsl, resources, options),
    trace: result.trace
  };
}
