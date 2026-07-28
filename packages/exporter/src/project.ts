import type {
  Animatable,
  CompositionDefinition,
  EffectInstance,
  JsonValue,
  LayerDefinition,
  MotionProject
} from "@codemotion/core";
import { P0_EFFECTS_BY_ID } from "@codemotion/effects-2d";
import {
  compositePixelSurfaces,
  type PixelSurface
} from "@codemotion/renderer-webgl";
import {
  evaluateAnimatable,
  evaluateNumber,
  resolveLayerTime,
  resolveNestedTime
} from "@codemotion/timeline";
import type { FrameProducer, FrameRequest } from "./export.js";
import { decodeMediaFrame, type ImportedMedia } from "./media.js";

export interface ProjectMediaReferences {
  readonly visualAssetIds: readonly string[];
  readonly audioAssetIds: readonly string[];
}

interface PixelEffect {
  renderPixels(
    source: PixelSurface,
    params?: Readonly<Record<string, unknown>>,
    options?: {
      progress?: number;
      seed?: number;
      quality?: "draft" | "preview" | "final";
      secondary?: PixelSurface;
    }
  ): PixelSurface;
}

const VISUAL_MEDIA_TYPES = new Set(["image", "video"]);
const NON_VISUAL_LAYER_TYPES = new Set(["audio", "camera", "light", "null", "data", "adjustment"]);

function isAnimatable(value: unknown): value is Animatable {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const mode = (value as { mode?: unknown }).mode;
  return mode === "constant" || mode === "keyframes" || mode === "expression" || mode === "binding";
}

function evaluateValue(value: JsonValue | Animatable, time: number): unknown {
  return isAnimatable(value) ? evaluateAnimatable(value, time) : value;
}

function parseColor(value: unknown): readonly [number, number, number, number] {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)) return [0, 0, 0, 0];
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
    value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) : 255
  ];
}

function solidSurface(
  width: number,
  height: number,
  color: readonly [number, number, number, number],
  colorSpace: MotionProject["colorSpace"]
): PixelSurface {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = color[3];
  }
  return { width, height, data, colorSpace, alphaMode: "straight" };
}

function mediaSurface(bytes: Uint8Array, request: FrameRequest, colorSpace: MotionProject["colorSpace"]): PixelSurface {
  return {
    width: request.width,
    height: request.height,
    data: new Uint8ClampedArray(bytes),
    colorSpace,
    alphaMode: "straight"
  };
}

function mixSurfaces(source: PixelSurface, effected: PixelSurface, mix: number): PixelSurface {
  const amount = Math.min(1, Math.max(0, mix));
  if (amount === 0) return source;
  if (amount === 1) return effected;
  const data = new Uint8ClampedArray(source.data.length);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.round(source.data[index]! + (effected.data[index]! - source.data[index]!) * amount);
  }
  return { ...source, data };
}

function effectProgress(effect: EffectInstance, layer: LayerDefinition, time: number): number {
  const start = effect.startTime ?? layer.startTime;
  const end = effect.endTime ?? layer.endTime;
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (time - start) / (end - start)));
}

function collectCompositionReferences(
  project: MotionProject,
  composition: CompositionDefinition,
  visual: Set<string>,
  visited: Set<string>
): void {
  if (visited.has(composition.id)) return;
  visited.add(composition.id);
  for (const layer of composition.layers) {
    if (layer.source !== undefined && VISUAL_MEDIA_TYPES.has(layer.type)) visual.add(layer.source.assetId);
    if (layer.type === "composition") {
      const nested = project.compositions.find((entry) => entry.id === layer.properties.compositionId);
      if (nested !== undefined) collectCompositionReferences(project, nested, visual, visited);
    }
  }
}

export function projectMediaReferences(project: MotionProject): ProjectMediaReferences {
  const visual = new Set<string>();
  const main = project.compositions[0];
  if (main !== undefined) collectCompositionReferences(project, main, visual, new Set());
  return {
    visualAssetIds: [...visual],
    audioAssetIds: [...new Set(project.audioTracks.map((track) => track.assetId))]
  };
}

