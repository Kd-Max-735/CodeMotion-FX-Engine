import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { runChromaticAberrationSelfCheck } from "../src/chromatic-aberration-self-check.js";
import { runColorGradeSelfCheck } from "../src/color-grade-self-check.js";
import { runFilmGrainSelfCheck } from "../src/film-grain-self-check.js";
import { runGaussianBlurSelfCheck } from "../src/gaussian-blur-self-check.js";
import { runDirectionalBlurSelfCheck } from "../src/directional-blur-self-check.js";
import { runMotionBlurSelfCheck } from "../src/motion-blur-self-check.js";
import { runRadialBlurSelfCheck } from "../src/radial-blur-self-check.js";
import { runRgbSplitSelfCheck } from "../src/rgb-split-self-check.js";
import { runTextureOverlaySelfCheck } from "../src/texture-overlay-self-check.js";
import { runTrackMatteSelfCheck } from "../src/track-matte-self-check.js";

const RUNNERS = Object.freeze({
  chromatic_aberration: runChromaticAberrationSelfCheck,
  color_grade: runColorGradeSelfCheck,
  film_grain: runFilmGrainSelfCheck,
  gaussian_blur: runGaussianBlurSelfCheck,
  directional_blur: runDirectionalBlurSelfCheck,
  motion_blur: runMotionBlurSelfCheck,
  radial_blur: runRadialBlurSelfCheck,
  rgb_split: runRgbSplitSelfCheck,
  texture_overlay: runTextureOverlaySelfCheck,
  track_matte: runTrackMatteSelfCheck
});

const EFFECT_FIELDS = Object.freeze({
  chromatic_aberration: "channel_separation",
  color_grade: "temperature_change",
  film_grain: "grain_motion",
  gaussian_blur: "directional_uniformity",
  directional_blur: "direction_coherence",
  motion_blur: "trail_distribution",
  radial_blur: "visual_center",
  rgb_split: "separation_shape",
  texture_overlay: "target_concentration",
  track_matte: "boundary_appearance"
});

async function syntheticFrame(
  inputPath: string,
  outputPath: string,
  width: number,
  height: number,
  time: number
): Promise<void> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  const baseline = inputPath.includes("baseline");
  const temporal = outputPath.includes("film_grain") || outputPath.includes("texture_overlay");
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const base = (x * 11 + y * 7) % 190 + 24;
    const pulse = temporal ? Math.round(Math.sin(time * 8 + x * 1.7 + y * 0.9) * 24) : 18;
    image.data[offset] = baseline ? base : Math.max(0, Math.min(255, base + pulse));
    image.data[offset + 1] = baseline ? base : Math.max(0, Math.min(255, base - Math.round(pulse * 0.35)));
    image.data[offset + 2] = baseline ? base : Math.max(0, Math.min(255, base - pulse));
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  await writeFile(outputPath, canvas.toBuffer("image/png"));
}

describe("ten independent visual-quality self-checks", () => {
  it("builds redacted views from final MP4 frames with dedicated evidence and generated summaries", async () => {
    const root = await mkdtemp(join(tmpdir(), "cmfx-visual-quality-"));
    const counts = new Set<number>();
    const protections = new Set<string>();
    for (const [toolName, runner] of Object.entries(RUNNERS)) {
      let reviewView: Readonly<Record<string, unknown>> | undefined;
      const artifacts = await runner({
        requestId: `request-${toolName}`,
        tenantId: "tenant-test",
        userId: "user-test",
        userRequest: "请让实际视觉效果清楚且自然，参考 C:\\private\\source.png 和 https://example.invalid/a",
        videoPath: join(root, `${toolName}-final.mp4`),
        fileName: `${toolName}.mp4`,
        baselineVideoPath: join(root, `${toolName}-baseline.mp4`),
        outputDirectory: join(root, toolName),
        width: 48,
        height: 32,
        fps: 24,
        durationSeconds: 4,
        frameCount: 96,
        bytes: 1_024,
        frameExtractor: syntheticFrame,
        reviewer: async ({ ruleIds, view }: {
          ruleIds: readonly string[];
          view: Readonly<Record<string, unknown>>;
        }) => {
          reviewView = view;
          return {
            status: "pass",
            summary: "这段文字来自审查响应，不应进入最终结果。",
            checks: ruleIds.map((ruleId) => ({ ruleId, status: "pass" as const,
              evidenceRefs: ["keyframe_contact_sheet"], reason: "最终关键帧与实际观察相符。" })),
            issues: []
          };
        }
      } as never);

      expect(artifacts.view.status).toBe("pass");
      expect(artifacts.view.result?.summary).not.toContain("审查响应");
      expect(reviewView).toBeDefined();
      expect(Object.keys(reviewView!).sort()).toEqual(["file_name", "metadata", "original_request", "summary"]);
      expect(reviewView!.original_request).toContain("[已隐藏]");
      const metadata = reviewView!.metadata as { effect: Record<string, unknown>;
        quality: { intended_effect_protection: string }; keyframe_evidence: { image_count: number } };
      expect(metadata.effect).toHaveProperty(EFFECT_FIELDS[toolName as keyof typeof EFFECT_FIELDS]);
      expect(metadata.keyframe_evidence.image_count).toBeGreaterThanOrEqual(3);
      expect(metadata.keyframe_evidence.image_count).toBeLessThanOrEqual(6);
      counts.add(metadata.keyframe_evidence.image_count);
      protections.add(metadata.quality.intended_effect_protection);
      const serialized = JSON.stringify(reviewView);
      expect(serialized).not.toMatch(/(?:backend|effectId|https?:\/\/|[A-Za-z]:\\|"path"|path_)/u);
      const sheet = artifacts.evidenceFiles.get("keyframe_contact_sheet");
      expect(sheet).toBeDefined();
      await access(sheet!);
      expect(artifacts.view.evidenceImages).toHaveLength(1);
    }
    expect(counts.size).toBeGreaterThan(1);
    expect(protections.size).toBe(Object.keys(RUNNERS).length);
  });
});
