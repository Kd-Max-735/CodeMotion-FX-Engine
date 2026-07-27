import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import type {
  Animatable,
  CompositionDefinition,
  EffectDefinition,
  EffectGraphDefinition,
  EffectInstance,
  JsonObject,
  Keyframe,
  LayerDefinition,
  MotionProject
} from "@codemotion/core";
import contractSchemaJson from "./contracts.schema.json" with { type: "json" };

export const CONTRACT_SCHEMA_ID = "https://schemas.codemotion.dev/contracts/v1.2/contracts.schema.json";

export const CONTRACT_SCHEMA_IDS = Object.freeze({
  MotionProject: `${CONTRACT_SCHEMA_ID}#/$defs/MotionProject`,
  CompositionDefinition: `${CONTRACT_SCHEMA_ID}#/$defs/CompositionDefinition`,
  LayerDefinition: `${CONTRACT_SCHEMA_ID}#/$defs/LayerDefinition`,
  Animatable: `${CONTRACT_SCHEMA_ID}#/$defs/Animatable`,
  Keyframe: `${CONTRACT_SCHEMA_ID}#/$defs/Keyframe`,
  EffectInstance: `${CONTRACT_SCHEMA_ID}#/$defs/EffectInstance`,
  EffectGraphDefinition: `${CONTRACT_SCHEMA_ID}#/$defs/EffectGraphDefinition`,
  EffectDefinition: `${CONTRACT_SCHEMA_ID}#/$defs/EffectDefinition`
});

export type ContractName = keyof typeof CONTRACT_SCHEMA_IDS;

export interface ContractTypeMap {
  MotionProject: MotionProject;
  CompositionDefinition: CompositionDefinition;
  LayerDefinition: LayerDefinition;
  Animatable: Animatable;
  Keyframe: Keyframe;
  EffectInstance: EffectInstance;
  EffectGraphDefinition: EffectGraphDefinition;
  EffectDefinition: EffectDefinition;
}

export interface ValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string;
  params: JsonObject;
}

export type ValidationResult<T> =
  | { valid: true; value: T; issues: [] }
  | { valid: false; issues: ValidationIssue[] };

export const contractsSchema: Readonly<JsonObject> = contractSchemaJson as JsonObject;

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(contractSchemaJson, CONTRACT_SCHEMA_ID);

const validators = Object.fromEntries(
  Object.entries(CONTRACT_SCHEMA_IDS).map(([name, schemaId]) => [name, ajv.compile({ $ref: schemaId })])
) as Record<ContractName, ValidateFunction>;

function toIssue(error: ErrorObject): ValidationIssue {
  return {
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? "Schema validation failed.",
    params: error.params as JsonObject
  };
}

export function validateContract<TName extends ContractName>(
  name: TName,
  value: unknown
): ValidationResult<ContractTypeMap[TName]> {
  const validator = validators[name];
  if (validator(value)) {
    return { valid: true, value: value as ContractTypeMap[TName], issues: [] };
  }
  return { valid: false, issues: (validator.errors ?? []).map(toIssue) };
}

export function isMotionProject(value: unknown): value is MotionProject {
  return validators.MotionProject(value) as boolean;
}
