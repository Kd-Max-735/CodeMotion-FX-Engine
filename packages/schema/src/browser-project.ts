import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import {
  ENGINE_VERSION,
  PROJECT_SCHEMA_VERSION,
  type Animatable,
  type JsonObject,
  type JsonSchema,
  type JsonValue,
  type MotionProject
} from "@codemotion/core";
import { validateContract } from "./validation.js";
import type { AiPlanCompletedResultV2 } from "./ai-plan-result.js";
import type {
  EditorPreviewRequestV1,
  ExportCreateRequestV1,
  ExportTaskViewV1
} from "./editor-render-api.js";

export const BROWSER_PROJECT_CONTRACT = "browser-project/v1" as const;
export const BROWSER_ASSET_URI = "cmfx-browser-asset://opaque" as const;

export const APPLICATION_SCOPES = Object.freeze([
  "ai:plan",
  "assets:read",
  "assets:write",
  "project:preview",
  "export:create",
  "export:read"
] as const);

export type ApplicationScope = typeof APPLICATION_SCOPES[number];

const APPLICATION_SCOPE_SET: ReadonlySet<string> = new Set(APPLICATION_SCOPES);

export function isApplicationScope(value: unknown): value is ApplicationScope {
  return typeof value === "string" && APPLICATION_SCOPE_SET.has(value);
}

export function validateApplicationScopes(value: unknown): value is readonly ApplicationScope[] {
  return Array.isArray(value) && value.every(isApplicationScope) && new Set(value).size === value.length;
}

export interface BrowserProjectConstraintsV1 {
  readonly style: readonly string[];
  readonly brand: {
    readonly colors: readonly string[];
    readonly tone: readonly string[];
    readonly requiredText: readonly string[];
    readonly forbiddenContent: readonly string[];
    readonly logoAssetIds: readonly string[];
  };
}

export interface BrowserProjectEnvelopeV1 {
  readonly contract: typeof BROWSER_PROJECT_CONTRACT;
  readonly project: MotionProject;
  readonly constraints: BrowserProjectConstraintsV1;
}

export interface BrowserProjectEffectDefinitionV1 {
  readonly sourceId: string;
  readonly effectId: string;
  readonly version: string;
  readonly parameterSchema: JsonSchema;
}

export interface BrowserProjectValidationOptionsV1 {
  readonly effectsById: ReadonlyMap<string, BrowserProjectEffectDefinitionV1>;
  readonly evaluateAnimatableAt: (value: Animatable, time: number) => JsonValue;
}

export type TransportValidationErrorCodeV1 =
  | "UNSUPPORTED_CONTRACT"
  | "MALFORMED_REQUEST"
  | "BROWSER_PROJECT_UNSAFE"
  | "PROJECT_TOO_LARGE";

export interface TransportValidationErrorV1 {
  readonly code: TransportValidationErrorCodeV1;
  readonly message: string;
}

export type TransportValidationResultV1<T> =
  | { readonly valid: true; readonly value: T }
  | { readonly valid: false; readonly error: TransportValidationErrorV1 };

export interface BrowserProjectAuthorityV1 {
  readonly validateBrowserProjectEnvelope: (
    value: unknown
  ) => TransportValidationResultV1<BrowserProjectEnvelopeV1>;
  readonly sanitizeBrowserProject: (
    project: MotionProject,
    constraints: BrowserProjectConstraintsV1
  ) => TransportValidationResultV1<BrowserProjectEnvelopeV1>;
  readonly validateAiPlanCompletedResult: (
    value: unknown
  ) => TransportValidationResultV1<AiPlanCompletedResultV2>;
  readonly validateEditorPreviewRequest: (
    value: unknown
  ) => TransportValidationResultV1<EditorPreviewRequestV1>;
  readonly validateExportCreateRequest: (
    value: unknown
  ) => TransportValidationResultV1<ExportCreateRequestV1>;
  readonly validateExportTaskView: (
    value: unknown
  ) => TransportValidationResultV1<ExportTaskViewV1>;
}

const SAFE_MESSAGES: Readonly<Record<TransportValidationErrorCodeV1, string>> = Object.freeze({
  UNSUPPORTED_CONTRACT: "Unsupported contract.",
  MALFORMED_REQUEST: "Request does not match the required contract.",
  BROWSER_PROJECT_UNSAFE: "Browser project is not safe.",
  PROJECT_TOO_LARGE: "Browser project exceeds fixed limits."
});

export function transportValidationFailureV1<T>(
  code: TransportValidationErrorCodeV1
): TransportValidationResultV1<T> {
  return { valid: false, error: { code, message: SAFE_MESSAGES[code] } };
}

