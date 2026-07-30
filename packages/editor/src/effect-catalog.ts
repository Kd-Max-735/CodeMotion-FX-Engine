import type { Animatable, EffectDefinition, EffectInstance, JsonObject, JsonValue, MotionProject } from "@codemotion/core";
import { P0_EFFECTS, P0_EFFECTS_BY_ID, type P0CatalogEffectDefinition } from "@codemotion/effects-2d";

export interface EffectParameterField {
  readonly name: string;
  readonly label: string;
  readonly control: "number" | "select" | "toggle" | "text" | "color" | "resource" | "vector2";
  readonly type: "number" | "string" | "boolean" | "array";
  readonly minimum?: number;
  readonly maximum?: number;
  readonly step?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly options?: readonly JsonValue[];
  readonly keyframeable: boolean;
  readonly unit?: string;
}

export const P0_EDITOR_EFFECTS = P0_EFFECTS;

export function effectDefinition(effectId: string): P0CatalogEffectDefinition {
  const definition = P0_EFFECTS_BY_ID.get(effectId);
  if (definition === undefined) throw new RangeError(`Unknown P0 effect ${effectId}.`);
  return definition;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function schemaProperties(definition: EffectDefinition): Record<string, Record<string, unknown>> {
  const properties = record(record(definition.parameterSchema).properties);
  return Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, record(value)]));
}

function uiFields(definition: EffectDefinition): Record<string, Record<string, unknown>> {
  const fields = record(definition.uiSchema.fields);
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, record(value)]));
}

function controlFor(name: string, schema: Record<string, unknown>, ui: Record<string, unknown>): EffectParameterField["control"] {
  const declared = ui.control;
  if (declared === "slider" || declared === "number") return "number";
  if (declared === "select") return "select";
  if (declared === "toggle") return "toggle";
  if (declared === "vector2") return "vector2";
  if (declared === "color" || schema.format === "color" || /color/i.test(name)) return "color";
  if (declared === "resource" || schema.format === "asset-reference" || /(?:asset|texture|resource)/i.test(name)) {
    return "resource";
  }
  if (schema.type === "number" || schema.type === "integer") return "number";
  if (schema.type === "boolean") return "toggle";
  if (Array.isArray(schema.enum)) return "select";
  if (schema.type === "array") return "vector2";
  return "text";
}

export function effectParameterFields(definition: EffectDefinition): readonly EffectParameterField[] {
  const properties = schemaProperties(definition);
  const fields = uiFields(definition);
  const declaredOrder = Array.isArray(definition.uiSchema.order)
    ? definition.uiSchema.order.filter((value): value is string => typeof value === "string")
    : Object.keys(properties);
  return declaredOrder.map((name) => {
    const schema = properties[name] ?? {};
    const ui = fields[name] ?? {};
    const rawType = schema.type;
    const type: EffectParameterField["type"] =
      rawType === "number" || rawType === "integer" || rawType === "boolean" || rawType === "array"
        ? rawType === "integer" ? "number" : rawType
        : "string";
    return {
      name,
      label: typeof ui.label === "string" ? ui.label : name,
      control: controlFor(name, schema, ui),
      type,
      ...(typeof schema.minimum === "number" ? { minimum: schema.minimum } : {}),
      ...(typeof schema.maximum === "number" ? { maximum: schema.maximum } : {}),
      ...(typeof schema.multipleOf === "number" ? { step: schema.multipleOf } : {}),
      ...(typeof schema.minLength === "number" ? { minLength: schema.minLength } : {}),
      ...(typeof schema.maxLength === "number" ? { maxLength: schema.maxLength } : {}),
      ...(Array.isArray(schema.enum) ? { options: schema.enum as JsonValue[] } : {}),
      keyframeable: definition.supportsKeyframes && ui.keyframeable === true,
      ...(typeof ui.unit === "string" ? { unit: ui.unit } : {})
    };
  });
}

function constant(value: JsonValue): Animatable {
  return { mode: "constant", value };
}

export function createP0EffectInstance(
  effectId: string,
  presetIndex = 1,
  instanceId = `effect.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`
): EffectInstance {
  const definition = effectDefinition(effectId);
  const preset = definition.presets[Math.max(0, Math.min(2, presetIndex))]!;
  const keyframeable = new Set(
    effectParameterFields(definition).filter((field) => field.keyframeable).map((field) => field.name)
  );
  return {
    id: instanceId,
    effectId,
    version: definition.version,
    enabled: true,
    mix: { mode: "constant", value: 1 },
    params: Object.fromEntries(Object.entries(preset.params).map(([name, value]) => [
      name,
      keyframeable.has(name) ? constant(structuredClone(value)) : structuredClone(value)
    ])),
    cachePolicy: "frame"
  };
}

export function presetParams(effectId: string, presetIndex: number): JsonObject {
  return structuredClone(effectDefinition(effectId).presets[Math.max(0, Math.min(2, presetIndex))]!.params);
}

export function projectResourceIds(project: MotionProject): readonly string[] {
  const ids = project.assets.map((asset) => asset.id);
  if (!ids.includes("builtin://brush/round")) ids.unshift("builtin://brush/round");
  return ids;
}
