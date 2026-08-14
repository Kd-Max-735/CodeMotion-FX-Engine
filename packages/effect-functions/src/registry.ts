import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "./types.js";
import { assertEffectToolDefinition } from "./validation.js";
import { BATCH_01_DEFINITIONS } from "./batches/batch-01/index.js";
import { BATCH_02_DEFINITIONS } from "./batches/batch-02/index.js";
import { BATCH_03_DEFINITIONS } from "./batches/batch-03/index.js";
import { BATCH_04_DEFINITIONS } from "./batches/batch-04/index.js";
import { BATCH_05_DEFINITIONS } from "./batches/batch-05/index.js";
import { BATCH_06_DEFINITIONS } from "./batches/batch-06/index.js";
import { BATCH_07_DEFINITIONS } from "./batches/batch-07/index.js";
import { BATCH_08_DEFINITIONS } from "./batches/batch-08/index.js";
import { EXISTING_EFFECT_TOOL_DEFINITIONS } from "./existing-adapters.js";

export class EffectToolRegistry {
  readonly #byToolName = new Map<string, EffectToolDefinition>();
  readonly #byEffectId = new Map<string, EffectToolDefinition>();

  public constructor(definitions: readonly EffectToolDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  public register<
    Params extends JsonObject,
    Inputs extends AuthorizedEffectInputs,
    Output
  >(definition: EffectToolDefinition<Params, Inputs, Output>): void {
    assertEffectToolDefinition(definition);
    if (this.#byToolName.has(definition.toolName) || this.#byEffectId.has(definition.effectId)) {
      throw new TypeError(`Duplicate effect tool identity: ${definition.toolName}.`);
    }
    this.#byToolName.set(definition.toolName, definition as EffectToolDefinition);
    this.#byEffectId.set(definition.effectId, definition as EffectToolDefinition);
  }

  public getByToolName(toolName: string): EffectToolDefinition | undefined {
    return this.#byToolName.get(toolName);
  }

  public getByEffectId(effectId: string): EffectToolDefinition | undefined {
    return this.#byEffectId.get(effectId);
  }

  public list(): readonly EffectToolDefinition[] {
    return Object.freeze([...this.#byToolName.values()]);
  }
}

export const NEW_EFFECT_TOOL_DEFINITIONS: readonly EffectToolDefinition[] = Object.freeze([
  ...BATCH_01_DEFINITIONS,
  ...BATCH_02_DEFINITIONS,
  ...BATCH_03_DEFINITIONS,
  ...BATCH_04_DEFINITIONS,
  ...BATCH_05_DEFINITIONS,
  ...BATCH_06_DEFINITIONS,
  ...BATCH_07_DEFINITIONS,
  ...BATCH_08_DEFINITIONS
]);

export const ALL_EFFECT_TOOL_DEFINITIONS: readonly EffectToolDefinition[] = Object.freeze([
  ...EXISTING_EFFECT_TOOL_DEFINITIONS,
  ...NEW_EFFECT_TOOL_DEFINITIONS
]);

export function createEffectToolRegistry(): EffectToolRegistry {
  return new EffectToolRegistry(ALL_EFFECT_TOOL_DEFINITIONS);
}

export const EFFECT_TOOL_REGISTRY = createEffectToolRegistry();