export function isTransportRecordV1(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

export function hasOnlyTransportKeysV1(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[] = allowed
): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key))
    && required.every((key) => Object.hasOwn(value, key));
}

const MAX_PROJECT_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 32;
const MAX_NODES = 100_000;
const MAX_GENERIC_STRING_SCALARS = 4_096;
const MAX_VECTOR_PATH_BYTES = 64 * 1024;
const MAX_GENERIC_ARRAY = 256;
const MAX_OBJECT_KEYS = 128;
export const BROWSER_PROJECT_LIMITS = Object.freeze({
  maxBytes: MAX_PROJECT_BYTES,
  maxDepth: MAX_DEPTH,
  maxNodes: MAX_NODES,
  maxGenericStringScalars: MAX_GENERIC_STRING_SCALARS,
  maxVectorPathBytes: MAX_VECTOR_PATH_BYTES,
  maxGenericArray: MAX_GENERIC_ARRAY,
  maxObjectKeys: MAX_OBJECT_KEYS,
  maxAssets: 256,
  maxCompositions: 32,
  maxLayers: 1_024,
  maxAudioTracks: 32,
  maxEffectsPerLayer: 32,
  maxParametersPerEffect: 128,
  maxKeyframes: 128
} as const);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const FORBIDDEN_IDENTIFIER_TOKENS = new Set([
  "script", "shader", "glsl", "wgsl", "plugin", "pluginid", "dependency",
  "dependencies", "import", "module", "package"
]);
const URL_LIKE = /^(?:[a-z][a-z0-9+.-]*:\/\/|file:|[a-z]:[\\/]|\\\\|\.{0,2}[\\/]|~[\\/])/i;
const COLOR = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;

function identifierTokens(key: string): readonly string[] {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_.-]+/u)
    .filter(Boolean).map((token) => token.toLowerCase());
}

function arrayLimit(key: string | undefined): number {
  if (key === "layers") return 1_024;
  if (key === "compositions") return 32;
  if (key === "audioTracks" || key === "effects") return 32;
  if (key === "keyframes") return 128;
  if (key === "inTangent" || key === "outTangent") return 16;
  if (["style", "colors", "tone", "requiredText", "forbiddenContent", "logoAssetIds"].includes(key ?? "")) {
    return 64;
  }
  return MAX_GENERIC_ARRAY;
}

function scalarLength(value: string): number {
  return [...value].length;
}

interface InspectionState {
  nodes: number;
  readonly seen: Set<object>;
}

function inspectValue(
  value: unknown,
  state: InspectionState,
  depth: number,
  key: string | undefined,
  insideEffectParams: boolean
): "safe" | "unsafe" | "budget" {
  if (depth > MAX_DEPTH) return "budget";
  state.nodes += 1;
  if (state.nodes > MAX_NODES) return "budget";
  if (value === null || typeof value === "boolean") return "safe";
  if (typeof value === "number") return Number.isFinite(value) ? "safe" : "unsafe";
  if (typeof value === "string") {
    const pathLike = key === "path" || key === "svg";
    const size = pathLike
      ? new TextEncoder().encode(value).byteLength
      : scalarLength(value);
    if (size > (pathLike ? MAX_VECTOR_PATH_BYTES : MAX_GENERIC_STRING_SCALARS)) return "budget";
    if (value !== BROWSER_ASSET_URI && !pathLike && !insideEffectParams && URL_LIKE.test(value)) return "unsafe";
    return "safe";
  }
  if (typeof value !== "object") return "unsafe";
  if (state.seen.has(value)) return "unsafe";
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > arrayLimit(key)) return "budget";
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) return "unsafe";
        const result = inspectValue(value[index], state, depth + 1, key, insideEffectParams);
        if (result !== "safe") return result;
      }
      return "safe";
    }
    if (!isTransportRecordV1(value)) return "unsafe";
    const keys = Object.keys(value);
    if (keys.length > MAX_OBJECT_KEYS) return "budget";
    for (const childKey of keys) {
      if (FORBIDDEN_KEYS.has(childKey) || /^on[a-z0-9_]*$/iu.test(childKey)) return "unsafe";
      const tokens = identifierTokens(childKey);
      if (tokens.some((token) => FORBIDDEN_IDENTIFIER_TOKENS.has(token))) return "unsafe";
      const childInsideParams = insideEffectParams || childKey === "params";
      const result = inspectValue(value[childKey], state, depth + 1, childKey, childInsideParams);
      if (result !== "safe") return result;
    }
    return "safe";
  } finally {
    state.seen.delete(value);
  }
}

