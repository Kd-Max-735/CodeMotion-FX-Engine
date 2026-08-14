import type {
  JsonObject,
  JsonSchema,
  RenderQuality
} from "@codemotion/core";

export type EffectPerformanceGrade = "light" | "medium" | "heavy" | "extreme";

export type EffectBackendKind =
  | "server-cpu"
  | "server-gpu"
  | "headless-webgl"
  | "server-three"
  | "ffmpeg";

export interface EffectBackendDefinition {
  readonly backendId: string;
  readonly kind: EffectBackendKind;
  readonly version: string;
  readonly deterministic: boolean;
}

export type EffectFallbackStrategy =
  | {
      readonly kind: "reject";
      readonly reason: string;
    }
  | {
      readonly kind: "server-backend";
      readonly backend: EffectBackendDefinition;
      readonly fidelity: "equivalent" | "degraded";
      readonly requiresFinalApproval: boolean;
    };

export type EffectInputKind =
  | "image"
  | "video"
  | "audio"
  | "mask"
  | "lut"
  | "depth-map"
  | "font"
  | "model"
  | "texture"
  | "data";

export interface EffectInputSlotDefinition {
  readonly name: string;
  readonly kind: EffectInputKind;
  readonly required: boolean;
  readonly cardinality: "one" | "many";
  readonly description: string;
  readonly acceptedMimeTypes?: readonly string[];
}

/**
 * A server-created, owner-scoped and locked binding. This value is never part
 * of the model request or EffectParameterEnvelope.
 */
export interface AuthorizedEffectInput<T = unknown> {
  readonly slot: string;
  readonly kind: EffectInputKind;
  readonly tenantId: string;
  readonly userId: string;
  readonly locked: true;
  readonly binding: T;
}

export type AuthorizedEffectInputValue =
  | AuthorizedEffectInput
  | readonly AuthorizedEffectInput[];

export type AuthorizedEffectInputs = Readonly<Record<string, AuthorizedEffectInputValue>>;

export interface EffectParameterEnvelope<Params extends JsonObject = JsonObject> {
  readonly type: string;
  readonly data: Params;
}

export interface EffectParameterIssue {
  readonly path: string;
  readonly message: string;
}

export type EffectParameterValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly issues: readonly EffectParameterIssue[] };

export interface EffectToolPreset<Params extends JsonObject = JsonObject> {
  readonly presetId: string;
  readonly displayName: string;
  readonly params: Params;
}

export interface ServerEffectRenderContext<
  Inputs extends AuthorizedEffectInputs = AuthorizedEffectInputs
> {
  readonly environment: "server";
  readonly requestId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly time: number;
  readonly deltaTime: number;
  readonly frame: number;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  readonly quality: RenderQuality;
  readonly backend: EffectBackendDefinition;
  readonly inputs: Inputs;
  readonly signal?: AbortSignal;
}

export interface EffectRenderResult<Output = unknown> {
  readonly kind: "frame" | "texture" | "video" | "audio" | "metadata";
  readonly backendId: string;
  readonly output: Output;
  readonly degraded: boolean;
  readonly warnings: readonly string[];
}

export interface EffectToolDefinition<
  Params extends JsonObject = JsonObject,
  Inputs extends AuthorizedEffectInputs = AuthorizedEffectInputs,
  Output = unknown
> {
  readonly effectId: string;
  readonly toolName: string;
  readonly displayName: string;
  readonly version: string;
  readonly category: string;
  readonly parameterSchema: JsonSchema;
  readonly defaults: Params;
  readonly presets: readonly EffectToolPreset<Params>[];
  readonly inputSlots: readonly EffectInputSlotDefinition[];
  readonly primaryBackend: EffectBackendDefinition;
  readonly fallbackStrategy: EffectFallbackStrategy;
  readonly performanceGrade: EffectPerformanceGrade;
  normalizeParams(params: Readonly<Params>): Params;
  validateParams(params: Readonly<Params>): EffectParameterValidationResult;
  render(
    context: ServerEffectRenderContext<Inputs>,
    params: Readonly<Params>
  ): Promise<EffectRenderResult<Output>> | EffectRenderResult<Output>;
}
