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
import { GROUP_2_P0_EFFECTS, type P0EffectDefinition } from "@codemotion/effects-2d";
import {
  createProjectFrameProducer,
  decodeMediaFrame,
  verifyStoredMediaAsset,
  type ImportedMedia
} from "@codemotion/exporter";
import type { CoverageBuffer, LayerRasterSource } from "@codemotion/renderer-api";
import { validateContract } from "@codemotion/schema";
import type {
  LocalResourceInput,
  NormalizedUnderstanding,
  TimeRange,
  UnderstandingResult
} from "./provider.js";
import { coverageAsset, textRasterSource, vectorRasterSource } from "./raster-sources.js";

export interface StoryboardLayer extends JsonObject {
  id: string;
  type: "text" | "svg" | "image" | "video";
  localAssetId?: string;
  description: string;
}

export interface StoryboardEffect extends JsonObject {
  effectId: string;
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
  duration: number;
  width: number;
  height: number;
  fps: number;
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
  readonly maxHeavyEffects?: number;
  readonly text?: string;
  readonly transform?: TransformDefinition;
  readonly effectIds?: readonly string[];
  readonly effectParams?: Readonly<Record<string, JsonObject>>;
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

function semanticTerms(value: NormalizedUnderstanding): string[] {
  return [
    ...value.text.requirements,
    ...value.text.constraints,
    ...value.images.flatMap((image) => [...image.subjects, ...image.style, ...image.colors]),
    ...value.audio.flatMap((audio) => [...audio.emotion, audio.bgm, audio.rhythm]),
    ...value.video.flatMap((video) => video.shots.flatMap((shot) => [shot.action, shot.event]))
  ].join(" ").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 1);
}