export function inspectTransportJsonV1(value: unknown): "safe" | "unsafe" | "budget" {
  const result = inspectValue(value, { nodes: 0, seen: new Set() }, 0, undefined, false);
  if (result !== "safe") return result;
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return "unsafe";
    return new TextEncoder().encode(serialized).byteLength <= MAX_PROJECT_BYTES ? "safe" : "budget";
  } catch {
    return "unsafe";
  }
}

function strings(value: unknown, maximum = 64): value is readonly string[] {
  return Array.isArray(value) && value.length <= maximum
    && value.every((entry) => typeof entry === "string" && scalarLength(entry) <= MAX_GENERIC_STRING_SCALARS);
}

function validConstraints(value: unknown): value is BrowserProjectConstraintsV1 {
  if (!isTransportRecordV1(value)
    || !hasOnlyTransportKeysV1(value, ["style", "brand"])
    || !strings(value.style)) return false;
  const brand = value.brand;
  return isTransportRecordV1(brand)
    && hasOnlyTransportKeysV1(brand, ["colors", "tone", "requiredText", "forbiddenContent", "logoAssetIds"])
    && strings(brand.colors) && brand.colors.every((entry) => COLOR.test(entry))
    && strings(brand.tone) && strings(brand.requiredText)
    && strings(brand.forbiddenContent) && strings(brand.logoAssetIds);
}

export function isBrowserProjectConstraintsV1(value: unknown): value is BrowserProjectConstraintsV1 {
  return validConstraints(value);
}

function exact(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): value is Record<string, unknown> {
  return isTransportRecordV1(value) && hasOnlyTransportKeysV1(value, allowed, required);
}

function validNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validVector(value: unknown, dimensions: 2 | 3): boolean {
  const keys = dimensions === 2 ? ["x", "y"] : ["x", "y", "z"];
  return exact(value, keys) && keys.every((key) => validNumber(value[key]));
}

function validKeyframe(value: unknown, validateValue: (candidate: unknown) => boolean): boolean {
  if (!exact(
    value,
    ["time", "value", "easing", "interpolation", "inTangent", "outTangent"],
    ["time", "value"]
  ) || !validNumber(value.time) || !validateValue(value.value)) return false;
  if (value.interpolation !== undefined
    && !["linear", "hold", "bezier", "spring", "spline"].includes(String(value.interpolation))) return false;
  for (const tangent of [value.inTangent, value.outTangent]) {
    if (tangent !== undefined && (!Array.isArray(tangent) || tangent.length > 16 || !tangent.every(validNumber))) return false;
  }
  if (value.easing !== undefined) {
    if (!exact(value.easing, ["type", "params"], ["type"]) || typeof value.easing.type !== "string") return false;
    if (value.easing.params !== undefined
      && (!Array.isArray(value.easing.params) || value.easing.params.length > 16
        || !value.easing.params.every(validNumber))) return false;
  }
  return true;
}

function validAnimatable(value: unknown, validateValue: (candidate: unknown) => boolean): value is Animatable {
  if (!isTransportRecordV1(value)) return false;
  if (value.mode === "constant") {
    return hasOnlyTransportKeysV1(value, ["mode", "value"])
      && validateValue(value.value);
  }
  if (value.mode === "keyframes") {
    return hasOnlyTransportKeysV1(value, ["mode", "keyframes"])
      && Array.isArray(value.keyframes) && value.keyframes.length <= 128
      && value.keyframes.length > 0 && value.keyframes.every((entry) => validKeyframe(entry, validateValue));
  }
  return false;
}

function validTransform(value: unknown): boolean {
  return exact(value, ["anchorPoint", "position", "scale", "rotation", "skew"],
    ["anchorPoint", "position", "scale", "rotation"])
    && validAnimatable(value.anchorPoint, (candidate) => validVector(candidate, 3))
    && validAnimatable(value.position, (candidate) => validVector(candidate, 3))
    && validAnimatable(value.scale, (candidate) => validVector(candidate, 3))
    && validAnimatable(value.rotation, (candidate) => validVector(candidate, 3))
    && (value.skew === undefined || validAnimatable(value.skew, (candidate) => validVector(candidate, 2)));
}

