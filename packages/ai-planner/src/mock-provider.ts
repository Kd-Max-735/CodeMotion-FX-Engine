import { createHash } from "node:crypto";
import {
  ARK_V1_MODEL,
  type ModelProvider,
  type NormalizedUnderstanding,
  type UnderstandingRequest,
  type UnderstandingResult
} from "./provider.js";
import { sanitizeUserText } from "./security.js";
import { fingerprintProviderRequestId } from "./security.js";

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
      understanding,
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
