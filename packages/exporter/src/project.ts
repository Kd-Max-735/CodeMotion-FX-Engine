import type {
  Animatable,
  AnimatableEvaluationTimes,
  AnimatableTimeScope,
  CompositionDefinition,
  EffectInstance,
  EffectTimeSample,
  JsonValue,
  LayerDefinition,
  LayerTimeSample,
  MotionProject,
  ProjectTimeSample,
  RenderQuality,
  Vector2,
  Vector3
} from "@codemotion/core";
import {
  P0_EFFECTS_BY_ID,
  type PixelSurface
} from "@codemotion/effects-2d";
import type {
  TextExtrude3DEffectDefinition,
  TextExtrude3DRasterInput
} from "@codemotion/effects-3d";
import {
  assertDualInputTextures,
  assertLayerRasterizationInput,
  type CoverageBuffer,
  type DualInputTextures,
  type LayerRasterSource,
  type LayerRasterizationInput,
  type RasterMaskInput,
  type RasterTransform,
  type TextRasterSource
} from "@codemotion/renderer-api";
import {
  compositePixelSurfaces,
  convertPixelSurface
} from "@codemotion/renderer-webgl";
import {
  evaluateAnimatableAt,
  migrateLegacyAbsoluteEffectTiming,
  resolveEffectTimeSample,
  resolveLayerTimeSample,
  resolveNestedTime,
  resolveProjectTimeSample
} from "@codemotion/timeline";
import type { FrameProducer, FrameRequest } from "./export.js";
import { decodeMediaFrame, type ImportedMedia } from "./media.js";
import {
  assertExportBackendConformance,
  effectMaskSurface,
  mixProjectSurfaces,
  rasterizeProjectLayer,
  transformProjectSurface,
  type RasterizedProjectLayer
} from "./raster.js";

export interface ProjectMediaReferences {
  readonly visualAssetIds: readonly string[];
  readonly audioAssetIds: readonly string[];
}

export interface ProjectRasterSourceContext {
  readonly project: MotionProject;
  readonly composition: CompositionDefinition;
  readonly layer: LayerDefinition;
  readonly request: FrameRequest;
  readonly projectTime: ProjectTimeSample;
  readonly layerTime: LayerTimeSample;
}

export interface ProjectCoverageContext extends ProjectRasterSourceContext {
  readonly effect?: EffectInstance;
  readonly assetId?: string;
}

export interface CreateProjectFrameProducerOptions {
  readonly ffmpegPath?: string;
  readonly timeContractVersion?: "0.0.0" | "1.1.0";
  readonly rasterSources?: ReadonlyMap<string, LayerRasterSource>;
  readonly resolveRasterSource?: (
    context: ProjectRasterSourceContext
  ) => Promise<LayerRasterSource> | LayerRasterSource;
  readonly coverageAssets?: ReadonlyMap<string, CoverageBuffer>;
  readonly resolveCoverageAsset?: (
    context: ProjectCoverageContext
  ) => Promise<CoverageBuffer | undefined> | CoverageBuffer | undefined;
  readonly secondaryLayerIds?: ReadonlyMap<string, string>;
  readonly rejectBackgroundOnlyFrames?: boolean;
}

interface PixelEffect {
  readonly sourceId?: string;
  readonly implementationOwner?: string;
  readonly renderQuality?: RenderQuality;
  readonly defaultPreset?: Readonly<Record<string, unknown>>;
  renderPixels(
    source: PixelSurface,
    params?: Readonly<Record<string, unknown>>,
    options?: Readonly<Record<string, unknown>>
  ): PixelSurface;
}

type ExportablePixelEffect = PixelEffect | TextExtrude3DEffectDefinition;

interface RenderableLayer {
  readonly layer: LayerDefinition;
  readonly time: LayerTimeSample;
  readonly input?: LayerRasterizationInput;
  readonly raster?: RasterizedProjectLayer;
  readonly surface: PixelSurface;
  readonly masks: readonly RasterMaskInput[];
  readonly transform: RasterTransform;
  readonly opacity: number;
  readonly foreground: boolean;
}

function isTextRasterizationInput(
  input: LayerRasterizationInput | undefined
): input is LayerRasterizationInput & {
  readonly layerType: "text";
  readonly source: TextRasterSource;
} {
  return input?.layerType === "text" && input.source.kind === "text";
}

function isTextExtrudeDefinition(
  definition: ExportablePixelEffect
): definition is TextExtrude3DEffectDefinition {
  return definition.sourceId === "T08";
}