function pathTokens(path: string): readonly string[] | undefined {
  if (new TextEncoder().encode(path).byteLength > MAX_VECTOR_PATH_BYTES
    || !/^[MLCZmlcz0-9eE+.,\s-]*$/u.test(path)) return undefined;
  const tokens = path.match(/[MLCZmlcz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gu) ?? [];
  const compactInput = path.replace(/[\s,]+/gu, "");
  if (tokens.join("") !== compactInput || tokens.length === 0) return undefined;
  return tokens;
}

function validVectorPath(path: unknown, coordinateLimit: number): boolean {
  if (typeof path !== "string") return false;
  const tokens = pathTokens(path);
  if (tokens === undefined) return false;
  let index = 0;
  let commands = 0;
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === undefined || !/^[MLCZmlcz]$/u.test(command)) return false;
    commands += 1;
    if (commands > 4_096) return false;
    const count = /[MmLl]/u.test(command) ? 2 : /[Cc]/u.test(command) ? 6 : 0;
    for (let coordinate = 0; coordinate < count; coordinate += 1) {
      const token = tokens[index++];
      if (token === undefined || /^[MLCZmlcz]$/u.test(token)) return false;
      const number = Number(token);
      if (!Number.isFinite(number) || Math.abs(number) > coordinateLimit) return false;
    }
  }
  return true;
}

function validProperties(type: string, value: unknown): boolean {
  if (!isTransportRecordV1(value)) return false;
  switch (type) {
    case "text":
      return hasOnlyTransportKeysV1(value, ["text", "fontFamily", "fontSize", "color"],
        ["text", "fontFamily", "fontSize"])
        && typeof value.text === "string" && scalarLength(value.text) <= 4_096
        && value.fontFamily === "Codemotion Planner Unicode Bitmap"
        && validNumber(value.fontSize) && value.fontSize >= 1 && value.fontSize <= 8_192
        && (value.color === undefined || (typeof value.color === "string" && COLOR.test(value.color)));
    case "shape":
      return hasOnlyTransportKeysV1(value, ["shapes", "fill"], ["shapes"])
        && Array.isArray(value.shapes) && value.shapes.length <= 256
        && value.shapes.every((shape) => exact(shape, ["path", "fill"], ["path"])
          && validVectorPath(shape.path, 8_192)
          && (shape.fill === undefined || (typeof shape.fill === "string" && COLOR.test(shape.fill))))
        && (value.fill === undefined || (typeof value.fill === "string" && COLOR.test(value.fill)));
    case "image":
      return hasOnlyTransportKeysV1(value, ["fit"])
        && ["cover", "contain", "fill", "none"].includes(String(value.fit));
    case "video":
      return hasOnlyTransportKeysV1(value, ["loop", "muted"])
        && typeof value.loop === "boolean" && typeof value.muted === "boolean";
    case "svg":
      return hasOnlyTransportKeysV1(value, ["svg", "fill", "stroke", "strokeWidth", "fillRule"], [])
        && (value.svg === undefined || validVectorPath(value.svg, 16))
        && (value.fill === undefined || (typeof value.fill === "string" && COLOR.test(value.fill)))
        && (value.stroke === undefined || (typeof value.stroke === "string" && COLOR.test(value.stroke)))
        && (value.strokeWidth === undefined || (validNumber(value.strokeWidth) && value.strokeWidth >= 0))
        && (value.fillRule === undefined || value.fillRule === "nonzero" || value.fillRule === "evenodd");
    case "composition":
      return hasOnlyTransportKeysV1(value, ["compositionId", "timeOffset", "timeRemap", "timeLoop"],
        ["compositionId"])
        && typeof value.compositionId === "string"
        && (value.timeOffset === undefined || validNumber(value.timeOffset))
        && (value.timeRemap === undefined || validAnimatable(value.timeRemap, validNumber))
        && (value.timeLoop === undefined || ["none", "repeat", "ping-pong"].includes(String(value.timeLoop)));
    default:
      return false;
  }
}

const effectAjv = new Ajv2020({ allErrors: false, strict: false });
const effectValidators = new WeakMap<object, ValidateFunction>();

function effectValidator(definition: BrowserProjectEffectDefinitionV1): ValidateFunction | undefined {
  const cacheKey = definition as object;
  const current = effectValidators.get(cacheKey);
  if (current !== undefined) return current;
  try {
    const compiled = effectAjv.compile(definition.parameterSchema as object | boolean);
    effectValidators.set(cacheKey, compiled);
    return compiled;
  } catch {
    return undefined;
  }
}

