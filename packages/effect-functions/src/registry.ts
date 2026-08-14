import type { JsonObject } from "@codemotion/core";
import type { AuthorizedEffectInputs, EffectToolDefinition } from "./types.js";
import { assertEffectToolDefinition } from "./validation.js";

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

/**
 * Intentionally empty. Batch implementations are registered only after their
 * files exist and pass the contract gate; no placeholder batch is imported.
 */
export const EFFECT_TOOL_REGISTRY = new EffectToolRegistry();
