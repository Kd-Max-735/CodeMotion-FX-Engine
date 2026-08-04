import { isProxy } from "node:util/types";
import { P0_BROWSER_PROJECT_AUTHORITY_V1 } from "@codemotion/effects-2d";
import type {
  AiPlanCompletedResultV2,
  AiPlanIssueCodeV2,
  BrowserProjectConstraintsV1
} from "@codemotion/schema";
import type { PlannedAnimation } from "./pipeline.js";

const SERIALIZATION_ERROR = "AI plan result serialization failed.";
const POLLUTION_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const ISSUE_CODES: Readonly<Record<string, AiPlanIssueCodeV2>> = Object.freeze({
  schema: "SCHEMA_VALIDATION",
  "time-contract": "TIME_CONTRACT",
  duration: "DURATION",
  reference: "REFERENCE",
  cycle: "CYCLE",
  effect: "EFFECT",
  "effect-version": "EFFECT_VERSION",
  parameter: "PARAMETER",
  performance: "PERFORMANCE",
  safety: "SAFETY"
});

const ISSUE_MESSAGES: Readonly<Record<AiPlanIssueCodeV2, string>> = Object.freeze({
  SCHEMA_VALIDATION: "The planned project did not pass schema validation.",
  TIME_CONTRACT: "The planned project uses an unsupported time contract.",
  DURATION: "The planned project contains an invalid duration.",
  REFERENCE: "The planned project contains an invalid reference.",
  CYCLE: "The planned project contains a cycle.",
  EFFECT: "The planned project contains an unsupported effect.",
  EFFECT_VERSION: "The planned project contains an unsupported effect version.",
  PARAMETER: "The planned project contains an invalid effect parameter.",
  PERFORMANCE: "The planned project exceeds the effect performance budget.",
  SAFETY: "The planned project did not pass safety validation."
});

function failure(): never {
  throw new Error(SERIALIZATION_ERROR);
}

function dataRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value)) failure();
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) failure();
  return value as Record<string, unknown>;
}

function exactDataDescriptors(
  value: unknown,
  expectedKeys: readonly string[]
): Readonly<Record<string, PropertyDescriptor>> {
  const record = dataRecord(value);
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")
    || keys.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(descriptors, key))
    || keys.some((key) => typeof key === "string" && !expectedKeys.includes(key))) failure();
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) failure();
  }
  return descriptors;
}

function jsonSnapshot(value: unknown): unknown {
  const active = new WeakSet<object>();
  let nodes = 0;
  const visit = (entry: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > 100_000 || depth > 32) failure();
    if (entry === null || typeof entry === "boolean" || typeof entry === "string") return entry;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) failure();
      return entry;
    }
    if (typeof entry !== "object" || isProxy(entry)) failure();
    if (active.has(entry)) failure();
    active.add(entry);
    try {
      if (Array.isArray(entry)) {
        const descriptors = Object.getOwnPropertyDescriptors(entry);
        const descriptorKeys = Reflect.ownKeys(descriptors);
        if (descriptorKeys.some((key) => typeof key !== "string")) failure();
        const names = Object.keys(descriptors).filter((key) => key !== "length");
        if (names.length !== entry.length
          || names.some((key, index) => key !== String(index))) failure();
        return names.map((key) => {
          const descriptor = descriptors[key];
          if (descriptor === undefined || !("value" in descriptor)) failure();
          return visit(descriptor.value, depth + 1);
        });
      }
      const record = dataRecord(entry);
      const descriptors = Object.getOwnPropertyDescriptors(record);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== "string" || POLLUTION_KEYS.has(key))) failure();
      const copy = Object.create(null) as Record<string, unknown>;
      for (const key of keys as string[]) {
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) failure();
        Object.defineProperty(copy, key, {
          value: visit(descriptor.value, depth + 1),
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
      return copy;
    } finally {
      active.delete(entry);
    }
  };
  return visit(value, 0);
}

function issueProjection(value: unknown): AiPlanCompletedResultV2["issues"][number] {
  const issue = jsonSnapshot(value);
  const descriptors = exactDataDescriptors(issue, ["code", "severity", "message"]);
  const rawCode = descriptors.code!.value;
  const severity = descriptors.severity!.value;
  if (typeof rawCode !== "string" || (severity !== "error" && severity !== "warning")) failure();
  const code = ISSUE_CODES[rawCode];
  if (code === undefined) failure();
  return { code, severity, message: ISSUE_MESSAGES[code] };
}

/** Creates the only browser-safe projection of a completed server planning DTO. */
export function serializeAiPlanCompletedResultV2(
  planned: PlannedAnimation
): AiPlanCompletedResultV2 {
  try {
    const top = exactDataDescriptors(planned, [
      "understanding", "storyboard", "dsl", "issues", "preview", "trace"
    ]);
    const storyboard = jsonSnapshot(top.storyboard!.value) as AiPlanCompletedResultV2["storyboard"];
    const storyboardFields = exactDataDescriptors(storyboard, [
      "intent", "duration", "width", "height", "fps", "style", "brand",
      "requirements", "constraints", "shots"
    ]);
    const constraints: BrowserProjectConstraintsV1 = {
      style: jsonSnapshot(storyboardFields.style!.value) as readonly string[],
      brand: jsonSnapshot(storyboardFields.brand!.value) as BrowserProjectConstraintsV1["brand"]
    };
    const dsl = jsonSnapshot(top.dsl!.value) as PlannedAnimation["dsl"];
    const editable = P0_BROWSER_PROJECT_AUTHORITY_V1.sanitizeBrowserProject(dsl, constraints);
    if (!editable.valid) failure();

    const rawIssues = jsonSnapshot(top.issues!.value);
    if (!Array.isArray(rawIssues)) failure();
    const issues = rawIssues.map(issueProjection);

    const preview = jsonSnapshot(top.preview!.value);
    const previewFields = exactDataDescriptors(preview, [
      "width", "height", "projectId", "timeContractVersion", "frameNumbers",
      "frameTimes", "frameHashes", "quality"
    ]);
    const frameNumbers = previewFields.frameNumbers!.value;
    const frameTimes = previewFields.frameTimes!.value;
    const frameHashes = previewFields.frameHashes!.value;
    if (previewFields.width!.value !== 160 || previewFields.height!.value !== 90
      || previewFields.quality!.value !== "draft"
      || previewFields.timeContractVersion!.value !== "1.1.0"
      || typeof previewFields.projectId!.value !== "string"
      || !Array.isArray(frameNumbers) || !Array.isArray(frameTimes) || !Array.isArray(frameHashes)
      || frameHashes.length < 1 || frameNumbers.length !== frameHashes.length
      || frameTimes.length !== frameHashes.length) failure();

    const candidate: AiPlanCompletedResultV2 = {
      contract: "ai-plan-result/v2",
      storyboard,
      editableProject: editable.value,
      issues,
      preview: {
        width: 160,
        height: 90,
        quality: "draft",
        frameCount: frameHashes.length,
        timeContractVersion: "1.1.0"
      }
    };
    const validated = P0_BROWSER_PROJECT_AUTHORITY_V1.validateAiPlanCompletedResult(candidate);
    if (!validated.valid) failure();
    return validated.value;
  } catch {
    failure();
  }
}
