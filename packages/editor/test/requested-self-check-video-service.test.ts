import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EFFECT_TOOL_REGISTRY, type EffectParameterEnvelope } from "@codemotion/effect-functions";
import type { ExportOptions, VerifiedStoredMedia } from "@codemotion/exporter";
import { EffectToolVideoService } from "../src/effect-tool-video-service.js";

const TOOLS = Object.freeze([
  "chromatic_aberration", "color_grade", "film_grain", "gaussian_blur", "directional_blur",
  "motion_blur", "radial_blur", "rgb_split", "texture_overlay", "track_matte"
]);

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Self-check did not complete within the deterministic turn budget.");
}

describe("requested visual self-check video wiring", () => {
  it("runs every requested self-check only after its final MP4 render and carries the original request", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "cmfx-requested-wiring-"));
    const media: VerifiedStoredMedia = {
      asset: { id: "asset_imageabcdefgh", type: "image", uri: "media://source.png", hash: "sha256:test",
        metadata: { mime: "image/png", width: 2, height: 2, codec: "png" } },
      descriptor: { id: "asset_imageabcdefgh", type: "media/image", cacheKey: "test", metadata: {} },
      storedPath: join(outputRoot, "source.png"),
      arkEligibility: { filesApi: false, videoTos: false, base64OrUrl: false, reason: "test" },
      trustedBytes: 64
    };
    const exportFrames = vi.fn(async (options: ExportOptions) => {
      await writeFile(options.outputPath, "mp4");
      return { outputPath: options.outputPath, frameCount: 1, inspections: [], encoder: "libx264" };
    });
    const runner = vi.fn(async (toolName: string, request: { videoPath: string; baselineVideoPath: string;
      outputDirectory: string; userRequest: string }) => {
      await access(request.videoPath);
      await access(request.baselineVideoPath);
      const evidencePath = join(request.outputDirectory, "service-keyframe-contact-sheet.png");
      await writeFile(evidencePath, "png");
      return {
        view: { status: "pass" as const, automatic: true as const, toolName,
          ruleVersion: "1.0.0" as const, evidenceContractVersion: "1.0.0" as const,
          evidenceStatus: "sufficient" as const,
          macroView: { file_name: "film.mp4", original_request: request.userRequest,
            summary: { description: "实际颗粒可见。" }, metadata: { effect: { grain_visibility: "明显" } } },
          evidenceImages: [{ evidenceId: "keyframe_contact_sheet" as const, label: "最终 MP4 关键帧合成图",
            mime: "image/png" as const, width: 2, height: 2 }] },
        evidenceFiles: new Map([["keyframe_contact_sheet", evidencePath]])
      };
    });
    const service = new EffectToolVideoService({
      media: { resolve: vi.fn(async () => media) }, outputRoot,
      exportFrames: exportFrames as never,
      decodeFrame: vi.fn(async () => new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255,
        0, 0, 255, 255, 255, 255, 255, 255])) as never,
      durationSeconds: 1 / 30, fps: 30,
      gpuSampler: vi.fn(async () => ({ name: "Test GPU", memoryUsedMiB: 1,
        memoryTotalMiB: 2, utilizationPercent: 1 })),
      requestedSelfCheckRunner: runner as never
    });
    for (const toolName of TOOLS) {
      const definition = EFFECT_TOOL_REGISTRY.getByToolName(toolName)!;
      const prompt = `验证 ${toolName} 的实际视觉效果`;
      const queued = await service.create({ tenantId: "tenant", userId: "user" }, media.asset.id, definition,
        { type: toolName, data: definition.defaults } as EffectParameterEnvelope, 7, 1 / 30, 30, prompt);
      expect(queued.selfCheck).toMatchObject({ status: "queued", toolName });
      await waitFor(() => service.get({ tenantId: "tenant", userId: "user" }, queued.id).status === "completed");
      expect(service.get({ tenantId: "tenant", userId: "user" }, queued.id).selfCheck).toMatchObject({ status: "pass" });
      const call = runner.mock.calls.at(-1)!;
      expect(call[0]).toBe(toolName);
      expect(call[1]).toMatchObject({ userRequest: prompt,
        videoPath: expect.stringContaining("output.mp4"),
        baselineVideoPath: expect.stringContaining(`${toolName}-self-check-baseline.mp4`) });
    }
    expect(runner).toHaveBeenCalledTimes(TOOLS.length);
    expect(exportFrames).toHaveBeenCalledTimes(TOOLS.length * 2);
    await service.close();
  });
});
