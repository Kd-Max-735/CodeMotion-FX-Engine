import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { JsonObject, JsonValue } from "@codemotion/core";
import type {
  AuthorizedEffectInput,
  AuthorizedEffectInputValue,
  AuthorizedEffectInputs,
  EffectInputSlotDefinition,
  EffectParameterEnvelope,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "./types.js";

export type EffectToolContractErrorCode =
  | "DEFINITION_INVALID"
  | "ENVELOPE_INVALID"
  | "TYPE_MISMATCH"
  | "PARAMETER_INVALID"
  | "RESOURCE_INJECTION"
  | "NORMALIZATION_INVALID"
  | "INPUT_AUTHORIZATION_INVALID"
  | "SERVER_CONTEXT_INVALID";

export class EffectToolContractError extends Error {
  public constructor(
    public readonly code: EffectToolContractErrorCode,
    message: string,
    public readonly issues: readonly string[] = []
  ) {
    super(message);
    this.name = "EffectToolContractError";
  }
}

interface CompiledDefinition {
  readonly validate: ValidateFunction;
  readonly propertyNames: readonly string[];
}

const definitionCache = new WeakMap<object, CompiledDefinition>();
const TOOL_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const SLOT_NAME = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const RESERVED_PARAMETER_NAMES = new Set([
  "asset", "asset_id", "resource", "resource_id", "file", "file_id", "file_path",
  "url", "uri", "path", "image", "video", "audio", "mask", "mask_id", "lut",
  "lut_id", "depth_map", "font", "font_id", "model", "model_id", "texture", "texture_id"
]);
const RESOURCE_KEY = /(?:^|_)(?:asset|resource|file|url|uri)(?:_|$)|(?:_id|_path|_url|_uri)$/u;
const URL_VALUE = /^(?:https?|file|data|blob|media|asset|resource|font|model|texture):/iu;
const WINDOWS_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/u;
const UNIX_OR_RELATIVE_PATH = /^(?:\.{1,2}[\\/]|\/(?:[^/\s]+\/)*[^/\s]*)/u;
const RESOURCE_ID = /^(?:asset_[a-f0-9]{16,}|resource_[a-z0-9_-]{12,}|file-[a-z0-9_-]{12,})$/iu;

function fail(
  code: EffectToolContractErrorCode,
  message: string,
  issues: readonly string[] = []
): never {
  throw new EffectToolContractError(code, message, Object.freeze([...issues]));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value: unknown, path = "$", depth = 0): JsonValue {
  if (depth > 32) fail("ENVELOPE_INVALID", "Model output exceeds the maximum JSON depth.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("PARAMETER_INVALID", "Model parameters must contain only finite numbers.", [path]);
    }
    return value;
  }
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).filter((key) => key !== "length");
    if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
      fail("ENVELOPE_INVALID", "Model arrays must be dense JSON arrays.", [path]);
    }
    return keys.map((key) => {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) {
        fail("ENVELOPE_INVALID", "Model output may not contain accessors.", [`${path}[${key}]`]);
      }
      return cloneJson(descriptor.value, `${path}[${key}]`, depth + 1);
    });
  }
  if (!isPlainRecord(value)) {
    fail("ENVELOPE_INVALID", "Model output must contain only plain JSON values.", [path]);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: JsonObject = Object.create(null) as JsonObject;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || key === "__proto__" || key === "prototype" || key === "constructor") {
      fail("ENVELOPE_INVALID", "Model output contains a forbidden property.", [path]);
    }
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      fail("ENVELOPE_INVALID", "Model output may contain only enumerable data properties.", [`${path}.${key}`]);
    }
    output[key] = cloneJson(descriptor.value, `${path}.${key}`, depth + 1);
  }
  return output;
}

