import type { JsonValue } from "@codemotion/core";
import {
  type BrowserProjectConstraintsV1,
  type BrowserProjectEnvelopeV1,
  type BrowserProjectValidationOptionsV1,
  type TransportValidationResultV1,
  hasOnlyTransportKeysV1,
  inspectTransportJsonV1,
  isBrowserProjectConstraintsV1,
  isTransportRecordV1,
  transportValidationFailureV1,
  validateBrowserProjectEnvelopeV1Internal,
  validateP0EffectSnapshotV1
} from "./browser-project.js";

export const AI_PLAN_RESULT_CONTRACT = "ai-plan-result/v2" as const;

export type BrowserSafeStoryboardLayerV1 =
  | {
      readonly id: string;
      readonly description: string;
      readonly type: "text";
      readonly text: string;
    }
  | {
      readonly id: string;
      readonly description: string;
      readonly type: "svg";
    }
  | {
      readonly id: string;
      readonly description: string;
      readonly type: "image" | "video";
      readonly localAssetId: string;
    };

export interface BrowserSafeStoryboardEffectV1 {
  readonly sourceId: string;
  readonly effectId: string;
  readonly effectVersion: string;
  readonly targetLayerId: string;
  readonly params: Readonly<Record<string, JsonValue>>;
}

export interface BrowserSafeStoryboardShotV1 {
  readonly id: string;
  readonly range: { readonly start: number; readonly end: number };
  readonly description: string;
  readonly layers: readonly BrowserSafeStoryboardLayerV1[];
  readonly effects: readonly BrowserSafeStoryboardEffectV1[];
}

export type AiPlanIssueCodeV2 =
  | "SCHEMA_VALIDATION"
  | "TIME_CONTRACT"
  | "DURATION"
  | "REFERENCE"
  | "CYCLE"
  | "EFFECT"
  | "EFFECT_VERSION"
  | "PARAMETER"
  | "PERFORMANCE"
  | "SAFETY";

export interface AiPlanCompletedResultV2 {
  readonly contract: typeof AI_PLAN_RESULT_CONTRACT;
  readonly storyboard: {
    readonly intent: string;
    readonly duration: number;
    readonly width: number;
    readonly height: number;
    readonly fps: number;
    readonly style: readonly string[];
    readonly brand: BrowserProjectConstraintsV1["brand"];
    readonly requirements: readonly string[];
    readonly constraints: readonly string[];
    readonly shots: readonly BrowserSafeStoryboardShotV1[];
  };
  readonly editableProject: BrowserProjectEnvelopeV1;
  readonly issues: readonly {
    readonly code: AiPlanIssueCodeV2;
    readonly severity: "error" | "warning";
    readonly message: string;
  }[];
  readonly preview: {
    readonly width: 160;
    readonly height: 90;
    readonly quality: "draft";
    readonly frameCount: number;
    readonly timeContractVersion: "1.1.0";
  };
}

const ISSUE_CODES = new Set<AiPlanIssueCodeV2>([
  "SCHEMA_VALIDATION", "TIME_CONTRACT", "DURATION", "REFERENCE", "CYCLE",
  "EFFECT", "EFFECT_VERSION", "PARAMETER", "PERFORMANCE", "SAFETY"
]);

function exact(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[] = allowed
): value is Record<string, unknown> {
  return isTransportRecordV1(value) && hasOnlyTransportKeysV1(value, allowed, required);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 256 && value.every((entry) => typeof entry === "string");
}

function validLayer(value: unknown, assetIds: ReadonlySet<string>): value is BrowserSafeStoryboardLayerV1 {
  if (!isTransportRecordV1(value) || typeof value.type !== "string") return false;
  if (value.type === "text") {
    return hasOnlyTransportKeysV1(value, ["id", "description", "type", "text"])
      && nonBlank(value.id) && typeof value.description === "string" && typeof value.text === "string";
  }
  if (value.type === "svg") {
    return hasOnlyTransportKeysV1(value, ["id", "description", "type"])
      && nonBlank(value.id) && typeof value.description === "string";
  }
  if (value.type === "image" || value.type === "video") {
    return hasOnlyTransportKeysV1(value, ["id", "description", "type", "localAssetId"])
      && nonBlank(value.id) && typeof value.description === "string"
      && nonBlank(value.localAssetId) && assetIds.has(value.localAssetId);
  }
  return false;
}

