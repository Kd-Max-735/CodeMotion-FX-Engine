import {
  EngineError,
  ERROR_CODES,
  RENDERER_API_VERSION,
  type ColorSpace,
  type EffectDefinition,
  type JsonObject,
  type JsonValue,
  type LayerDefinition,
  type RenderBackend,
  type RenderQuality
} from "@codemotion/core";

export interface CancellationSignal {
  readonly aborted: boolean;
  throwIfAborted(): void;
}

export interface TextureDescriptor {
  width: number;
  height: number;
  format: "rgba8" | "rgba16f" | "rgba32f" | "alpha8";
  colorSpace: ColorSpace;
  samples: number;
  usage: "input" | "output" | "intermediate" | "mask";
}

export interface TextureHandle {
  readonly id: string;
  readonly backend: RenderBackend;
  readonly descriptor: TextureDescriptor;
}

export interface AudioAnalysisFrame {
  rms: number;
  peak: number;
  bands: readonly number[];
  metadata: JsonObject;
}

export interface RendererCapabilities {
  maxTextureSize: number;
  supportsAlpha: boolean;
  supportsFloatTextures: boolean;
  supportedColorSpaces: readonly ColorSpace[];
  supportedBlendModes: readonly string[];
}

export interface RendererCapabilityRequirements {
  readonly width: number;
  readonly height: number;
  readonly requiresAlpha?: boolean;
  readonly requiresFloatTextures?: boolean;
  readonly colorSpace: ColorSpace;
  readonly blendModes?: readonly string[];
}

export interface RendererCapabilityReport {
  readonly adapterId: string;
  readonly backend: RenderBackend;
  readonly supported: boolean;
  readonly missing: readonly string[];
}

export interface RendererSelectionOptions {
  readonly backendOrder: readonly RenderBackend[];
  readonly mode: "preview" | "final";
  readonly allowDegraded?: boolean;
  readonly approveFinalDegradation?: boolean;
}

export interface RendererSelection {
  readonly adapter: RendererAdapter;
  readonly report: RendererCapabilityReport;
  readonly degraded: boolean;
}

export interface RendererInitialization {
  width: number;
  height: number;
  colorSpace: ColorSpace;
  quality: RenderQuality;
  signal?: CancellationSignal;
}

export interface FrameContext {
  time: number;
  deltaTime: number;
  frame: number;
  fps: number;
  width: number;
  height: number;
  seed: number;
  quality: RenderQuality;
  colorSpace: ColorSpace;
  signal?: CancellationSignal;
}

export interface CompositeOptions {
  blendMode: string;
  opacity: number;
  target?: TextureHandle;
}

export type RenderOutput =
  | { type: "texture"; texture: TextureHandle }
  | { type: "vector"; data: JsonValue }
  | { type: "transform"; data: JsonObject }
  | { type: "particle-buffer"; data: JsonObject }
  | { type: "scene-node"; data: JsonObject }
  | { type: "audio-analysis"; data: AudioAnalysisFrame }
  | { type: "frame"; data: JsonObject }
  | { type: "metadata"; data: JsonObject };

export interface RendererAdapter {
  readonly id: string;
  readonly backend: RenderBackend;
  readonly apiVersion: string;
  readonly capabilities: RendererCapabilities;

  initialize(options: RendererInitialization): Promise<void> | void;
  createTexture(descriptor: TextureDescriptor): TextureHandle;
  releaseTexture(texture: TextureHandle): void;
  beginFrame(context: FrameContext): Promise<void> | void;
  renderLayer(layer: LayerDefinition, context: FrameContext): Promise<RenderOutput> | RenderOutput;
  composite(
    inputs: readonly TextureHandle[],
    options: CompositeOptions,
    context: FrameContext
  ): Promise<TextureHandle> | TextureHandle;
  endFrame(context: FrameContext): Promise<RenderOutput> | RenderOutput;
  dispose(): Promise<void> | void;
}

export interface EffectRenderContext extends FrameContext {
  inputTextures: readonly TextureHandle[];
  params: Readonly<Record<string, unknown>>;
  mask?: TextureHandle;
  audio?: AudioAnalysisFrame;
  data?: Readonly<Record<string, unknown>>;
  renderer: RendererAdapter;
}

export type EffectRenderFunction = (
  context: EffectRenderContext
) => Promise<RenderOutput> | RenderOutput;

