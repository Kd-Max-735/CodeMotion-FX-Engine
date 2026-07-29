import { createHash } from "node:crypto";
import { Ajv2020 } from "ajv/dist/2020.js";
import {
  ENGINE_VERSION,
  PROJECT_SCHEMA_VERSION,
  type Animatable,
  type AssetDefinition,
  type EffectInstance,
  type JsonObject,
  type JsonValue,
  type LayerDefinition,
  type MotionProject,
  type TransformDefinition
} from "@codemotion/core";
import { GROUP_2_P0_EFFECTS, type P0EffectDefinition, type PixelSurface } from "@codemotion/effects-2d";
import { validateContract } from "@codemotion/schema";
import type {
  LocalResourceInput,
  NormalizedUnderstanding,
  TimeRange,
  UnderstandingResult
} from "./provider.js";

export interface StoryboardLayer extends JsonObject {
  id: string;
  type: "text" | "image" | "video";
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
}

const constant = <T extends JsonValue>(value: T): Animatable<T> => ({ mode: "constant", value });

function transform(): TransformDefinition {
  return {
    anchorPoint: constant({ x: 0.5, y: 0.5, z: 0 }),
    position: constant({ x: 0, y: 0, z: 0 }),
    scale: constant({ x: 1, y: 1, z: 1 }),
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

function safeDuration(understanding: NormalizedUnderstanding, resources: readonly LocalResourceInput[], requested?: number): number {
  if (requested !== undefined) return Math.min(60, Math.max(0.5, requested));
  const mediaDuration = Math.max(0, ...resources.map((item) => {
    const duration = item.asset.metadata.duration;
    return typeof duration === "number" && Number.isFinite(duration) ? duration : 0;
  }));
  const videoEnd = Math.max(0, ...understanding.video.flatMap((video) => video.shots.map((shot) => shot.range.end)));
  return Math.min(60, Math.max(3, mediaDuration, videoEnd));
}

function storyboardLayers(resources: readonly LocalResourceInput[], understanding: NormalizedUnderstanding): StoryboardLayer[] {
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
  if (layers.length === 0) {
    layers.push({ id: "layer_title", type: "text", description: understanding.text.requirements[0] ?? "Generated title" });
  }
  return layers;
}

function makeStoryboard(
  understanding: NormalizedUnderstanding,
  effects: readonly P0EffectDefinition[],
  resources: readonly LocalResourceInput[],
  options: PlanningOptions
): Storyboard {
  const duration = safeDuration(understanding, resources, options.duration);
  const layers = storyboardLayers(resources, understanding);
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
    const effect = effects[index % effects.length]!;
    return {
      id: `shot_${index + 1}`,
      range: { start, end },
      description: shot.description,
      layers,
      effects: [{
        effectId: effect.effectId,
        targetLayerId: layers[0]!.id,
        params: { ...effect.defaultPreset }
      }]
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

function effectInstance(effect: StoryboardEffect, range: TimeRange, index: number): EffectInstance {
  return {
    id: `effect_${index + 1}`,
    effectId: effect.effectId,
    version: "1.0.0",
    enabled: true,
    startTime: range.start,
    endTime: range.end,
    mix: constant(1),
    params: effect.params,
    renderQuality: "draft",
    cachePolicy: "range"
  };
}

function baseLayer(id: string, name: string, duration: number, effects: EffectInstance[]) {
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
    zIndex: 0,
    transform: transform(),
    opacity: constant(1),
    blendMode: "normal" as const,
    masks: [],
    effects
  };
}

function toLayer(layer: StoryboardLayer, asset: AssetDefinition | undefined, storyboard: Storyboard): LayerDefinition {
  const effects = storyboard.shots.flatMap((shot, index) => shot.effects
    .filter((item) => item.targetLayerId === layer.id)
    .map((item) => effectInstance(item, shot.range, index)));
  const base = baseLayer(layer.id, layer.description.slice(0, 120), storyboard.duration, effects);
  if (layer.type === "image" && asset) {
    return { ...base, type: "image", source: { assetId: asset.id }, properties: { fit: "contain" } };
  }
  if (layer.type === "video" && asset) {
    return { ...base, type: "video", source: { assetId: asset.id }, properties: { loop: false, muted: false } };
  }
  return {
    ...base,
    type: "text",
    properties: {
      text: storyboard.requirements[0] ?? layer.description,
      fontFamily: "sans-serif",
      fontSize: 64
    }
  };
}

function toDsl(storyboard: Storyboard, resources: readonly LocalResourceInput[], result: UnderstandingResult): MotionProject {
  const assets = resources.map((resource) => resource.asset);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const layers = storyboard.shots[0]!.layers.map((layer) =>
    toLayer(layer, layer.localAssetId === undefined ? undefined : assetById.get(layer.localAssetId), storyboard)
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
    fonts: [],
    audioTracks,
    renderPresets: [],
    metadata: {
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
        if (!validate(instance.params)) {
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

function previewSource(): PixelSurface {
  const width = 160;
  const height = 90;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset] = Math.round(255 * x / (width - 1));
      data[offset + 1] = Math.round(255 * y / (height - 1));
      data[offset + 2] = 96;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data, colorSpace: "srgb", alphaMode: "straight" };
}

function lowResolutionPreview(storyboard: Storyboard, effects: readonly P0EffectDefinition[]): LowResolutionPreview {
  const frameTimes = [...new Set(storyboard.shots.flatMap((shot) => [
    shot.range.start,
    (shot.range.start + shot.range.end) / 2
  ]))].slice(0, 8);
  const source = previewSource();
  const frameHashes = frameTimes.map((time, index) => {
    const effect = effects[index % effects.length]!;
    const progress = storyboard.duration === 0 ? 0 : time / storyboard.duration;
    const output = effect.renderPixels(source, effect.defaultPreset, { progress, seed: 7, quality: "draft" });
    return `sha256:${createHash("sha256").update(output.data).digest("hex")}`;
  });
  return { width: 160, height: 90, frameTimes, frameHashes, quality: "draft" };
}

export function planAnimation(result: UnderstandingResult, options: PlanningOptions = {}): PlannedAnimation {
  const resources = options.resources ?? [];
  const effects = retrieveP0Effects(result.understanding);
  const storyboard = makeStoryboard(result.understanding, effects, resources, options);
  const dsl = toDsl(storyboard, resources, result);
  const issues = validatePlannedDsl(dsl, options.maxHeavyEffects);
  if (issues.some((issue) => issue.severity === "error")) {
    throw new Error(`AI planning static validation failed: ${issues.map((issue) => issue.code).join(", ")}`);
  }
  return {
    understanding: result.understanding,
    storyboard,
    dsl,
    issues,
    preview: lowResolutionPreview(storyboard, effects),
    trace: result.trace
  };
}
