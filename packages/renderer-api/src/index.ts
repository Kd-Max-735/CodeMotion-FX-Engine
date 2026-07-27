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

export { RENDERER_API_VERSION };