function validP0EffectRegistry(options: unknown): options is BrowserProjectValidationOptionsV1 {
  if (!isTransportRecordV1(options)
    || !(options.effectsById instanceof Map) || options.effectsById.size !== 40
    || typeof options.evaluateAnimatableAt !== "function") return false;
  const sourceIds = new Set<string>();
  for (const [effectId, definition] of options.effectsById) {
    if (typeof effectId !== "string" || effectId.trim().length === 0
      || definition === null || typeof definition !== "object"
      || definition.effectId !== effectId || definition.effectId.trim().length === 0
      || typeof definition.sourceId !== "string" || definition.sourceId.trim().length === 0
      || sourceIds.has(definition.sourceId)
      || typeof definition.version !== "string" || definition.version.trim().length === 0
      || definition.parameterSchema === null || typeof definition.parameterSchema !== "object") return false;
    sourceIds.add(definition.sourceId);
  }
  return true;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function cloneParameterSchema(value: unknown): JsonSchema | undefined {
  try {
    const serialized = JSON.stringify(value, (key, child: unknown) => {
      if (FORBIDDEN_KEYS.has(key) || typeof child === "function" || typeof child === "symbol"
        || typeof child === "bigint" || (typeof child === "number" && !Number.isFinite(child))) {
        throw new Error("invalid");
      }
      return child;
    });
    if (serialized === undefined) return undefined;
    const cloned = JSON.parse(serialized) as unknown;
    if (!isTransportRecordV1(cloned)) return undefined;
    return deepFreeze(cloned as JsonSchema);
  } catch {
    return undefined;
  }
}

export function createBrowserProjectValidationOptionsV1Internal(
  registry: unknown,
  evaluateAnimatableAt: unknown
): BrowserProjectValidationOptionsV1 | undefined {
  if (!(registry instanceof Map) || registry.size !== 40 || typeof evaluateAnimatableAt !== "function") {
    return undefined;
  }
  const definitions = new Map<string, BrowserProjectEffectDefinitionV1>();
  const sourceIds = new Set<string>();
  try {
    for (const [effectId, candidate] of registry) {
      if (typeof effectId !== "string" || effectId.trim().length === 0
        || candidate === null || typeof candidate !== "object") return undefined;
      const definition = candidate as Record<string, unknown>;
      if (definition.effectId !== effectId
        || typeof definition.sourceId !== "string" || definition.sourceId.trim().length === 0
        || sourceIds.has(definition.sourceId)
        || typeof definition.version !== "string" || definition.version.trim().length === 0) return undefined;
      const parameterSchema = cloneParameterSchema(definition.parameterSchema);
      if (parameterSchema === undefined) return undefined;
      const snapshot = deepFreeze({
        sourceId: definition.sourceId,
        effectId,
        version: definition.version,
        parameterSchema
      } satisfies BrowserProjectEffectDefinitionV1);
      if (effectValidator(snapshot) === undefined) return undefined;
      sourceIds.add(snapshot.sourceId);
      definitions.set(effectId, snapshot);
    }
  } catch {
    return undefined;
  }
  const options = {
    effectsById: definitions,
    evaluateAnimatableAt: evaluateAnimatableAt as BrowserProjectValidationOptionsV1["evaluateAnimatableAt"]
  } satisfies BrowserProjectValidationOptionsV1;
  return Object.freeze(options);
}

function parameterValueAt(
  value: unknown,
  time: number,
  options: BrowserProjectValidationOptionsV1
): JsonValue | undefined {
  if (!isTransportRecordV1(value) || typeof value.mode !== "string") return value as JsonValue;
  if (value.mode === "constant") return value.value as JsonValue;
  if (value.mode !== "keyframes") return undefined;
  try {
    return options.evaluateAnimatableAt(value as unknown as Animatable, time);
  } catch {
    return undefined;
  }
}

export function validateP0EffectSnapshotV1(
  effectId: unknown,
  version: unknown,
  params: unknown,
  options: BrowserProjectValidationOptionsV1,
  startTime = 0,
  endTime = startTime
): boolean {
  if (!validP0EffectRegistry(options)
    || typeof effectId !== "string" || typeof version !== "string" || !isTransportRecordV1(params)) return false;
  const definition = options.effectsById.get(effectId);
  if (definition === undefined || definition.effectId !== effectId || definition.version !== version) return false;
  const times = new Set<number>([startTime, endTime]);
  for (const value of Object.values(params)) {
    if (isTransportRecordV1(value) && value.mode === "keyframes" && Array.isArray(value.keyframes)) {
      for (const frame of value.keyframes) {
        if (!isTransportRecordV1(frame) || !validNumber(frame.time)) return false;
        times.add(frame.time);
      }
    }
  }
  const validator = effectValidator(definition);
  if (validator === undefined) return false;
  for (const time of times) {
    const snapshot: Record<string, JsonValue> = {};
    for (const [name, value] of Object.entries(params)) {
      const resolved = parameterValueAt(value, time, options);
      if (resolved === undefined) return false;
      snapshot[name] = resolved;
    }
    if (!validator(snapshot)) return false;
  }
  return true;
}

function validEffect(value: unknown, options: BrowserProjectValidationOptionsV1): boolean {
  if (!exact(value,
    ["id", "effectId", "version", "enabled", "startTime", "endTime", "mix", "maskId", "params",
      "renderQuality", "cachePolicy"],
    ["id", "effectId", "version", "enabled", "mix", "params"])) return false;
  if (typeof value.id !== "string" || typeof value.enabled !== "boolean"
    || (value.startTime !== undefined && !validNumber(value.startTime))
    || (value.endTime !== undefined && !validNumber(value.endTime))
    || !validAnimatable(value.mix, validNumber)
    || value.maskId !== undefined
    || !isTransportRecordV1(value.params)
    || Object.keys(value.params).length > 128) return false;
  for (const parameter of Object.values(value.params)) {
    if (isTransportRecordV1(parameter) && typeof parameter.mode === "string"
      && !validAnimatable(parameter, () => true)) return false;
  }
  return validateP0EffectSnapshotV1(
    value.effectId,
    value.version,
    value.params,
    options,
    typeof value.startTime === "number" ? value.startTime : 0,
    typeof value.endTime === "number" ? value.endTime : 0
  );
}

const ALLOWED_LAYER_TYPES = new Set(["text", "shape", "image", "video", "svg", "composition"]);

function validLayer(value: unknown, options: BrowserProjectValidationOptionsV1): boolean {
  if (!exact(value,
    ["id", "type", "name", "visible", "locked", "solo", "startTime", "endTime", "inPoint", "outPoint",
      "parentId", "zIndex", "transform", "opacity", "blendMode", "masks", "effects", "source", "properties"],
    ["id", "type", "name", "visible", "locked", "solo", "startTime", "endTime", "inPoint", "outPoint",
      "zIndex", "transform", "opacity", "blendMode", "masks", "effects", "properties"])) return false;
  if (typeof value.type !== "string" || !ALLOWED_LAYER_TYPES.has(value.type)
    || typeof value.id !== "string" || typeof value.name !== "string"
    || typeof value.visible !== "boolean" || typeof value.locked !== "boolean" || typeof value.solo !== "boolean"
    || ![value.startTime, value.endTime, value.inPoint, value.outPoint, value.zIndex].every(validNumber)
    || (value.parentId !== undefined && typeof value.parentId !== "string")
    || !validTransform(value.transform) || !validAnimatable(value.opacity, validNumber)
    || typeof value.blendMode !== "string"
    || !Array.isArray(value.masks) || value.masks.length !== 0
    || !Array.isArray(value.effects) || value.effects.length > 32
    || !value.effects.every((effect) => validEffect(effect, options))
    || !validProperties(value.type, value.properties)) return false;
  const requiresSource = value.type === "image" || value.type === "video";
  return requiresSource
    ? exact(value.source, ["assetId"]) && typeof value.source.assetId === "string"
    : value.source === undefined;
}

function validMarker(value: unknown): boolean {
  return exact(value, ["id", "time", "name", "color"], ["id", "time", "name"])
    && typeof value.id === "string" && validNumber(value.time) && typeof value.name === "string"
    && (value.color === undefined || (typeof value.color === "string" && COLOR.test(value.color)));
}

function validComposition(value: unknown, options: BrowserProjectValidationOptionsV1): boolean {
  return exact(value, ["id", "name", "width", "height", "duration", "fps", "layers", "markers", "effects", "effectGraph"],
    ["id", "name", "width", "height", "duration", "layers"])
    && typeof value.id === "string" && typeof value.name === "string"
    && [value.width, value.height, value.duration].every(validNumber)
    && (value.fps === undefined || validNumber(value.fps))
    && Array.isArray(value.layers) && value.layers.every((layer) => validLayer(layer, options))
    && (value.markers === undefined || (Array.isArray(value.markers)
      && value.markers.length <= 256 && value.markers.every(validMarker)))
    && (value.effects === undefined || (Array.isArray(value.effects) && value.effects.length === 0))
    && value.effectGraph === undefined;
}

function collectProjectReferences(project: MotionProject, constraints: BrowserProjectConstraintsV1): Set<string> {
  const references = new Set<string>(constraints.brand.logoAssetIds);
  if (project.background.type === "asset") references.add(project.background.assetId);
  for (const track of project.audioTracks) references.add(track.assetId);
  const assetIds = new Set(project.assets.map((asset) => asset.id));
  const seen = new Set<object>();
  const collectParameterAssets = (value: unknown): void => {
    if (typeof value === "string" && assetIds.has(value)) references.add(value);
    else if (Array.isArray(value)) value.forEach(collectParameterAssets);
    else if (isTransportRecordV1(value) && !seen.has(value)) {
      seen.add(value);
      Object.values(value).forEach(collectParameterAssets);
    }
  };
  for (const composition of project.compositions) {
    for (const layer of composition.layers) {
      if (layer.source !== undefined) references.add(layer.source.assetId);
      for (const effect of layer.effects) collectParameterAssets(effect.params);
    }
  }
  return references;
}

function validProjectStructure(
  project: MotionProject,
  constraints: BrowserProjectConstraintsV1,
  options: BrowserProjectValidationOptionsV1
): boolean {
  const record = project as unknown as Record<string, unknown>;
  if (!hasOnlyTransportKeysV1(record,
    ["schemaVersion", "engineVersion", "id", "name", "width", "height", "fps", "duration", "background",
      "colorSpace", "seed", "assets", "compositions", "fonts", "audioTracks", "renderPresets", "metadata"])) return false;
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION || project.engineVersion !== ENGINE_VERSION
    || project.assets.length > 256 || project.compositions.length > 32
    || project.audioTracks.length > 32 || project.renderPresets.length !== 0) return false;
  if (!exact(project.metadata, ["timeContractVersion"]) || project.metadata.timeContractVersion !== "1.1.0") return false;
  if (project.fonts.length > 1 || project.fonts.some((font) => !exact(font, ["id", "family"])
    || font.id !== "font.codemotion.unicode-bitmap-v1"
    || font.family !== "Codemotion Planner Unicode Bitmap")) return false;
  if (!project.assets.every((asset) => exact(asset, ["id", "type", "uri", "metadata"])
    && typeof asset.id === "string"
    && ["image", "video", "audio", "svg"].includes(asset.type)
    && asset.uri === BROWSER_ASSET_URI && exact(asset.metadata, [], []))) return false;
  const assetIds = project.assets.map((asset) => asset.id);
  if (new Set(assetIds).size !== assetIds.length) return false;
  if (!project.compositions.every((composition) => validComposition(composition, options))) return false;
  const layers = project.compositions.flatMap((composition) => composition.layers);
  if (layers.length > 1_024 || new Set(layers.map((layer) => layer.id)).size !== layers.length) return false;
  if (!project.audioTracks.every((track) => exact(track, ["id", "assetId", "startTime", "endTime", "volume"])
    && typeof track.id === "string" && typeof track.assetId === "string"
    && validNumber(track.startTime) && validNumber(track.endTime)
    && validAnimatable(track.volume, validNumber))) return false;
  const references = collectProjectReferences(project, constraints);
  if (references.size !== assetIds.length || assetIds.some((id) => !references.has(id))) return false;
  if ([...references].some((id) => !assetIds.includes(id))) return false;
  const byId = new Map(project.assets.map((asset) => [asset.id, asset.type]));
  for (const composition of project.compositions) {
    const layerIds = new Set(composition.layers.map((layer) => layer.id));
    for (const layer of composition.layers) {
      if (layer.parentId !== undefined && !layerIds.has(layer.parentId)) return false;
      if (layer.source !== undefined) {
        const type = byId.get(layer.source.assetId);
        if (layer.type === "image" && type !== "image" && type !== "svg") return false;
        if (layer.type === "video" && type !== "video") return false;
      }
      if (layer.type === "composition"
        && !project.compositions.some((candidate) => candidate.id === layer.properties.compositionId)) return false;
    }
  }
  for (const track of project.audioTracks) if (byId.get(track.assetId) !== "audio") return false;
  for (const id of constraints.brand.logoAssetIds) {
    const type = byId.get(id);
    if (type !== "image" && type !== "svg") return false;
  }
  return noReferenceCycles(project);
}