export function retrieveP0Effects(
  understanding: NormalizedUnderstanding,
  limit = 3
): readonly P0EffectDefinition[] {
  const terms = new Set(semanticTerms(understanding));
  return [...GROUP_2_P0_EFFECTS].map((effect, index) => {
    const searchable = [
      effect.effectId,
      effect.displayName,
      effect.description,
      effect.category,
      ...effect.tags
    ].join(" ").toLowerCase();
    let score = 0;
    for (const term of terms) if (searchable.includes(term)) score += 1;
    if (effect.performanceClass === "light") score += 0.25;
    return { effect, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, Math.min(limit, GROUP_2_P0_EFFECTS.length)))
    .map((entry) => entry.effect);
}

function effectCanRender(
  effect: P0EffectDefinition,
  resources: readonly LocalResourceInput[]
): boolean {
  const visualResources = resources.filter((item) => item.modality === "image" || item.modality === "video");
  if (effect.category === "light" || effect.category === "post") return visualResources.length > 0;
  if (effect.category === "transition" || effect.category === "composite") {
    return visualResources.length > 0;
  }
  return true;
}

function selectEffects(
  understanding: NormalizedUnderstanding,
  resources: readonly LocalResourceInput[],
  requestedIds: readonly string[] | undefined
): readonly P0EffectDefinition[] {
  const byId = new Map(GROUP_2_P0_EFFECTS.map((effect) => [effect.effectId, effect]));
  if (requestedIds !== undefined) {
    if (requestedIds.length === 0) throw new RangeError("Planning effectIds must not be empty.");
    return requestedIds.map((effectId) => {
      const effect = byId.get(effectId);
      if (effect === undefined) throw new RangeError(`Unknown planning effect ${effectId}.`);
      if (!effectCanRender(effect, resources)) {
        throw new RangeError(`Effect ${effectId} requires visual media that was not supplied.`);
      }
      return effect;
    });
  }
  const compatible = retrieveP0Effects(understanding, GROUP_2_P0_EFFECTS.length)
    .filter((effect) => effectCanRender(effect, resources))
    .slice(0, 3);
  if (compatible.length === 0) throw new Error("No P0 effect is compatible with the planned layers.");
  return compatible;
}

function safeDuration(understanding: NormalizedUnderstanding, resources: readonly LocalResourceInput[], requested?: number): number {
  if (requested !== undefined) return Math.min(60, Math.max(0.5, requested));
  const mediaDuration = Math.max(0, ...resources.map((item) => {
    const duration = item.asset.metadata.duration;
    return typeof duration === "number" && Number.isFinite(duration) ? duration : 0;
  }));
  const videoEnd = Math.max(0, ...understanding.video.flatMap((video) => video.shots.map((shot) => shot.range.end)));
  return Math.min(60, Math.max(3, mediaDuration, videoEnd));
}

function storyboardLayers(
  resources: readonly LocalResourceInput[],
  understanding: NormalizedUnderstanding,
  effects: readonly P0EffectDefinition[],
  options: PlanningOptions
): StoryboardLayer[] {
  const layers: StoryboardLayer[] = [];
  for (const resource of resources) {
    if (resource.modality === "audio") continue;
    layers.push({
      id: `layer_${resource.localAssetId.slice(6)}`,
      type: resource.modality,
      localAssetId: resource.localAssetId,
      description: resource.modality === "image"
        ? (understanding.images.find((item) => item.localAssetId === resource.localAssetId)?.composition ?? "Reference image")
        : (understanding.video.find((item) => item.localAssetId === resource.localAssetId)?.shots[0]?.event ?? "Reference video")
    });
  }
  const text = options.text ?? understanding.text.requirements[0] ?? "";
  if (text.length > 0 || layers.length === 0) {
    layers.push({ id: "layer_title", type: "text", description: text || "Generated title" });
  }
  if (effects.some((effect) => effect.category === "vector" || effect.category === "draw")) {
    layers.push({ id: "layer_vector", type: "svg", description: `Vector content for ${text || "planned scene"}` });
  }
  return layers;
}

function targetLayer(
  effect: P0EffectDefinition,
  layers: readonly StoryboardLayer[]
): StoryboardLayer {
  const matching = effect.category === "text"
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

function makeStoryboard(
  understanding: NormalizedUnderstanding,
  effects: readonly P0EffectDefinition[],
  resources: readonly LocalResourceInput[],
  options: PlanningOptions
): Storyboard {
  const duration = safeDuration(understanding, resources, options.duration);
  const layers = storyboardLayers(resources, understanding, effects, options);
  const videoRanges = understanding.video.flatMap((video) => video.shots.map((shot) => ({
    range: shot.range,
    description: `${shot.event}: ${shot.action}`.trim()
  })));
  const shots = (videoRanges.length > 0 ? videoRanges : [{
    range: { start: 0, end: duration },
    description: understanding.text.requirements.join("; ") || "Generated motion scene"
  }]).map((shot, index): StoryboardShot => {
    const start = Math.max(0, Math.min(duration, shot.range.start));
    const end = Math.max(start, Math.min(duration, shot.range.end));
    const shotEffects = options.effectIds === undefined
      ? [effects[index % effects.length]!]
      : effects;
    return {
      id: `shot_${index + 1}`,
      range: { start, end },
      description: shot.description,
      layers,
      effects: shotEffects.map((effect) => ({
        effectId: effect.effectId,
        targetLayerId: targetLayer(effect, layers).id,
        params: {
          ...effect.defaultPreset,
          ...(options.effectParams?.[effect.effectId] ?? {})
        }
      }))
    };
  });
  return {
    duration,
    width: options.width ?? 1280,
    height: options.height ?? 720,
    fps: options.fps ?? 24,
    requirements: understanding.text.requirements,
    constraints: understanding.text.constraints,
    shots
  };
}

function effectInstance(effect: StoryboardEffect, range: TimeRange, identity: string): EffectInstance {
  const definition = GROUP_2_P0_EFFECTS.find((candidate) => candidate.effectId === effect.effectId);
  if (definition === undefined) throw new RangeError(`Unknown planned effect ${effect.effectId}.`);
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
      { start: shot.range.start, end: Math.min(shot.range.end, layerDuration) },
      `${shotIndex + 1}_${effectIndex + 1}_${layer.id}`
    )));
  const base = baseLayer(
    layer.id,
    layer.description.slice(0, 120),
    layerDuration,
    effects,
    zIndex,
    options.transform ?? defaultTransform(storyboard.duration, storyboard.width)
  );
  if (layer.type === "image" && asset) {
    return { ...base, type: "image", source: { assetId: asset.id }, properties: { fit: "contain" } };
  }
  if (layer.type === "video" && asset) {
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
  return {
    ...base,
    type: "text",
    properties: {
      text: options.text ?? storyboard.requirements[0] ?? layer.description,
      fontFamily: "Codemotion Planner Unicode Bitmap",
      fontSize: 64
    }
  };
}

