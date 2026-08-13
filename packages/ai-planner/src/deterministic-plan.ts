import { P0_EFFECTS_BY_ID, effectCardForEffectId, extractExplicitAddedText } from "@codemotion/effects-2d";
import type {
  ModelIntentDto,
  ModelStoryboard,
  NormalizedUnderstanding,
  PlanningContext,
  UnderstandingRequest
} from "./provider.js";
import { ProviderError } from "./provider.js";
import { intentTargetKind } from "./intent-planning.js";
import { sanitizeUserText } from "./security.js";

export interface DeterministicPlanStructure {
  readonly understanding: NormalizedUnderstanding;
  readonly storyboard: ModelStoryboard;
}

function visualResources(request: UnderstandingRequest) {
  return (request.resources ?? []).filter((resource): resource is typeof resource & {
    readonly modality: "image" | "video";
  } => resource.modality === "image" || resource.modality === "video");
}

function addedTextFor(request: UnderstandingRequest, intent: ModelIntentDto): string | null {
  const expected = extractExplicitAddedText(request.prompt)
    ?? request.planning?.brand.requiredText.find((text) => text.trim().length > 0)
    ?? null;
  if (intentTargetKind(intent.effectId) !== "added-text") return null;
  if (expected === null || intent.addedText !== expected) {
    throw new ProviderError("provider_response", "Model did not preserve the explicit new text.", {
      retryable: true,
      reason: "TEXT_REQUIRED"
    });
  }
  return expected;
}

export function buildDeterministicPlanStructure(
  request: UnderstandingRequest,
  planning: PlanningContext,
  intent: ModelIntentDto
): DeterministicPlanStructure {
  const definition = P0_EFFECTS_BY_ID.get(intent.effectId);
  const card = effectCardForEffectId(intent.effectId);
  if (definition === undefined || card === undefined) {
    throw new ProviderError("provider_response", "Model selected an unavailable effect.", {
      retryable: true,
      reason: "EFFECT_ID_INVALID"
    });
  }
  const visuals = visualResources(request);
  const expectedVisualCount = card.fixture.secondaryInput ? 2 : 1;
  const lowLevelFixtureWithoutVisual = visuals.length === 0
    && (definition.category === "motion" || definition.category === "vector"
      || definition.category === "draw" || intentTargetKind(intent.effectId) === "added-text");
  if (!lowLevelFixtureWithoutVisual && visuals.length !== expectedVisualCount) {
    throw new ProviderError("invalid_input", "Effect is incompatible with the verified visual asset count.", {
      reason: "ASSET_COUNT_INCOMPATIBLE"
    });
  }
  const targetKind = intentTargetKind(intent.effectId);
  if (intent.targetKind !== targetKind) {
    throw new ProviderError("provider_response", "Model returned an incompatible target kind.", {
      retryable: true,
      reason: targetKind === "added-text" ? "TEXT_REQUIRED" : "SCHEMA_INVALID"
    });
  }
  const addedText = addedTextFor(request, intent);
  if (targetKind === "visual" && intent.addedText !== null) {
    throw new ProviderError("provider_response", "Model added text that was not requested.", {
      retryable: true,
      reason: "SCHEMA_INVALID"
    });
  }

  const visualLayers: ModelStoryboard["layers"] = visuals.map((resource, index) => ({
    id: `layer_visual_${index + 1}`,
    type: resource.modality,
    localAssetId: resource.localAssetId,
    description: `${resource.modality === "video" ? "视频素材" : resource.modality === "image" ? "图片素材" : "音频素材"} ${index + 1}`
  }));
  const textLayers: ModelStoryboard["layers"] = [];
  if (addedText !== null) {
    textLayers.push({
      id: "layer_added_text",
      type: "text",
      text: addedText,
      description: "用户指定文字"
    });
  }
  const fixtureLayers: ModelStoryboard["layers"] = [];
  if (lowLevelFixtureWithoutVisual && textLayers.length === 0) {
    fixtureLayers.push({
      id: "layer_provider_fixture",
      type: "svg",
      description: "系统图形素材"
    });
  }
  for (const requiredText of planning.brand.requiredText) {
    if (requiredText.trim().length === 0
      || textLayers.some((layer) => layer.type === "text" && layer.text.includes(requiredText))) continue;
    textLayers.push({
      id: `layer_brand_text_${textLayers.length + 1}`,
      type: "text",
      text: requiredText,
      description: "品牌必需文字"
    });
  }
  const layers = [...visualLayers, ...textLayers, ...fixtureLayers];
  const targetLayer = targetKind === "added-text"
    ? layers.find((layer) => layer.id === "layer_added_text")
    : visualLayers[0] ?? (lowLevelFixtureWithoutVisual ? fixtureLayers[0] : undefined);
  if (targetLayer === undefined) {
    throw new ProviderError("invalid_input", "No authoritative target layer could be constructed.", {
      reason: targetKind === "added-text" ? "TEXT_REQUIRED" : "ASSET_COUNT_INCOMPATIBLE"
    });
  }

  const safePrompt = sanitizeUserText(request.prompt);
  const safeSummary = intent.summary === undefined ? undefined : sanitizeUserText(intent.summary);
  const understanding: NormalizedUnderstanding = {
    text: {
      requirements: [safePrompt],
      constraints: [
        `one-effect:${definition.effectId}`,
        `target:${targetKind}`,
        `verified-visual-count:${visuals.length}`
      ]
    },
    images: (request.resources ?? []).filter((resource) => resource.modality === "image").map((resource) => ({
      localAssetId: resource.localAssetId,
      subjects: [],
      composition: "verified user image",
      ocr: [],
      colors: [],
      style: []
    })),
    audio: (request.resources ?? []).filter((resource) => resource.modality === "audio").map((resource) => ({
      localAssetId: resource.localAssetId,
      transcript: "",
      speakers: [],
      emotion: [],
      bgm: "verified background audio",
      rhythm: "",
      soundEffects: []
    })),
    video: (request.resources ?? []).filter((resource) => resource.modality === "video").map((resource) => ({
      localAssetId: resource.localAssetId,
      shots: [{
        range: {
          start: 0,
          end: Math.min(planning.durationSeconds, Number(resource.asset.metadata.duration ?? planning.durationSeconds))
        },
        action: "verified source video",
        event: "single authoritative shot",
        onScreenText: [],
        audioVisualRelation: "preserve source relationship"
      }]
    })),
    confidence: 1,
    risks: []
  };
  const storyboard: ModelStoryboard = {
    intent: safeSummary || safePrompt,
    duration: planning.durationSeconds,
    width: planning.width,
    height: planning.height,
    fps: planning.fps,
    style: [...planning.style],
    brand: structuredClone(planning.brand),
    layers,
    shots: [{
      id: "shot_main",
      start: 0,
      end: planning.durationSeconds,
      description: `Server-authored ${definition.displayName} shot`,
      layerIds: layers.map((layer) => layer.id),
      effects: [{
        sourceId: definition.sourceId,
        effectId: definition.effectId,
        effectVersion: definition.version,
        targetLayerId: targetLayer.id
      }]
    }]
  };
  return { understanding, storyboard };
}
