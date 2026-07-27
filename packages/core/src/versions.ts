export const ENGINE_VERSION = "0.3.0" as const;
export const PROJECT_SCHEMA_VERSION = "1.2.0" as const;
export const EFFECT_DEFINITION_SCHEMA_VERSION = "1.0.0" as const;
export const RENDERER_API_VERSION = "1.1.0" as const;

export const CONTRACT_VERSIONS = Object.freeze({
  engine: ENGINE_VERSION,
  projectSchema: PROJECT_SCHEMA_VERSION,
  effectDefinitionSchema: EFFECT_DEFINITION_SCHEMA_VERSION,
  rendererApi: RENDERER_API_VERSION
});

export type SemVer = `${number}.${number}.${number}`;

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isSemVer(value: unknown): value is SemVer {
  return typeof value === "string" && SEMVER_PATTERN.test(value);
}