function resourceInjectionIssues(value: JsonValue, path = "$.data"): string[] {
  const issues: string[] = [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (URL_VALUE.test(trimmed)) issues.push(`${path}: URL or resource URI`);
    if (WINDOWS_PATH.test(trimmed) || UNIX_OR_RELATIVE_PATH.test(trimmed)) {
      issues.push(`${path}: file path`);
    }
    if (RESOURCE_ID.test(trimmed)) issues.push(`${path}: resource identifier`);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => issues.push(...resourceInjectionIssues(entry, `${path}[${index}]`)));
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const normalized = key.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
      if (RESERVED_PARAMETER_NAMES.has(normalized) || RESOURCE_KEY.test(normalized)) {
        issues.push(`${path}.${key}: resource-bearing parameter name`);
      }
      issues.push(...resourceInjectionIssues(entry, `${path}.${key}`));
    }
  }
  return issues;
}

function schemaRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isPlainRecord(value)) fail("DEFINITION_INVALID", `${name} must be a JSON object.`);
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function ajvIssues(validate: ValidateFunction): readonly string[] {
  return Object.freeze((validate.errors ?? []).map((issue) =>
    `${issue.instancePath || "$"} ${issue.message ?? "is invalid"}`));
}

function assertSchemaValue(
  validate: ValidateFunction,
  value: JsonObject,
  code: "DEFINITION_INVALID" | "PARAMETER_INVALID" | "NORMALIZATION_INVALID",
  label: string
): void {
  if (!validate(value)) fail(code, `${label} does not match parameterSchema.`, ajvIssues(validate));
}

export function assertEffectToolDefinition(
  definition: EffectToolDefinition
): void {
  if (definitionCache.has(definition)) return;
  if (!TOOL_NAME.test(definition.toolName)) {
    fail("DEFINITION_INVALID", "toolName must be a unique snake_case identifier.");
  }
  if (definition.effectId.trim().length === 0 || definition.displayName.trim().length === 0
    || definition.category.trim().length === 0 || !SEMVER.test(definition.version)) {
    fail("DEFINITION_INVALID", "Effect identity, display name, category, and semantic version are required.");
  }
  const schema = schemaRecord(definition.parameterSchema, "parameterSchema");
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    fail("DEFINITION_INVALID", "parameterSchema must be a closed object Schema.");
  }
  const properties = schemaRecord(schema.properties, "parameterSchema.properties");
  const propertyNames = Object.keys(properties);
  for (const name of propertyNames) {
    const normalized = name.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase();
    if (RESERVED_PARAMETER_NAMES.has(normalized) || RESOURCE_KEY.test(normalized)) {
      fail("DEFINITION_INVALID", `parameterSchema may not expose the resource-bearing field ${name}.`);
    }
    const property = schemaRecord(properties[name], `parameterSchema.properties.${name}`);
    if (!("default" in property) || !(name in definition.defaults)
      || !sameJson(property.default, definition.defaults[name])) {
      fail("DEFINITION_INVALID", `Schema/default mismatch for parameter ${name}.`);
    }
  }
  const defaultNames = Object.keys(definition.defaults);
  if (defaultNames.length !== propertyNames.length
    || defaultNames.some((name) => !propertyNames.includes(name))) {
    fail("DEFINITION_INVALID", "defaults must contain exactly every parameterSchema property.");
  }
  const defaultResourceIssues = resourceInjectionIssues(definition.defaults);
  if (defaultResourceIssues.length > 0) {
    fail("DEFINITION_INVALID", "defaults may not contain resources, paths, or URLs.", defaultResourceIssues);
  }
  const slots = new Set<string>();
  for (const slot of definition.inputSlots) {
    if (!SLOT_NAME.test(slot.name) || slots.has(slot.name) || slot.description.trim().length === 0) {
      fail("DEFINITION_INVALID", "Input slot names must be unique snake_case identifiers with descriptions.");
    }
    slots.add(slot.name);
  }
  if (definition.primaryBackend.kind === "ffmpeg" && definition.primaryBackend.deterministic !== true) {
    fail("DEFINITION_INVALID", "Primary server backend must declare deterministic behavior.");
  }
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictNumbers: true,
    multipleOfPrecision: 12
  });
  let validate: ValidateFunction;
  try {
    validate = ajv.compile(definition.parameterSchema as object);
  } catch (cause) {
    fail("DEFINITION_INVALID", `parameterSchema could not be compiled: ${String(cause)}`);
  }
  assertSchemaValue(validate!, definition.defaults, "DEFINITION_INVALID", "defaults");
  const defaultValidation = definition.validateParams(definition.defaults);
  if (!defaultValidation.valid) {
    fail("DEFINITION_INVALID", "defaults failed validateParams.",
      defaultValidation.issues.map((issue) => `${issue.path}: ${issue.message}`));
  }
  for (const preset of definition.presets) {
    if (preset.presetId.trim().length === 0 || preset.displayName.trim().length === 0) {
      fail("DEFINITION_INVALID", "Every preset requires an ID and display name.");
    }
    assertSchemaValue(validate!, preset.params, "DEFINITION_INVALID", `Preset ${preset.presetId}`);
    const issues = resourceInjectionIssues(preset.params);
    if (issues.length > 0) {
      fail("DEFINITION_INVALID", `Preset ${preset.presetId} contains a resource identity.`, issues);
    }
  }
  definitionCache.set(definition, Object.freeze({
    validate: validate!,
    propertyNames: Object.freeze(propertyNames)
  }));
}