function acyclic(edges: ReadonlyMap<string, readonly string[]>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const next of edges.get(id) ?? []) if (!visit(next)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  return [...edges.keys()].every(visit);
}

function noReferenceCycles(project: MotionProject): boolean {
  const compositions = new Map<string, string[]>();
  for (const composition of project.compositions) {
    const layerEdges = new Map<string, string[]>();
    const nested: string[] = [];
    for (const layer of composition.layers) {
      layerEdges.set(layer.id, layer.parentId === undefined ? [] : [layer.parentId]);
      if (layer.type === "composition") nested.push(layer.properties.compositionId);
    }
    if (!acyclic(layerEdges)) return false;
    compositions.set(composition.id, nested);
  }
  return acyclic(compositions);
}

function commandCount(value: unknown): number {
  if (typeof value !== "string") return 0;
  return (value.match(/[MLCZmlcz]/gu) ?? []).length;
}

function semanticProjectBudgetExceeded(value: Record<string, unknown>): boolean {
  if (!isTransportRecordV1(value.project)) return false;
  const project = value.project;
  if (!Array.isArray(project.compositions)) return false;
  let totalLayers = 0;
  for (const composition of project.compositions) {
    if (!isTransportRecordV1(composition) || !Array.isArray(composition.layers)) continue;
    totalLayers += composition.layers.length;
    if (totalLayers > 1_024) return true;
    for (const layer of composition.layers) {
      if (!isTransportRecordV1(layer) || !isTransportRecordV1(layer.properties)) continue;
      if (layer.type === "shape" && Array.isArray(layer.properties.shapes)) {
        let commands = 0;
        for (const shape of layer.properties.shapes) {
          if (isTransportRecordV1(shape)) commands += commandCount(shape.path);
        }
        if (commands > 4_096) return true;
      }
      if (layer.type === "svg" && commandCount(layer.properties.svg) > 4_096) return true;
    }
  }
  return false;
}

