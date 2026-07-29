import type { AssetDefinition, JsonObject } from "@codemotion/core";

export const ARK_V1_MODEL = "doubao-seed-2-0-lite-260428" as const;

export type InputModality = "text" | "image" | "audio" | "video";

export interface LocalResourceInput {
  readonly modality: Exclude<InputModality, "text">;
  readonly localAssetId: string;
  readonly asset: AssetDefinition;
  readonly storageDirectory: string;
  readonly videoFps?: number;
}

export interface UnderstandingRequest {
  readonly prompt: string;
  readonly resources?: readonly LocalResourceInput[];
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: (event: ProviderProgress) => void;
}

export interface ProviderProgress {
  readonly phase: "validate" | "upload" | "process" | "infer" | "cleanup";
  readonly localAssetId?: string;
  readonly loaded?: number;
  readonly total?: number;
}

export interface TimeRange extends JsonObject {
  start: number;
  end: number;
}

export interface NormalizedUnderstanding extends JsonObject {
  text: {
    requirements: string[];
    constraints: string[];
  };
  images: Array<{
    localAssetId: string;
    subjects: string[];
    composition: string;
    ocr: string[];
    colors: string[];
    style: string[];
  }>;
  audio: Array<{
    localAssetId: string;
    transcript: string;
    speakers: string[];
    emotion: string[];
    bgm: string;
    rhythm: string;
    soundEffects: Array<{ at: number; description: string }>;
  }>;
  video: Array<{
    localAssetId: string;
    shots: Array<{
      range: TimeRange;
      action: string;
      event: string;
      onScreenText: string[];
      audioVisualRelation: string;
    }>;
  }>;
  confidence: number;
  risks: string[];
}

export interface ProviderTrace {
  readonly provider: string;
  readonly modelId: typeof ARK_V1_MODEL;
  readonly requestFingerprint: string;
  readonly inputHash: string;
  readonly latencyMs: number;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
    readonly estimatedCostCny: {
      readonly lowerBound: number;
      readonly upperBound: number;
      readonly pricingSource: string;
      readonly note: string;
    };
  };
}

export interface UnderstandingResult {
  readonly understanding: NormalizedUnderstanding;
  readonly trace: ProviderTrace;
}

export interface ModelProvider {
  readonly id: string;
  understand(request: UnderstandingRequest): Promise<UnderstandingResult>;
}

export type ProviderErrorCode =
  | "cancelled"
  | "timeout"
  | "rate_limited"
  | "invalid_input"
  | "authentication"
  | "unsupported"
  | "provider_unavailable"
  | "provider_response"
  | "security";

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(code: ProviderErrorCode, message: string, options: { retryable?: boolean; status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "ProviderError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

export interface ProviderAuditRecord {
  readonly endpoint: "files.create" | "files.retrieve" | "files.delete" | "responses.create";
  readonly modelId?: typeof ARK_V1_MODEL;
  readonly status: number;
  readonly latencyMs: number;
  readonly requestFingerprint?: string;
  readonly localAssetId?: string;
  readonly errorCode?: ProviderErrorCode;
}

export type ProviderAuditSink = (record: ProviderAuditRecord) => void;
