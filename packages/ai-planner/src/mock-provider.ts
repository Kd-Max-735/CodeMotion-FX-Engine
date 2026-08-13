import { createHash } from "node:crypto";
import {
  ARK_V1_MODEL,
  type ModelProvider,
  type PlanningContext,
  type UnderstandingRequest,
  type UnderstandingResult
} from "./provider.js";
import { buildDeterministicPlanStructure } from "./deterministic-plan.js";
import { intentTargetKind, resolveIntentCandidates } from "./intent-planning.js";
import { fingerprintProviderRequestId } from "./security.js";

function planningContext(request: UnderstandingRequest): PlanningContext {
  return request.planning ?? {
    width: 1280,
    height: 720,
    fps: 24,
    durationSeconds: 6,
    style: [],
    brand: { colors: [], tone: [], requiredText: [], forbiddenContent: [], logoAssetIds: [] }
  };
}

function mockEffectId(prompt: string, candidates: ReturnType<typeof resolveIntentCandidates>): string {
  const normalized = prompt.toLocaleLowerCase();
  const preferred = /(?:\bslide\b|\bui\b|walkthrough|vertical|social)/u.test(normalized)
    ? "fx.motion.slide"
    : undefined;
  return candidates.definitions.find((definition) => definition.effectId === preferred)?.effectId
    ?? candidates.definitions[0]!.effectId;
}

export class OfflineMockProvider implements ModelProvider {
  readonly id = "offline-mock";

  async understand(request: UnderstandingRequest): Promise<UnderstandingResult> {
    request.signal?.throwIfAborted();
    const resources = request.resources ?? [];
    const planning = planningContext(request);
    const candidates = resolveIntentCandidates(request.prompt, resources, planning, true);
    const effectId = mockEffectId(request.prompt, candidates);
    const structure = buildDeterministicPlanStructure(request, planning, {
      effectId,
      targetKind: intentTargetKind(effectId),
      addedText: intentTargetKind(effectId) === "added-text" ? candidates.expectedAddedText : null,
      summary: "offline regression intent"
    });
    const inputHash = createHash("sha256").update(request.prompt)
      .update(resources.map((item) => `${item.localAssetId}:${item.asset.hash ?? ""}`).sort().join("|"))
      .digest("hex");
    return {
      contract: "ai-task/v1",
      understanding: structure.understanding,
      storyboard: structure.storyboard,
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