export function validateBrowserProjectEnvelopeV1Internal(
  value: unknown,
  options: BrowserProjectValidationOptionsV1
): TransportValidationResultV1<BrowserProjectEnvelopeV1> {
  if (!validP0EffectRegistry(options)) return transportValidationFailureV1("BROWSER_PROJECT_UNSAFE");
  const inspection = inspectTransportJsonV1(value);
  if (inspection === "budget") return transportValidationFailureV1("PROJECT_TOO_LARGE");
  if (inspection === "unsafe" || !isTransportRecordV1(value)) {
    return transportValidationFailureV1("BROWSER_PROJECT_UNSAFE");
  }
  if (value.contract !== BROWSER_PROJECT_CONTRACT) return transportValidationFailureV1("UNSUPPORTED_CONTRACT");
  if (semanticProjectBudgetExceeded(value)) return transportValidationFailureV1("PROJECT_TOO_LARGE");
  if (!hasOnlyTransportKeysV1(value, ["contract", "project", "constraints"])
    || !validConstraints(value.constraints)) return transportValidationFailureV1("BROWSER_PROJECT_UNSAFE");
  const schema = validateContract("MotionProject", value.project);
  if (!schema.valid || !validProjectStructure(schema.value, value.constraints, options)) {
    return transportValidationFailureV1("BROWSER_PROJECT_UNSAFE");
  }
  return { valid: true, value: value as unknown as BrowserProjectEnvelopeV1 };
}