function toDsl(
  storyboard: Storyboard,
  resources: readonly LocalResourceInput[],
  result: UnderstandingResult,
  options: PlanningOptions
): MotionProject {
  const assets = resources.map((resource) => resource.asset);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const layers = storyboard.shots[0]!.layers.map((layer, index) =>
    toLayer(
      layer,
      layer.localAssetId === undefined ? undefined : assetById.get(layer.localAssetId),
      storyboard,
      options,
      index
    )
  );
  const audioTracks = resources.filter((resource) => resource.modality === "audio").map((resource, index) => ({
    id: `audio_${index + 1}`,
    assetId: resource.localAssetId,
    startTime: 0,
    endTime: Math.min(storyboard.duration, Number(resource.asset.metadata.duration ?? storyboard.duration)),
    volume: constant(1)
  }));
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    id: `project_${result.trace.inputHash.slice(-24)}`,
    name: "AI planned animation",
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
      id: "font.ai-planner.unicode-bitmap",
      family: "Codemotion Planner Unicode Bitmap",
      style: "normal",
      weight: 500
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
  const effects = new Map(GROUP_2_P0_EFFECTS.map((effect) => [effect.effectId, effect]));
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

function plannedRasterSources(project: MotionProject): ReadonlyMap<string, LayerRasterSource> {
  const width = 160;
  const height = 90;
  const sources = new Map<string, LayerRasterSource>();
  for (const composition of project.compositions) {
    for (const layer of composition.layers) {
      if (layer.type === "text") {
        sources.set(layer.id, textRasterSource(
          layer.properties.text,
          layer.properties.fontFamily,
          layer.properties.fontSize,
          width,
          height,
          composition.width,
          composition.height
        ));
      } else if (layer.type === "svg" && typeof layer.properties.svg === "string") {
        sources.set(layer.id, vectorRasterSource(layer.properties.svg));
      }
    }
  }
  return sources;
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
  const media = await verifiedVisualMedia(resources, options.signal);
  const staticSources = plannedRasterSources(project);
  const producer = createProjectFrameProducer(project, media, {
    timeContractVersion: TIME_CONTRACT_VERSION,
    resolveRasterSource: async ({ layer, request, layerTime }) => {
      const staticSource = staticSources.get(layer.id);
      if (staticSource !== undefined) return staticSource;
      if ((layer.type !== "image" && layer.type !== "video") || layer.source === undefined) {
        throw new Error(`Layer ${layer.id} has no planned raster source.`);
      }
      const imported = media.get(layer.source.assetId);
      if (imported === undefined || imported.asset.hash === undefined) {
        throw new Error(`Layer ${layer.id} references unverified visual media.`);
      }
      const frameTime = layer.type === "image" ? 0 : layerTime.sourceTime;
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
  const frames = await Promise.all(frameNumbers.map(async (frame) => {
    options.signal?.throwIfAborted();
    const pixels = await producer({
      frame,
      time: frame / project.fps,
      deltaTime: frame === 0 ? 0 : 1 / project.fps,
      fps: project.fps,
      width,
      height
    }, options.signal);
    return `sha256:${createHash("sha256").update(pixels).digest("hex")}`;
  }));
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
  const effects = selectEffects(result.understanding, resources, options.effectIds);
  const storyboard = makeStoryboard(result.understanding, effects, resources, options);
  const dsl = toDsl(storyboard, resources, result, options);
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