function textExtrudeRasterInput(
  layer: LayerDefinition,
  rendered: RenderableLayer
): TextExtrude3DRasterInput {
  if (layer.type !== "text"
    || !isTextRasterizationInput(rendered.input)) {
    throw new TypeError("T08 requires a real text layer and TextRasterSource provenance.");
  }
  if (rendered.input.source.text !== layer.properties.text) {
    throw new TypeError("T08 text raster provenance must match the Unicode text layer content.");
  }
  return Object.freeze({
    rasterInput: rendered.input,
    surface: rendered.surface
  });
}

const VISUAL_MEDIA_TYPES = new Set(["image", "video"]);
const RASTER_LAYER_TYPES = new Set(["text", "shape", "svg", "image", "video"]);
const NON_VISUAL_LAYER_TYPES = new Set(["audio", "camera", "light", "null", "data", "adjustment"]);

function isAnimatable(value: unknown): value is Animatable {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const mode = (value as { mode?: unknown }).mode;
  return mode === "constant" || mode === "keyframes" || mode === "expression" || mode === "binding";
}

function evaluateValue(
  value: JsonValue | Animatable,
  scope: AnimatableTimeScope,
  times: AnimatableEvaluationTimes
): unknown {
  return isAnimatable(value) ? evaluateAnimatableAt(value, scope, times) : value;
}

function numberAt(
  value: Animatable<number>,
  scope: AnimatableTimeScope,
  times: AnimatableEvaluationTimes
): number {
  const result = evaluateAnimatableAt(value, scope, times);
  if (!Number.isFinite(result)) throw new RangeError(`${scope}-scoped numeric value must be finite.`);
  return result;
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

function mediaColorSpace(imported: ImportedMedia): MotionProject["colorSpace"] {
  const value = imported.asset.metadata.colorSpace;
  return value === "display-p3" || value === "linear-srgb" ? value : "srgb";
}

function multiplyMatrices(left: RasterTransform["matrix"], right: RasterTransform["matrix"]): RasterTransform["matrix"] {
  const output = new Array<number>(9).fill(0);
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      output[row * 3 + column] = left[row * 3]! * right[column]!
        + left[row * 3 + 1]! * right[column + 3]!
        + left[row * 3 + 2]! * right[column + 6]!;
    }
  }
  return output as unknown as RasterTransform["matrix"];
}

function transformAt(
  layer: LayerDefinition,
  times: AnimatableEvaluationTimes,
  rasterScale: readonly [number, number],
  parent?: RasterTransform
): RasterTransform {
  const anchor = evaluateAnimatableAt<Vector3>(layer.transform.anchorPoint, "layer", times);
  const position = evaluateAnimatableAt<Vector3>(layer.transform.position, "layer", times);
  const scale = evaluateAnimatableAt<Vector3>(layer.transform.scale, "layer", times);
  const rotation = evaluateAnimatableAt<Vector3>(layer.transform.rotation, "layer", times);
  const skew = layer.transform.skew === undefined
    ? { x: 0, y: 0 }
    : evaluateAnimatableAt<Vector2>(layer.transform.skew, "layer", times);
  const values = [anchor.x, anchor.y, position.x, position.y, scale.x, scale.y, rotation.z, skew.x, skew.y];
  if (!values.every(Number.isFinite)) throw new RangeError(`Layer ${layer.id} transform contains a non-finite value.`);
  const radians = rotation.z * Math.PI / 180;
  const skewX = Math.tan(skew.x * Math.PI / 180);
  const skewY = Math.tan(skew.y * Math.PI / 180);
  const sx = scale.x / 100;
  const sy = scale.y / 100;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const rawA = cosine * sx - sine * skewY * sx;
  const rawB = cosine * skewX * sy - sine * sy;
  const rawC = sine * sx + cosine * skewY * sx;
  const rawD = sine * skewX * sy + cosine * sy;
  const local = [
    rawA,
    rawB * rasterScale[0] / rasterScale[1],
    (position.x - rawA * anchor.x - rawB * anchor.y) * rasterScale[0],
    rawC * rasterScale[1] / rasterScale[0],
    rawD,
    (position.y - rawC * anchor.x - rawD * anchor.y) * rasterScale[1],
    0, 0, 1
  ] as const;
  return Object.freeze({
    matrix: Object.freeze(parent === undefined ? local : multiplyMatrices(parent.matrix, local)),
    anchor: Object.freeze([anchor.x * rasterScale[0], anchor.y * rasterScale[1]] as const)
  });
}