export function sanitizeBrowserProjectV1Internal(
  project: MotionProject,
  constraints: BrowserProjectConstraintsV1,
  options: BrowserProjectValidationOptionsV1
): TransportValidationResultV1<BrowserProjectEnvelopeV1> {
  const sourceSchema = validateContract("MotionProject", project);
  if (!sourceSchema.valid || !validP0EffectRegistry(options)) {
    return transportValidationFailureV1("BROWSER_PROJECT_UNSAFE");
  }
  project = sourceSchema.value;
  if (project.schemaVersion !== PROJECT_SCHEMA_VERSION || project.engineVersion !== ENGINE_VERSION
    || !validConstraints(constraints)) {
    return transportValidationFailureV1("BROWSER_PROJECT_UNSAFE");
  }
  if (!project.assets.every((asset) => exact(asset, ["id", "type", "uri", "hash", "metadata"],
    ["id", "type", "uri", "metadata"]))) {
    return transportValidationFailureV1("BROWSER_PROJECT_UNSAFE");
  }
  const sourceAssetIds = new Set(project.assets.map((asset) => asset.id));
  const temporaryProject = {
    ...project,
    assets: project.assets.map((asset) => ({ id: asset.id, type: asset.type, uri: BROWSER_ASSET_URI, metadata: {} })),
    metadata: { timeContractVersion: "1.1.0" }
  } as MotionProject;
  const inspection = inspectTransportJsonV1({
    contract: BROWSER_PROJECT_CONTRACT,
    project: temporaryProject,
    constraints
  });
  if (inspection === "budget") return transportValidationFailureV1("PROJECT_TOO_LARGE");
  if (inspection === "unsafe") return transportValidationFailureV1("BROWSER_PROJECT_UNSAFE");
  const references = collectProjectReferences(temporaryProject, constraints);
  if ([...references].some((id) => !sourceAssetIds.has(id))) {
    return transportValidationFailureV1("BROWSER_PROJECT_UNSAFE");
  }
  temporaryProject.assets = temporaryProject.assets.filter((asset) => references.has(asset.id));
  const envelope: BrowserProjectEnvelopeV1 = {
    contract: BROWSER_PROJECT_CONTRACT,
    project: temporaryProject,
    constraints
  };
  const validated = validateBrowserProjectEnvelopeV1Internal(envelope, options);
  if (!validated.valid) return validated;
  const detached = JSON.parse(JSON.stringify(validated.value)) as unknown;
  return validateBrowserProjectEnvelopeV1Internal(detached, options);
}
