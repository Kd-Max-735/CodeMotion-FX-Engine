import {
  EngineError,
  ERROR_CODES,
  NOOP_LOGGER,
  PROJECT_SCHEMA_VERSION,
  type JsonObject,
  type JsonValue,
  type Logger,
  type MotionProject
} from "@codemotion/core";
import { validateContract, type ValidationIssue } from "./validation.js";

export const DEFAULT_MAX_PROJECT_BYTES = 5 * 1024 * 1024;
export const MAX_MIGRATION_STEPS = 32;

export interface ProjectMigration {
  readonly fromVersion: string;
  readonly toVersion: string;
  migrate(project: JsonObject): JsonObject;
}

export interface LoadProjectOptions {
  migrations?: readonly ProjectMigration[];
  maxInputBytes?: number;
  logger?: Logger;
}

export interface SaveProjectOptions {
  space?: number;
  logger?: Logger;
}

export const BUILT_IN_PROJECT_MIGRATIONS: readonly ProjectMigration[] = Object.freeze([
  {
    fromVersion: "1.0.0",
    toVersion: PROJECT_SCHEMA_VERSION,
    migrate(project): JsonObject {
      return { ...project, schemaVersion: PROJECT_SCHEMA_VERSION };
    }
  }
]);

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validationDetails(issues: readonly ValidationIssue[]): JsonObject {
  return {
    issues: issues.map((issue) => ({
      instancePath: issue.instancePath,
      schemaPath: issue.schemaPath,
      keyword: issue.keyword,
      message: issue.message,
      params: issue.params
    }))
  };
}

function readVersion(project: JsonObject): string {
  const version = project.schemaVersion;
  if (typeof version !== "string") {
    throw new EngineError(ERROR_CODES.SCHEMA_INVALID, "Project schemaVersion must be a string.");
  }
  return version;
}

export function migrateProject(
  input: JsonObject,
  migrations: readonly ProjectMigration[] = BUILT_IN_PROJECT_MIGRATIONS
): JsonObject {
  let project = input;
  let version = readVersion(project);
  const visited = new Set<string>();

  for (let step = 0; version !== PROJECT_SCHEMA_VERSION; step += 1) {
    if (step >= MAX_MIGRATION_STEPS || visited.has(version)) {
      throw new EngineError(ERROR_CODES.MIGRATION_FAILED, "Project migration chain is cyclic or too long.", {
        details: { schemaVersion: version }
      });
    }
    visited.add(version);

    const migration = migrations.find((candidate) => candidate.fromVersion === version);
    if (migration === undefined) {
      throw new EngineError(
        ERROR_CODES.UNSUPPORTED_SCHEMA_VERSION,
        `No migration is registered from project schema ${version}.`,
        { details: { schemaVersion: version, targetVersion: PROJECT_SCHEMA_VERSION } }
      );
    }

    let migrationResult: unknown;
    try {
      migrationResult = migration.migrate(project);
    } catch (cause) {
      throw new EngineError(ERROR_CODES.MIGRATION_FAILED, `Migration from ${version} failed.`, {
        cause,
        details: { fromVersion: version, toVersion: migration.toVersion }
      });
    }

    if (!isJsonObject(migrationResult)) {
      throw new EngineError(ERROR_CODES.MIGRATION_FAILED, "Migration must return a JSON object.", {
        details: {
          fromVersion: version,
          toVersion: migration.toVersion,
          resultType: Array.isArray(migrationResult) ? "array" : typeof migrationResult
        }
      });
    }

    project = migrationResult;
    const actualVersion = project.schemaVersion;
    if (typeof actualVersion !== "string") {
      throw new EngineError(ERROR_CODES.MIGRATION_FAILED, "Migration result must contain a string schemaVersion.", {
        details: { fromVersion: version, toVersion: migration.toVersion }
      });
    }
    if (actualVersion !== migration.toVersion) {
      throw new EngineError(ERROR_CODES.MIGRATION_FAILED, "Migration returned an unexpected schema version.", {
        details: {
          fromVersion: version,
          declaredVersion: migration.toVersion,
          actualVersion
        }
      });
    }
    version = actualVersion;
  }

  return project;
}

function parseProjectInput(input: string | unknown, maxInputBytes: number): unknown {
  if (typeof input !== "string") {
    return input;
  }

  const inputBytes = new TextEncoder().encode(input).byteLength;
  if (inputBytes > maxInputBytes) {
    throw new EngineError(ERROR_CODES.INPUT_TOO_LARGE, "Project JSON exceeds the configured input limit.", {
      details: { inputBytes, maxInputBytes }
    });
  }

  try {
    return JSON.parse(input) as unknown;
  } catch (cause) {
    throw new EngineError(ERROR_CODES.PARSE_ERROR, "Project JSON could not be parsed.", { cause });
  }
}

export function loadProject(input: string | unknown, options: LoadProjectOptions = {}): MotionProject {
  const logger = options.logger ?? NOOP_LOGGER;
  const parsed = parseProjectInput(input, options.maxInputBytes ?? DEFAULT_MAX_PROJECT_BYTES);
  if (!isJsonObject(parsed)) {
    throw new EngineError(ERROR_CODES.SCHEMA_INVALID, "Project input must be a JSON object.");
  }

  const migrations = options.migrations === undefined
    ? BUILT_IN_PROJECT_MIGRATIONS
    : [...options.migrations, ...BUILT_IN_PROJECT_MIGRATIONS];
  const migrated = migrateProject(parsed, migrations);
  const result = validateContract("MotionProject", migrated);
  if (!result.valid) {
    logger.log("error", ERROR_CODES.SCHEMA_INVALID, "Project schema validation failed.", validationDetails(result.issues));
    throw new EngineError(ERROR_CODES.SCHEMA_INVALID, "Project schema validation failed.", {
      details: validationDetails(result.issues)
    });
  }

  logger.log("info", "CMFX_PROJECT_LOADED", "Project loaded.", {
    projectId: result.value.id,
    schemaVersion: result.value.schemaVersion
  });
  return result.value;
}

function stableValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (isJsonObject(value)) {
    // A null prototype preserves JSON keys such as "__proto__" as ordinary own properties.
    const sorted = Object.create(null) as JsonObject;
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child !== undefined) {
        sorted[key] = stableValue(child);
      }
    }
    return sorted;
  }
  return value;
}

export function saveProject(project: MotionProject, options: SaveProjectOptions = {}): string {
  const result = validateContract("MotionProject", project);
  if (!result.valid) {
    throw new EngineError(ERROR_CODES.SCHEMA_INVALID, "Cannot save an invalid project.", {
      details: validationDetails(result.issues)
    });
  }

  const space = options.space ?? 2;
  if (!Number.isInteger(space) || space < 0 || space > 10) {
    throw new RangeError("space must be an integer from 0 to 10.");
  }

  const output = `${JSON.stringify(stableValue(project as unknown as JsonValue), null, space)}\n`;
  (options.logger ?? NOOP_LOGGER).log("info", "CMFX_PROJECT_SAVED", "Project serialized.", {
    projectId: project.id,
    schemaVersion: project.schemaVersion,
    outputBytes: new TextEncoder().encode(output).byteLength
  });
  return output;
}