export interface EffectMigrationHandler {
  readonly fromVersion: string;
  readonly toVersion: string;
  migrate(params: JsonObject): JsonObject;
}

export interface RegisteredEffectDefinition extends EffectDefinition {
  readonly render: EffectRenderFunction;
  readonly migrationHandlers: readonly EffectMigrationHandler[];
  dispose(): Promise<void> | void;
}

export function assertRendererCompatibility(adapter: RendererAdapter): void {
  if (adapter.apiVersion !== RENDERER_API_VERSION) {
    throw new EngineError(
      ERROR_CODES.RENDERER_INCOMPATIBLE,
      `Renderer ${adapter.id} implements API ${adapter.apiVersion}; expected ${RENDERER_API_VERSION}.`,
      {
        details: {
          rendererId: adapter.id,
          backend: adapter.backend,
          actualVersion: adapter.apiVersion,
          expectedVersion: RENDERER_API_VERSION
        }
      }
    );
  }
}

export function detectRendererCapabilities(
  adapter: RendererAdapter,
  requirements: RendererCapabilityRequirements
): RendererCapabilityReport {
  assertRendererCompatibility(adapter);
  if (!Number.isInteger(requirements.width) || requirements.width < 1
    || !Number.isInteger(requirements.height) || requirements.height < 1) {
    throw new RangeError("Renderer dimensions must be positive integers.");
  }
  const missing: string[] = [];
  if (requirements.width > adapter.capabilities.maxTextureSize
    || requirements.height > adapter.capabilities.maxTextureSize) missing.push("maxTextureSize");
  if (requirements.requiresAlpha === true && !adapter.capabilities.supportsAlpha) missing.push("alpha");
  if (requirements.requiresFloatTextures === true && !adapter.capabilities.supportsFloatTextures) missing.push("floatTextures");
  if (!adapter.capabilities.supportedColorSpaces.includes(requirements.colorSpace)) {
    missing.push(`colorSpace:${requirements.colorSpace}`);
  }
  for (const blendMode of requirements.blendModes ?? []) {
    if (!adapter.capabilities.supportedBlendModes.includes(blendMode)) missing.push(`blendMode:${blendMode}`);
  }
  return {
    adapterId: adapter.id,
    backend: adapter.backend,
    supported: missing.length === 0,
    missing: Object.freeze(missing)
  };
}

export function selectRendererAdapter(
  adapters: readonly RendererAdapter[],
  requirements: RendererCapabilityRequirements,
  options: RendererSelectionOptions
): RendererSelection {
  const backendRank = new Map(options.backendOrder.map((backend, index) => [backend, index]));
  const candidates = adapters.map((adapter, index) => {
    let compatible = true;
    let report: RendererCapabilityReport;
    try {
      report = detectRendererCapabilities(adapter, requirements);
    } catch (cause) {
      if (!(cause instanceof EngineError) || cause.code !== ERROR_CODES.RENDERER_INCOMPATIBLE) throw cause;
      compatible = false;
      report = {
        adapterId: adapter.id,
        backend: adapter.backend,
        supported: false,
        missing: Object.freeze([`apiVersion:${adapter.apiVersion}`])
      };
    }
    return { adapter, index, compatible, rank: backendRank.get(adapter.backend) ?? Number.MAX_SAFE_INTEGER, report };
  }).sort((left, right) => left.rank - right.rank || left.index - right.index);
  const supported = candidates.find((candidate) => candidate.report.supported);
  if (supported !== undefined) return { adapter: supported.adapter, report: supported.report, degraded: false };

  const degradationAllowed = options.allowDegraded === true
    && (options.mode === "preview" || options.approveFinalDegradation === true);
  if (degradationAllowed) {
    const fallback = candidates.filter((candidate) => candidate.compatible).sort((left, right) =>
      left.report.missing.length - right.report.missing.length || left.rank - right.rank || left.index - right.index
    )[0];
    if (fallback !== undefined) return { adapter: fallback.adapter, report: fallback.report, degraded: true };
  }
  throw new EngineError(
    ERROR_CODES.RENDERER_CAPABILITY_UNAVAILABLE,
    "No renderer satisfies the required capabilities.",
    {
      details: {
        mode: options.mode,
        candidates: candidates.map((candidate) => ({
          adapterId: candidate.adapter.id,
          backend: candidate.adapter.backend,
          missing: [...candidate.report.missing]
        }))
      }
    }
  );
}

export { RENDERER_API_VERSION };