export function createProjectFrameProducer(
  project: MotionProject,
  media: ReadonlyMap<string, ImportedMedia>,
  ffmpegPath?: string
): FrameProducer {
  const main = project.compositions[0];
  if (main === undefined) throw new Error("Project has no main composition.");

  const renderComposition = async (
    composition: CompositionDefinition,
    request: FrameRequest,
    time: number,
    signal: AbortSignal | undefined,
    activeCompositions: ReadonlySet<string>
  ): Promise<PixelSurface> => {
    if (activeCompositions.has(composition.id)) throw new Error("Composition reference cycle cannot be rendered.");
    const nextActive = new Set(activeCompositions).add(composition.id);
    let output = solidSurface(
      request.width,
      request.height,
      composition.id === main.id && project.background.type === "color"
        ? parseColor(project.background.color)
        : [0, 0, 0, 0],
      project.colorSpace
    );
    const hasSolo = composition.layers.some((layer) => layer.visible && layer.solo);
    const layers = composition.layers
      .filter((layer) => layer.visible && (!hasSolo || layer.solo) && resolveLayerTime(layer, time).active)
      .sort((left, right) => left.zIndex - right.zIndex);

    for (const layer of layers) {
      signal?.throwIfAborted();
      if (NON_VISUAL_LAYER_TYPES.has(layer.type)) continue;
      if (layer.masks.some((mask) => mask.enabled && mask.mode !== "none")) {
        throw new Error(`Layer ${layer.id} uses a mask that has no deterministic Stage 6 raster source.`);
      }
      const layerTime = resolveLayerTime(layer, time);
      let surface: PixelSurface;
      if (layer.type === "composition") {
        const nested = project.compositions.find((entry) => entry.id === layer.properties.compositionId);
        if (nested === undefined) throw new Error(`Layer ${layer.id} references a missing composition.`);
        const nestedTime = resolveNestedTime(layer, time, nested.duration);
        if (!nestedTime.nestedActive) continue;
        surface = await renderComposition(nested, request, nestedTime.nestedTime, signal, nextActive);
      } else if (layer.source !== undefined && VISUAL_MEDIA_TYPES.has(layer.type)) {
        const imported = media.get(layer.source.assetId);
        if (imported === undefined) throw new Error(`Layer ${layer.id} references unverified media.`);
        surface = mediaSurface(await decodeMediaFrame(imported, { ...request, time: layerTime.sourceTime }, {
          ...(ffmpegPath === undefined ? {} : { ffmpegPath }),
          ...(signal === undefined ? {} : { signal })
        }), request, project.colorSpace);
      } else {
        surface = solidSurface(
          request.width,
          request.height,
          parseColor(layer.properties.color ?? layer.properties.fill),
          project.colorSpace
        );
      }

      for (const effect of layer.effects) {
        if (!effect.enabled || (effect.startTime !== undefined && time < effect.startTime)
          || (effect.endTime !== undefined && time >= effect.endTime)) continue;
        const definition = P0_EFFECTS_BY_ID.get(effect.effectId) as PixelEffect | undefined;
        if (definition === undefined) throw new Error(`Effect ${effect.effectId} has no Stage 6 renderer.`);
        const params = Object.fromEntries(
          Object.entries(effect.params).map(([name, value]) => [name, evaluateValue(value, layerTime.sourceTime)])
        );
        const effected = definition.renderPixels(surface, params, {
          progress: effectProgress(effect, layer, time),
          seed: project.seed,
          quality: "final",
          secondary: output
        });
        surface = mixSurfaces(surface, effected, evaluateNumber(effect.mix, layerTime.sourceTime));
      }
      output = compositePixelSurfaces(
        output,
        surface,
        layer.blendMode,
        evaluateNumber(layer.opacity, layerTime.sourceTime),
        project.colorSpace,
        "straight"
      );
    }
    return output;
  };

  return async (request, signal) => {
    const surface = await renderComposition(main, request, request.time, signal, new Set());
    return new Uint8Array(surface.data);
  };
}