function coverageBuffer(value: unknown, name: string): CoverageBuffer {
  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${name} requires real coverage data.`);
  }
  const candidate = value as { width?: unknown; height?: unknown; data?: unknown; rowOrder?: unknown };
  if (!Number.isInteger(candidate.width) || !Number.isInteger(candidate.height)
    || typeof candidate.width !== "number" || typeof candidate.height !== "number"
    || candidate.width < 1 || candidate.height < 1
    || (!Array.isArray(candidate.data) && !(candidate.data instanceof Uint8Array)
      && !(candidate.data instanceof Uint8ClampedArray))) {
    throw new TypeError(`${name} requires a valid CoverageBuffer.`);
  }
  const data = new Uint8Array(candidate.data as ArrayLike<number>);
  if (data.length !== candidate.width * candidate.height || candidate.rowOrder !== "top-to-bottom") {
    throw new RangeError(`${name} coverage dimensions or row order are invalid.`);
  }
  return Object.freeze({
    width: candidate.width,
    height: candidate.height,
    data,
    rowOrder: "top-to-bottom"
  });
}

function layerMasks(
  layer: LayerDefinition,
  times: AnimatableEvaluationTimes,
  transform: RasterTransform
): readonly RasterMaskInput[] {
  return Object.freeze(layer.masks.filter((mask) => mask.enabled).map((mask) => Object.freeze({
    id: mask.id,
    mode: mask.mode,
    inverted: mask.inverted,
    opacity: Math.min(1, Math.max(0, numberAt(mask.opacity, "layer", times))),
    coverage: coverageBuffer(evaluateValue(mask.path, "layer", times), `Mask ${mask.id}`),
    transform
  })));
}

function target(request: FrameRequest, colorSpace: MotionProject["colorSpace"]) {
  return Object.freeze({
    width: request.width,
    height: request.height,
    format: "rgba8" as const,
    colorSpace,
    samples: 1,
    usage: "input" as const
  });
}

function timingVersion(project: MotionProject, options: CreateProjectFrameProducerOptions): "0.0.0" | "1.1.0" {
  const value = options.timeContractVersion ?? project.metadata.timeContractVersion ?? "0.0.0";
  if (value !== "0.0.0" && value !== "1.1.0") {
    throw new TypeError(`Unsupported project time contract version ${String(value)}.`);
  }
  return value;
}

export function migrateProjectEffectTiming(
  effect: EffectInstance,
  layer: LayerDefinition,
  version: "0.0.0" | "1.1.0"
): EffectInstance {
  if (version === "1.1.0") return effect;
  const timing = migrateLegacyAbsoluteEffectTiming({
    contractVersion: "0.0.0",
    ...(effect.startTime === undefined ? {} : { startTime: effect.startTime }),
    ...(effect.endTime === undefined ? {} : { endTime: effect.endTime })
  }, layer.startTime);
  const { startTime: _startTime, endTime: _endTime, ...stable } = effect;
  return {
    ...stable,
    ...(timing.startTime === undefined ? {} : { startTime: timing.startTime }),
    ...(timing.endTime === undefined ? {} : { endTime: timing.endTime })
  };
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
  if (project.background.type === "asset") visual.add(project.background.assetId);
  return {
    visualAssetIds: [...visual],
    audioAssetIds: [...new Set(project.audioTracks.map((track) => track.assetId))]
  };
}

function frameChangedFromBackground(frame: PixelSurface, background: PixelSurface): boolean {
  if (frame.data.length !== background.data.length) return true;
  for (let index = 0; index < frame.data.length; index += 1) {
    if (frame.data[index] !== background.data[index]) return true;
  }
  return false;
}

function referencedSecondaryId(
  effect: EffectInstance,
  params: Readonly<Record<string, unknown>>,
  options: CreateProjectFrameProducerOptions,
  candidates: readonly LayerDefinition[]
): string | undefined {
  const configured = options.secondaryLayerIds?.get(effect.id);
  if (configured !== undefined) return configured;
  const ids = new Set(candidates.map((candidate) => candidate.id));
  return Object.values(params).find((value): value is string => typeof value === "string" && ids.has(value));
}

export function createProjectFrameProducer(
  project: MotionProject,
  media: ReadonlyMap<string, ImportedMedia>,
  ffmpegPathOrOptions?: string | CreateProjectFrameProducerOptions
): FrameProducer {
  const options: CreateProjectFrameProducerOptions = typeof ffmpegPathOrOptions === "string"
    ? { ffmpegPath: ffmpegPathOrOptions }
    : ffmpegPathOrOptions ?? {};
  const main = project.compositions[0];
  if (main === undefined) throw new Error("Project has no main composition.");
  const version = timingVersion(project, options);
  assertExportBackendConformance();

  const decodeBackground = async (
    request: FrameRequest,
    signal: AbortSignal | undefined
  ): Promise<PixelSurface> => {
    if (project.background.type !== "asset") {
      return solidSurface(
        request.width,
        request.height,
        project.background.type === "color" ? parseColor(project.background.color) : [0, 0, 0, 0],
        project.colorSpace
      );
    }
    const imported = media.get(project.background.assetId);
    if (imported === undefined) throw new Error("Project background references unverified media.");
    const decoded = await decodeMediaFrame(imported, request, {
      ...(options.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath }),
      ...(signal === undefined ? {} : { signal })
    });
    return convertPixelSurface({
      width: request.width,
      height: request.height,
      data: new Uint8ClampedArray(decoded),
      colorSpace: mediaColorSpace(imported),
      alphaMode: "straight"
    }, project.colorSpace, "straight");
  };

  const renderComposition = async (
    composition: CompositionDefinition,
    request: FrameRequest,
    compositionTime: number,
    previousCompositionTime: number,
    signal: AbortSignal | undefined,
    activeCompositions: ReadonlySet<string>
  ): Promise<{ readonly surface: PixelSurface; readonly foreground: boolean }> => {
    if (activeCompositions.has(composition.id)) throw new Error("Composition reference cycle cannot be rendered.");
    const nextActive = new Set(activeCompositions).add(composition.id);
    const projectTime = resolveProjectTimeSample({
      projectTime: compositionTime,
      previousProjectTime: Math.min(compositionTime, previousCompositionTime),
      fps: request.fps
    });
    const background = composition.id === main.id
      ? await decodeBackground(request, signal)
      : solidSurface(request.width, request.height, [0, 0, 0, 0], project.colorSpace);
    let output = background;
    let foreground = false;
    const hasSolo = composition.layers.some((layer) => layer.visible && layer.solo);
    const activeLayers = composition.layers
      .map((layer) => ({ layer, time: resolveLayerTimeSample(layer, projectTime) }))
      .filter(({ layer, time }) => layer.visible && (!hasSolo || layer.solo) && time.active)
      .sort((left, right) => left.layer.zIndex - right.layer.zIndex);
    const layerById = new Map(composition.layers.map((layer) => [layer.id, layer]));
    const materialized = new Map<string, Promise<RenderableLayer>>();
    const spatial = new Map<string, { readonly transform: RasterTransform; readonly opacity: number }>();

    const spatialFor = (
      layer: LayerDefinition,
      path: ReadonlySet<string> = new Set()
    ): { readonly transform: RasterTransform; readonly opacity: number } => {
      const cached = spatial.get(layer.id);
      if (cached !== undefined) return cached;
      if (path.has(layer.id)) throw new Error(`Layer parent cycle includes ${layer.id}.`);
      const layerTime = resolveLayerTimeSample(layer, projectTime);
      const times: AnimatableEvaluationTimes = { project: projectTime, layer: layerTime };
      const parent = layer.parentId === undefined ? undefined : layerById.get(layer.parentId);
      const parentSpatial: { readonly transform: RasterTransform; readonly opacity: number } | undefined =
        parent === undefined ? undefined : spatialFor(parent, new Set(path).add(layer.id));
      const resolved: { readonly transform: RasterTransform; readonly opacity: number } = Object.freeze({
        transform: transformAt(layer, times, [
          request.width / composition.width,
          request.height / composition.height
        ], parentSpatial?.transform),
        opacity: Math.min(1, Math.max(0, numberAt(layer.opacity, "layer", times)))
          * (parentSpatial?.opacity ?? 1)
      });
      spatial.set(layer.id, resolved);
      return resolved;
    };

    const materialize = (layer: LayerDefinition, layerTime: LayerTimeSample): Promise<RenderableLayer> => {
      const cached = materialized.get(layer.id);
      if (cached !== undefined) return cached;
      const pending = (async (): Promise<RenderableLayer> => {
        signal?.throwIfAborted();
        const times: AnimatableEvaluationTimes = { project: projectTime, layer: layerTime };
        const { transform, opacity } = spatialFor(layer);
        const masks = layerMasks(layer, times, transform);

        if (layer.type === "composition") {
          if (layer.effects.length > 0) {
            throw new Error(`Composition layer ${layer.id} cannot expose G1 raster provenance for effects.`);
          }
          const nested = project.compositions.find((entry) => entry.id === layer.properties.compositionId);
          if (nested === undefined) throw new Error(`Layer ${layer.id} references a missing composition.`);
          const currentNested = resolveNestedTime(layer, compositionTime, nested.duration);
          const previousNested = resolveNestedTime(layer, previousCompositionTime, nested.duration);
          if (!currentNested.nestedActive) {
            return {
              layer, time: layerTime, surface: solidSurface(request.width, request.height, [0, 0, 0, 0], project.colorSpace),
              masks, transform, opacity, foreground: false
            };
          }
          const nestedOutput = await renderComposition(
            nested,
            request,
            currentNested.nestedTime,
            previousNested.nestedTime,
            signal,
            nextActive
          );
          return {
            layer,
            time: layerTime,
            surface: transformProjectSurface(nestedOutput.surface, transform, opacity, masks),
            masks,
            transform,
            opacity,
            foreground: nestedOutput.foreground
          };
        }
        if (NON_VISUAL_LAYER_TYPES.has(layer.type)) {
          return {
            layer, time: layerTime, surface: solidSurface(request.width, request.height, [0, 0, 0, 0], project.colorSpace),
            masks, transform, opacity, foreground: false
          };
        }
        if (!RASTER_LAYER_TYPES.has(layer.type)) {
          throw new Error(`Layer ${layer.id} type ${layer.type} has no G1 raster source contract.`);
        }

        const context: ProjectRasterSourceContext = {
          project, composition, layer, request, projectTime, layerTime
        };
        const suppliedSource = await options.resolveRasterSource?.(context)
          ?? options.rasterSources?.get(layer.id)
          ?? (layer.properties.rasterSource as unknown as LayerRasterSource | undefined);
        let source: LayerRasterSource;
        if (suppliedSource !== undefined) {
          source = suppliedSource;
        } else if (layer.source !== undefined && VISUAL_MEDIA_TYPES.has(layer.type)) {
          const imported = media.get(layer.source.assetId);
          if (imported === undefined) throw new Error(`Layer ${layer.id} references unverified media.`);
          const decoded = await decodeMediaFrame(imported, { ...request, time: layerTime.sourceTime }, {
            ...(options.ffmpegPath === undefined ? {} : { ffmpegPath: options.ffmpegPath }),
            ...(signal === undefined ? {} : { signal })
          });
          const hash = imported.asset.hash;
          if (hash === undefined) throw new Error(`Layer ${layer.id} media has no verified content hash.`);
          source = {
            kind: layer.type as "image" | "video",
            assetId: imported.asset.id,
            assetHash: hash,
            frameTime: layerTime.sourceTime,
            pixels: {
              width: request.width,
              height: request.height,
              data: decoded,
              colorSpace: mediaColorSpace(imported),
              alphaMode: "straight",
              rowOrder: "top-to-bottom"
            }
          };
        } else throw new Error(`Layer ${layer.id} requires an explicit real G1 raster source.`);
        const input: LayerRasterizationInput = {
          layerId: layer.id,
          layerType: layer.type as LayerRasterizationInput["layerType"],
          source,
          time: layerTime,
          transform,
          opacity,
          masks,
          target: target(request, project.colorSpace)
        };
        assertLayerRasterizationInput(input);
        const raster = rasterizeProjectLayer(input);
        return {
          layer, time: layerTime, input, raster, surface: raster.surface, masks, transform, opacity,
          foreground: raster.output.coveredPixelCount > 0
        };
      })();
      materialized.set(layer.id, pending);
      return pending;
    };

    for (const active of activeLayers) {
      signal?.throwIfAborted();
      if (NON_VISUAL_LAYER_TYPES.has(active.layer.type)) continue;
      const rendered = await materialize(active.layer, active.time);
      let surface = rendered.surface;
      if (rendered.foreground) foreground = true;

      for (const originalEffect of active.layer.effects) {
        const effect = migrateProjectEffectTiming(originalEffect, active.layer, version);
        const effectTime: EffectTimeSample = resolveEffectTimeSample(
          effect,
          active.time,
          projectTime,
          active.layer.endTime - active.layer.startTime
        );
        if (!effectTime.active) continue;
        if (rendered.input === undefined || rendered.raster === undefined) {
          throw new Error(`Effect ${effect.effectId} requires a real layer raster input.`);
        }
        const definition = P0_EFFECTS_BY_ID.get(effect.effectId) as ExportablePixelEffect | undefined;
        if (definition === undefined) throw new Error(`Effect ${effect.effectId} has no P0 renderer.`);
        const times: AnimatableEvaluationTimes = { project: projectTime, layer: active.time, effect: effectTime };
        const params = Object.fromEntries(
          Object.entries(effect.params).map(([name, value]) => [name, evaluateValue(value, "effect", times)])
        );
        const effectOptions: Record<string, unknown> = {
          time: effectTime,
          seed: project.seed,
          quality: effect.renderQuality ?? "final",
          rasterInput: rendered.input
        };

        if (definition.sourceId === "D02") {
          const assetId = typeof params.brushTexture === "string" ? params.brushTexture
            : typeof definition.defaultPreset?.brushTexture === "string"
              ? definition.defaultPreset.brushTexture : undefined;
          const coverage = assetId === undefined ? undefined
            : options.coverageAssets?.get(assetId)
              ?? await options.resolveCoverageAsset?.({
                project, composition, layer: active.layer, request, projectTime, layerTime: active.time,
                effect, assetId
              });
          if (coverage === undefined || assetId === undefined) {
            throw new Error(`Effect ${effect.id} requires a real brush coverage asset.`);
          }
          effectOptions.brushCoverage = coverage;
          effectOptions.brushAssetId = assetId;
        }

        if (definition.sourceId !== "T08"
          && (definition.sourceId?.startsWith("C") || definition.sourceId?.startsWith("H"))) {
          const candidates = activeLayers.map(({ layer }) => layer).filter((layer) =>
            layer.id !== active.layer.id && !NON_VISUAL_LAYER_TYPES.has(layer.type));
          const secondaryId = referencedSecondaryId(effect, params, options, candidates)
            ?? candidates.at(-1)?.id;
          const secondaryLayer = secondaryId === undefined ? undefined : layerById.get(secondaryId);
          const secondaryTime = secondaryLayer === undefined
            ? undefined : resolveLayerTimeSample(
              secondaryLayer.visible ? secondaryLayer : { ...secondaryLayer, visible: true },
              projectTime
            );
          if (secondaryLayer === undefined || secondaryTime === undefined || !secondaryTime.active) {
            throw new Error(
              `Effect ${effect.id} requires an independent active secondary raster layer; resolved ${secondaryId ?? "none"}.`
            );
          }
          const secondary = await materialize(secondaryLayer, secondaryTime);
          if (secondary.input === undefined || secondary.raster === undefined) {
            throw new Error(`Effect ${effect.id} secondary layer lacks real raster provenance.`);
          }
          const dualInputTextures: DualInputTextures = {
            source: rendered.raster.output,
            secondary: secondary.raster.output
          };
          assertDualInputTextures(dualInputTextures);
          effectOptions.secondary = secondary.surface;
          effectOptions.secondaryRasterInput = secondary.input;
          effectOptions.dualInputTextures = dualInputTextures;
        }

        if (effect.maskId !== undefined) {
          const mask = rendered.masks.find((entry) => entry.id === effect.maskId);
          if (mask === undefined) throw new Error(`Effect ${effect.id} references missing mask ${effect.maskId}.`);
          effectOptions.mask = effectMaskSurface(mask, request.width, request.height, project.colorSpace);
        }
        const effected = isTextExtrudeDefinition(definition)
          ? definition.renderPixels(
            textExtrudeRasterInput(active.layer, rendered),
            params,
            {
              time: effectTime,
              seed: project.seed,
              quality: effect.renderQuality ?? "final",
              ...(effectOptions.mask === undefined
                ? {}
                : { mask: effectOptions.mask as PixelSurface })
            }
          )
          : (definition as PixelEffect).renderPixels(surface, params, effectOptions);
        surface = mixProjectSurfaces(surface, effected, numberAt(effect.mix, "effect", times));
      }
      output = compositePixelSurfaces(
        output,
        surface,
        active.layer.blendMode,
        1,
        project.colorSpace,
        "straight"
      );
    }
    return { surface: output, foreground: foreground && frameChangedFromBackground(output, background) };
  };

  return async (request, signal) => {
    const previousTime = Math.max(0, request.time - request.deltaTime);
    const rendered = await renderComposition(main, request, request.time, previousTime, signal, new Set());
    if (options.rejectBackgroundOnlyFrames === true && !rendered.foreground) {
      throw new Error(`Frame ${request.frame} contains only the project background.`);
    }
    return new Uint8Array(rendered.surface.data);
  };
}