function compiled(definition: EffectToolDefinition): CompiledDefinition {
  assertEffectToolDefinition(definition);
  return definitionCache.get(definition)!;
}

function parameterObject(value: JsonValue, label: string): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail("ENVELOPE_INVALID", `${label} must be a JSON object.`);
  }
  return value;
}

function assertCustomValidation(
  definition: EffectToolDefinition,
  params: JsonObject,
  code: "PARAMETER_INVALID" | "NORMALIZATION_INVALID"
): void {
  const result = definition.validateParams(params);
  if (!result.valid) {
    fail(code, "Effect-specific parameter validation failed.",
      result.issues.map((issue) => `${issue.path}: ${issue.message}`));
  }
}

export function validateAndNormalizeEffectEnvelope<Params extends JsonObject>(
  definition: EffectToolDefinition<Params>,
  selectedToolName: string,
  value: unknown
): EffectParameterEnvelope<Params> {
  const contract = compiled(definition);
  const snapshot = parameterObject(cloneJson(value), "Model output");
  const keys = Object.keys(snapshot);
  if (keys.length !== 2 || !keys.includes("type") || !keys.includes("data")) {
    fail("ENVELOPE_INVALID", "Model output must contain exactly type and data.");
  }
  if (typeof snapshot.type !== "string") fail("ENVELOPE_INVALID", "Envelope type must be a string.");
  if (selectedToolName !== definition.toolName || snapshot.type !== selectedToolName) {
    fail("TYPE_MISMATCH", "Envelope type must exactly equal the user-selected tool name.");
  }
  const raw = parameterObject(snapshot.data!, "Envelope data");
  const injection = resourceInjectionIssues(raw);
  if (injection.length > 0) {
    fail("RESOURCE_INJECTION", "Model data may not contain resource IDs, paths, or URLs.", injection);
  }
  assertSchemaValue(contract.validate, raw, "PARAMETER_INVALID", "Envelope data");
  const merged = cloneJson({ ...definition.defaults, ...raw });
  const complete = parameterObject(merged, "Defaulted parameters") as Params;
  assertSchemaValue(contract.validate, complete, "PARAMETER_INVALID", "Defaulted parameters");
  assertCustomValidation(definition, complete, "PARAMETER_INVALID");

  let normalizedValue: unknown;
  try {
    normalizedValue = definition.normalizeParams(complete);
  } catch (cause) {
    fail("NORMALIZATION_INVALID", `normalizeParams failed: ${String(cause)}`);
  }
  const normalized = parameterObject(cloneJson(normalizedValue), "Normalized parameters") as Params;
  const normalizedInjection = resourceInjectionIssues(normalized);
  if (normalizedInjection.length > 0) {
    fail("NORMALIZATION_INVALID", "Normalized parameters introduced a resource identity.", normalizedInjection);
  }
  assertSchemaValue(contract.validate, normalized, "NORMALIZATION_INVALID", "Normalized parameters");
  assertCustomValidation(definition, normalized, "NORMALIZATION_INVALID");
  return Object.freeze({ type: selectedToolName, data: Object.freeze(normalized) });
}