function validEffect(
  value: unknown,
  layerIds: ReadonlySet<string>,
  options: BrowserProjectValidationOptionsV1
): value is BrowserSafeStoryboardEffectV1 {
  if (!exact(value, ["sourceId", "effectId", "effectVersion", "targetLayerId", "params"])
    || !nonBlank(value.sourceId) || !nonBlank(value.effectId)
    || !nonBlank(value.effectVersion) || !nonBlank(value.targetLayerId)
    || !layerIds.has(value.targetLayerId) || !isTransportRecordV1(value.params)) return false;
  const definition = options.effectsById.get(value.effectId);
  return definition?.sourceId === value.sourceId
    && validateP0EffectSnapshotV1(value.effectId, value.effectVersion, value.params, options);
}

function validShot(
  value: unknown,
  assetIds: ReadonlySet<string>,
  duration: number,
  options: BrowserProjectValidationOptionsV1
): value is BrowserSafeStoryboardShotV1 {
  if (!exact(value, ["id", "range", "description", "layers", "effects"])
    || !nonBlank(value.id) || typeof value.description !== "string"
    || !exact(value.range, ["start", "end"])
    || !finite(value.range.start) || !finite(value.range.end)
    || value.range.start < 0 || value.range.end < value.range.start || value.range.end > duration
    || !Array.isArray(value.layers) || !Array.isArray(value.effects)) return false;
  if (!value.layers.every((layer) => validLayer(layer, assetIds))) return false;
  const layerIds = new Set(value.layers.map((layer) => (layer as BrowserSafeStoryboardLayerV1).id));
  return layerIds.size === value.layers.length
    && value.effects.every((effect) => validEffect(effect, layerIds, options));
}

function validStoryboard(
  value: unknown,
  editableProject: BrowserProjectEnvelopeV1,
  options: BrowserProjectValidationOptionsV1
): boolean {
  if (!exact(value, [
    "intent", "duration", "width", "height", "fps", "style", "brand",
    "requirements", "constraints", "shots"
  ]) || typeof value.intent !== "string" || !finite(value.duration)
    || !finite(value.width) || !finite(value.height) || !finite(value.fps)
    || value.duration !== editableProject.project.duration
    || value.width !== editableProject.project.width || value.height !== editableProject.project.height
    || value.fps !== editableProject.project.fps
    || !stringArray(value.style) || !stringArray(value.requirements) || !stringArray(value.constraints)
    || !isBrowserProjectConstraintsV1({ style: value.style, brand: value.brand })
    || !Array.isArray(value.shots)) return false;
  const assetIds = new Set(editableProject.project.assets.map((asset) => asset.id));
  if (!value.shots.every((shot) => validShot(shot, assetIds, value.duration as number, options))) return false;
  const shotIds = value.shots.map((shot) => (shot as BrowserSafeStoryboardShotV1).id);
  return new Set(shotIds).size === shotIds.length;
}

export function validateAiPlanCompletedResultV2Internal(
  value: unknown,
  options: BrowserProjectValidationOptionsV1
): TransportValidationResultV1<AiPlanCompletedResultV2> {
  const inspection = inspectTransportJsonV1(value);
  if (inspection === "budget") return transportValidationFailureV1("PROJECT_TOO_LARGE");
  if (inspection === "unsafe" || !isTransportRecordV1(value)) {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  if (value.contract !== AI_PLAN_RESULT_CONTRACT) return transportValidationFailureV1("UNSUPPORTED_CONTRACT");
  if (!hasOnlyTransportKeysV1(value, ["contract", "storyboard", "editableProject", "issues", "preview"])) {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  const editable = validateBrowserProjectEnvelopeV1Internal(value.editableProject, options);
  if (!editable.valid || !validStoryboard(value.storyboard, editable.value, options)) {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  if (!Array.isArray(value.issues) || !value.issues.every((issue) => exact(issue, ["code", "severity", "message"])
    && typeof issue.code === "string" && ISSUE_CODES.has(issue.code as AiPlanIssueCodeV2)
    && (issue.severity === "error" || issue.severity === "warning") && typeof issue.message === "string")) {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  if (!exact(value.preview, ["width", "height", "quality", "frameCount", "timeContractVersion"])
    || value.preview.width !== 160 || value.preview.height !== 90 || value.preview.quality !== "draft"
    || !Number.isInteger(value.preview.frameCount) || (value.preview.frameCount as number) < 1
    || value.preview.timeContractVersion !== "1.1.0") {
    return transportValidationFailureV1("MALFORMED_REQUEST");
  }
  return { valid: true, value: value as unknown as AiPlanCompletedResultV2 };
}
