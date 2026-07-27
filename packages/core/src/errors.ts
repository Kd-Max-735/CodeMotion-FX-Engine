import type { JsonObject } from "./types.js";

export const ERROR_CODES = Object.freeze({
  INVALID_SEED: "CMFX_INVALID_SEED",
  INPUT_TOO_LARGE: "CMFX_INPUT_TOO_LARGE",
  PARSE_ERROR: "CMFX_PARSE_ERROR",
  SCHEMA_INVALID: "CMFX_SCHEMA_INVALID",
  UNSUPPORTED_SCHEMA_VERSION: "CMFX_UNSUPPORTED_SCHEMA_VERSION",
  MIGRATION_FAILED: "CMFX_MIGRATION_FAILED",
  INVALID_TIME: "CMFX_INVALID_TIME",
  KEYFRAME_INVALID: "CMFX_KEYFRAME_INVALID",
  SCENE_GRAPH_INVALID: "CMFX_SCENE_GRAPH_INVALID",
  COMMAND_FAILED: "CMFX_COMMAND_FAILED",
  RENDERER_INCOMPATIBLE: "CMFX_RENDERER_INCOMPATIBLE",
  RENDERER_LIFECYCLE: "CMFX_RENDERER_LIFECYCLE"
});

export type EngineErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details?: JsonObject;

  constructor(code: EngineErrorCode, message: string, options: { cause?: unknown; details?: JsonObject } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "EngineError";
    this.code = code;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}

export function isEngineError(value: unknown): value is EngineError {
  return value instanceof EngineError;
}