function valuesForSlot(
  slot: EffectInputSlotDefinition,
  value: AuthorizedEffectInputValue | undefined
): readonly AuthorizedEffectInput[] {
  if (value === undefined) return [];
  if (slot.cardinality === "many") {
    if (!Array.isArray(value)) {
      fail("INPUT_AUTHORIZATION_INVALID", `Input slot ${slot.name} requires an array binding.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    fail("INPUT_AUTHORIZATION_INVALID", `Input slot ${slot.name} accepts exactly one binding.`);
  }
  return [value as AuthorizedEffectInput];
}

export function assertAuthorizedEffectInputs(
  definition: EffectToolDefinition,
  context: ServerEffectRenderContext
): void {
  if (context.environment !== "server") {
    fail("SERVER_CONTEXT_INVALID", "Effect rendering requires a server context.");
  }
  const finite = [context.time, context.deltaTime, context.fps, context.width, context.height, context.seed];
  if (!finite.every(Number.isFinite) || !Number.isInteger(context.frame)
    || context.frame < 0 || context.deltaTime < 0 || context.fps <= 0
    || !Number.isInteger(context.width) || context.width < 1
    || !Number.isInteger(context.height) || context.height < 1) {
    fail("SERVER_CONTEXT_INVALID", "Server render time and dimensions must be finite and valid.");
  }
  const allowedBackends = [definition.primaryBackend,
    ...(definition.fallbackStrategy.kind === "server-backend" ? [definition.fallbackStrategy.backend] : [])];
  if (!allowedBackends.some((backend) => backend.backendId === context.backend.backendId
    && backend.kind === context.backend.kind && backend.version === context.backend.version)) {
    fail("SERVER_CONTEXT_INVALID", "Server context selected an undeclared backend.");
  }
  const slots = new Map(definition.inputSlots.map((slot) => [slot.name, slot]));
  for (const name of Object.keys(context.inputs)) {
    if (!slots.has(name)) {
      fail("INPUT_AUTHORIZATION_INVALID", `Unknown authorized input slot ${name}.`);
    }
  }
  for (const slot of definition.inputSlots) {
    const bindings = valuesForSlot(slot, context.inputs[slot.name]);
    if (slot.required && bindings.length === 0) {
      fail("INPUT_AUTHORIZATION_INVALID", `Required input slot ${slot.name} is not bound.`);
    }
    for (const binding of bindings) {
      if (!isPlainRecord(binding) || binding.slot !== slot.name || binding.kind !== slot.kind
        || binding.locked !== true || binding.tenantId !== context.tenantId
        || binding.userId !== context.userId) {
        fail("INPUT_AUTHORIZATION_INVALID", `Input slot ${slot.name} is not owner-scoped and locked.`);
      }
    }
  }
}

export async function executeSelectedEffectTool<
  Params extends JsonObject,
  Inputs extends AuthorizedEffectInputs,
  Output
>(
  definition: EffectToolDefinition<Params, Inputs, Output>,
  selectedToolName: string,
  modelOutput: unknown,
  context: ServerEffectRenderContext<Inputs>
) {
  const envelope = validateAndNormalizeEffectEnvelope(definition, selectedToolName, modelOutput);
  assertAuthorizedEffectInputs(definition, context);
  context.signal?.throwIfAborted();
  return definition.render(context, envelope.data);
}
