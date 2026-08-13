import {
  P0_EFFECTS_BY_ID,
  V22_SAMPLE_EFFECT_CARDS,
  effectCardForEffectId,
  explicitEffectCardRequests,
  extractExplicitAddedText,
  type P0CatalogEffectDefinition
} from "@codemotion/effects-2d";
import type { LocalResourceInput, PlanningContext } from "./provider.js";
import { ProviderError } from "./provider.js";

export interface IntentCandidateSet {
  readonly definitions: readonly P0CatalogEffectDefinition[];
  readonly expectedAddedText: string | null;
}

function requiredVisualCount(effectId: string): 1 | 2 {
  const card = effectCardForEffectId(effectId);
  if (card === undefined) throw new ProviderError("unsupported", "Effect is not available in the P0 card planner.");
  return card.fixture.secondaryInput ? 2 : 1;
}

function isTextEffect(effectId: string): boolean {
  return effectCardForEffectId(effectId)?.fixture.inputKind === "text";
}

function eligibleDefinitions(allowVerifiedSampleCards: boolean): readonly P0CatalogEffectDefinition[] {
  return V22_SAMPLE_EFFECT_CARDS.flatMap((card) => {
    const allowed = card.status === "published"
      || allowVerifiedSampleCards && card.status === "verified" && card.acceptanceState === "pending-human";
    const definition = P0_EFFECTS_BY_ID.get(card.effectId);
    return allowed && definition ? [definition] : [];
  });
}

export function resolveIntentCandidates(
  prompt: string,
  resources: readonly LocalResourceInput[],
  planning: PlanningContext,
  allowVerifiedSampleCards: boolean
): IntentCandidateSet {
  const explicitCards = explicitEffectCardRequests(prompt);
  if (explicitCards.length > 1) {
    throw new ProviderError("invalid_input", "The request explicitly names more than one effect.");
  }
  if (planning.selectedEffectId !== undefined
    && explicitCards.some((card) => card.effectId !== planning.selectedEffectId)) {
    throw new ProviderError("invalid_input", "The selected effect conflicts with the explicit prompt effect.");
  }

  const visualCount = resources.filter((resource) =>
    resource.modality === "image" || resource.modality === "video").length;
  const expectedAddedText = extractExplicitAddedText(prompt)
    ?? planning.brand.requiredText.find((text) => text.trim().length > 0)
    ?? null;
  const hardEffectId = planning.selectedEffectId ?? explicitCards[0]?.effectId;
  const eligible = eligibleDefinitions(allowVerifiedSampleCards);
  const scoped = hardEffectId === undefined
    ? eligible
    : eligible.filter((definition) => definition.effectId === hardEffectId);

  if (hardEffectId !== undefined && scoped.length === 0) {
    throw new ProviderError("unsupported", "The requested effect is not available in the P0 planning release.");
  }
  if (hardEffectId !== undefined && visualCount !== 0 && visualCount !== requiredVisualCount(hardEffectId)) {
    throw new ProviderError("invalid_input", "The requested effect is incompatible with the visual asset count.", {
      reason: "ASSET_COUNT_INCOMPATIBLE"
    });
  }
  if (hardEffectId !== undefined && isTextEffect(hardEffectId) && expectedAddedText === null) {
    throw new ProviderError("invalid_input", "The requested text effect requires explicit new text.", {
      reason: "TEXT_REQUIRED"
    });
  }

  const definitions = scoped.filter((definition) =>
    (visualCount === 0
      ? hardEffectId !== undefined || definition.effectId === "fx.motion.fade" || definition.effectId === "fx.motion.slide"
        || isTextEffect(definition.effectId)
      : visualCount === requiredVisualCount(definition.effectId))
      && (!isTextEffect(definition.effectId) || expectedAddedText !== null));
  if (definitions.length === 0) {
    throw new ProviderError("invalid_input", "No P0 card effect is compatible with the verified inputs.", {
      reason: visualCount === 1 || visualCount === 2
        ? "TEXT_REQUIRED"
        : "ASSET_COUNT_INCOMPATIBLE"
    });
  }
  return Object.freeze({
    definitions: Object.freeze([...definitions]),
    expectedAddedText
  });
}

export function intentTargetKind(effectId: string): "visual" | "added-text" {
  return isTextEffect(effectId) ? "added-text" : "visual";
}
