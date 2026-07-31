import { createHash } from "node:crypto";
import type { JsonObject } from "@codemotion/core";
import { P0_EFFECTS_BY_ID } from "@codemotion/effects-2d";
import {
  ARK_V1_MODEL,
  type ModelStoryboard,
  type ModelProvider,
  type NormalizedUnderstanding,
  type UnderstandingRequest,
  type UnderstandingResult
} from "./provider.js";
import { sanitizeUserText } from "./security.js";
import { fingerprintProviderRequestId } from "./security.js";

function mockEffect(prompt: string): { effectId: string; params: JsonObject } {
  const value = prompt.toLowerCase();
  if (/(3d|extrud)/.test(value)) return { effectId: "fx.text.textExtrude3D", params: { depth: 0.32 } };
  if (/(kinetic|music|rhythm|beat)/.test(value)) return { effectId: "fx.text.kineticTypography", params: { strength: 0.72 } };
  if (/(logo|callout|feature)/.test(value)) return { effectId: "fx.motion.scalePop", params: { spring: 0.9 } };
  if (/(data|chart)/.test(value)) return { effectId: "fx.vector.radialBurst", params: { count: 36 } };
  if (/(ui|walkthrough|vertical|social)/.test(value)) return { effectId: "fx.motion.slide", params: { direction: "up" } };
  if (/(transition|scene)/.test(value)) return { effectId: "fx.text.textMorph", params: { progress: 0.68 } };
  if (/(glitch|decode|scramble)/.test(value)) return { effectId: "fx.text.scrambleDecode", params: { speed: 48 } };
  if (/(ink|brush|handwrit)/.test(value)) return { effectId: "fx.draw.inkSpread", params: { diffusion: 0.74 } };
  return { effectId: "fx.text.typewriter", params: { speed: 18 } };
}

function mockStoryboard(request: UnderstandingRequest): ModelStoryboard {
  const resources = request.resources ?? [];
  const selected = mockEffect(request.prompt);
  const definition = P0_EFFECTS_BY_ID.get(selected.effectId);
  if (definition === undefined) throw new Error(`Offline mock effect ${selected.effectId} is not in P0.`);
  const planning = request.planning ?? {
    width: 1280,
    height: 720,
    fps: 24,
    durationSeconds: 6,
    style: [],
    brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  };
  const layers: ModelStoryboard["layers"] = resources.flatMap((item) => item.modality === "audio" ? [] : [{
      id: `layer_${item.localAssetId.slice(6)}`,
      type: item.modality,
      localAssetId: item.localAssetId,
      description: `Model-planned ${item.modality} layer`
    }]);
  const needsVector = definition.category === "vector" || definition.category === "draw";
  const target = needsVector
    ? { id: "layer_vector", type: "svg" as const, description: "Model-planned vector layer" }
    : {
      id: "layer_title",
      type: "text" as const,
      description: "Model-planned title layer",
      text: sanitizeUserText(request.prompt)
    };
  layers.push(target);
  return {
    intent: sanitizeUserText(request.prompt),
    duration: planning.durationSeconds,
    width: planning.width,
    height: planning.height,
    fps: planning.fps,
    style: [...planning.style],
    brand: structuredClone(planning.brand),
    layers,
    shots: [{
      id: "shot_1",
      start: 0,
      end: planning.durationSeconds,
      description: `Model-planned ${definition.category} shot`,
      layerIds: layers.map((layer) => layer.id),
      effects: [{
        sourceId: definition.sourceId,
        effectId: definition.effectId,
        effectVersion: definition.version,
        targetLayerId: target.id,
        params: selected.params
      }]
    }]
  };
}

export class OfflineMockProvider implements ModelProvider {
  readonly id = "offline-mock";

  async understand(request: UnderstandingRequest): Promise<UnderstandingResult> {
    request.signal?.throwIfAborted();
    const resources = request.resources ?? [];
    const understanding: NormalizedUnderstanding = {
      text: { requirements: [sanitizeUserText(request.prompt)], constraints: ["offline-regression-only"] },
      images: resources.filter((item) => item.modality === "image").map((item) => ({
        localAssetId: item.localAssetId,
        subjects: ["fixture"],
        composition: "centered",
        ocr: [],
        colors: ["#336699"],
        style: ["test"]
      })),
      audio: resources.filter((item) => item.modality === "audio").map((item) => ({
        localAssetId: item.localAssetId,
        transcript: "offline fixture",
        speakers: ["speaker-1"],
        emotion: ["neutral"],
        bgm: "none",
        rhythm: "steady",
        soundEffects: []
      })),
      video: resources.filter((item) => item.modality === "video").map((item) => ({
        localAssetId: item.localAssetId,
        shots: [{
          range: { start: 0, end: Math.max(0.1, Number(item.asset.metadata.duration ?? 1)) },
          action: "fixture motion",
          event: "fixture event",
          onScreenText: [],
          audioVisualRelation: "unknown"
        }]
      })),
      confidence: 1,
      risks: ["mock result; not real connectivity evidence"]
    };
    const inputHash = createHash("sha256").update(request.prompt)
      .update(resources.map((item) => `${item.localAssetId}:${item.asset.hash ?? ""}`).sort().join("|"))
      .digest("hex");
    return {
      contract: "ai-task/v1",
      understanding,
      storyboard: mockStoryboard(request),
      trace: {
        provider: this.id,
        modelId: ARK_V1_MODEL,
        requestFingerprint: fingerprintProviderRequestId("offline-mock-request"),
        inputHash: `sha256:${inputHash}`,
        latencyMs: 0,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCostCny: {
            lowerBound: 0,
            upperBound: 0,
            pricingSource: "offline-mock",
            note: "Mock calls have no provider cost."
          }
        }
      }
    };
  }
}
