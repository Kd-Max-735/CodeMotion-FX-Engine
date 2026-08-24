import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EFFECT_TOOL_REGISTRY, type AuthorizedEffectInputs } from "@codemotion/effect-functions";
import type { ExportOptions } from "@codemotion/exporter";
import { EffectToolVideoService } from "../src/effect-tool-video-service.js";
import { selfCheckDisplacementMap } from "../src/self-checks/displacement-map-self-check.js";
import { selfCheckFractal } from "../src/self-checks/fractal-self-check.js";
import { selfCheckGlass } from "../src/self-checks/glass-self-check.js";
import { selfCheckImageDepthParallax } from "../src/self-checks/image-depth-parallax-self-check.js";
import { selfCheckKaleidoscope } from "../src/self-checks/kaleidoscope-self-check.js";
import { selfCheckLiquidDisplace } from "../src/self-checks/liquid-displace-self-check.js";
import { selfCheckPathMorph } from "../src/self-checks/path-morph-self-check.js";
import { selfCheckTurbulentDisplace } from "../src/self-checks/turbulent-displace-self-check.js";
import { selfCheckWaveSurface } from "../src/self-checks/wave-surface-self-check.js";
import { selfCheckWaveWarp } from "../src/self-checks/wave-warp-self-check.js";
import {
  VISUAL_EFFECT_ANALYZERS,
  VISUAL_SELF_CHECK_TOOLS,
  analyzeVisualEffectFrames,
  runVisualEffectSelfCheck,
  type VisualFrameSample
} from "../src/visual-effect-self-check.js";
import { effectiveParamsFor } from "./self-check-test-helpers.js";

const directories: string[] = [];

afterEach(async () => {
  // Repository policy forbids the agent from batch deletion. Test temp cleanup is intentionally omitted.
  directories.length = 0;
});

function sample(frame: number, phase: number, width = 12, height = 8): VisualFrameSample {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const wave = Math.sin((x + phase) * 0.9) * 42 + Math.cos((y - phase) * 0.7) * 28;
      pixels[offset] = Math.max(0, Math.min(255, 92 + x * 9 + wave));
      pixels[offset + 1] = Math.max(0, Math.min(255, 70 + y * 14 - wave * 0.35));
      pixels[offset + 2] = Math.max(0, Math.min(255, 128 + wave * 0.6));
      pixels[offset + 3] = 255;
    }
  }
  return Object.freeze({ frame, time: frame / 10, width, height, pixels });
}

const modules = {
  displacement_map: selfCheckDisplacementMap,
  kaleidoscope: selfCheckKaleidoscope,
  liquid_displace: selfCheckLiquidDisplace,
  fractal: selfCheckFractal,
  glass: selfCheckGlass,
  image_depth_parallax: selfCheckImageDepthParallax,
  path_morph: selfCheckPathMorph,
  turbulent_displace: selfCheckTurbulentDisplace,
  wave_warp: selfCheckWaveWarp,
  wave_surface: selfCheckWaveSurface
} as const;

const expectedFacts = {
  displacement_map: ["实际形变范围", "形变方向", "连续性", "边缘表现"],
  kaleidoscope: ["对称性", "中心表现", "旋转连续性", "接缝质量"],
  liquid_displace: ["液态流动", "折射表现", "彩色边缘", "流动连续性"],
  fractal: ["递归层次", "层间区分", "中心深入感", "动画连续性"],
  glass: ["通透与磨砂", "折射表现", "玻璃色调", "边缘高光", "原有运动保留"],
  image_depth_parallax: ["深度层次", "镜头运动", "运动方向", "边缘完整性", "运动连续性"],
  path_morph: ["起止关系", "变形峰值", "推进方向", "过渡连续性", "结束稳定性"],
  turbulent_displace: ["形变尺度", "方向偏置", "有机连续性", "边缘表现"],
  wave_warp: ["扭曲方向", "波纹疏密", "波形连续性", "边缘稳定性"],
  wave_surface: ["波面形态", "峰谷层次", "波面变化", "高光与阴影", "曲面完整性"]
} as const;

describe("ten independent final-video self-check functions", () => {
  it("keeps one independently imported analyzer module per tool", () => {
    expect(Object.keys(modules)).toEqual(VISUAL_SELF_CHECK_TOOLS);
    for (const toolName of VISUAL_SELF_CHECK_TOOLS) {
      expect(VISUAL_EFFECT_ANALYZERS[toolName]).toBe(modules[toolName]);
    }
    expect(new Set(Object.values(modules)).size).toBe(10);
  });

  for (const toolName of VISUAL_SELF_CHECK_TOOLS) {
    it(`${toolName} reports only its dedicated observable facts and dynamic keyframes`, () => {
      const facts = analyzeVisualEffectFrames(toolName,
        [sample(0, 0), sample(2, 0.3), sample(4, 1.2), sample(6, 2.8), sample(8, 3.1)]);
      const labels = facts.keyInformation.map((item) => item.label);
      expect(labels[0]).toBe("特效类型");
      expect(labels.slice(1)).toEqual(expectedFacts[toolName]);
      expect(facts.selected.length).toBeGreaterThanOrEqual(3);
      expect(facts.selected.length).toBeLessThanOrEqual(toolName === "path_morph" ? 5 : 5);
      expect(facts.selected.every((item) => item.pixels.length > 0 && item.time >= 0)).toBe(true);
      expect(Object.keys(facts.technicalQuality).length).toBeGreaterThanOrEqual(3);
    });
  }

  it("builds the closed four-field JSON and a single contact sheet only from extracted MP4 frames", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "cmfx-kaleidoscope-self-check-"));
    directories.push(outputDirectory);
    const extractedInputs: string[] = [];
    const result = await runVisualEffectSelfCheck({
      requestId: "self-check-test",
      tenantId: "tenant-test",
      userId: "user-test",
      toolName: "kaleidoscope",
      userRequest: "做对称清楚且缓慢旋转的万花筒",
      videoPath: join(outputDirectory, "final.mp4"),
      fileName: "kaleidoscope-final.mp4",
      outputDirectory,
      width: 12,
      height: 8,
      fps: 10,
      durationSeconds: 1,
      frameCount: 10,
      bytes: 1234,
      effectiveParams: effectiveParamsFor("kaleidoscope"),
      frameExtractor: async (inputPath, outputPath, width, height, time) => {
        extractedInputs.push(inputPath);
        const canvas = createCanvas(width, height);
        const context = canvas.getContext("2d");
        context.fillStyle = `rgb(${Math.round(time * 180)}, 90, 160)`;
        context.fillRect(0, 0, width, height);
        context.fillStyle = "white";
        context.fillRect(Math.floor(time * 5), 2, 3, 3);
        await writeFile(outputPath, canvas.toBuffer("image/png"));
      },
      reviewer: {
        review: async ({ acceptanceView, evidencePng }) => {
          expect(Object.keys(acceptanceView)).toEqual(["file_name", "original_request", "summary", "metadata"]);
          const metadata = acceptanceView.metadata as { quality: { effect_specific: Record<string, unknown> } };
          expect(Object.keys(metadata.quality.effect_specific)).toEqual(["对称结构稳定", "扇区接缝完整", "旋转无突跳"]);
          expect(evidencePng.length).toBeGreaterThan(20);
          return { status: "pass", summary: "对称与旋转证据可交付。", checks: [{
            ruleId: "DELIVERY_REVIEW", status: "pass", evidenceRefs: ["macroView", "keyframe_contact_sheet"],
            reason: "证据一致。"
          }], issues: [] };
        }
      }
    });
    expect(result.view).toMatchObject({ status: "pass", toolName: "kaleidoscope", evidenceStatus: "sufficient" });
    expect(extractedInputs.length).toBeGreaterThan(3);
    expect(new Set(extractedInputs)).toEqual(new Set([join(outputDirectory, "final.mp4")]));
    expect(result.evidenceFiles.size).toBe(1);
    const boardPath = result.evidenceFiles.get("keyframe_contact_sheet")!;
    expect((await stat(boardPath)).size).toBeGreaterThan(20);
    const bytes = await readFile(boardPath);
    expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("starts a listed tool self-check only after the final MP4 export has completed", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "cmfx-visual-self-check-service-"));
    directories.push(outputRoot);
    let exportCompleted = false;
    const runner = vi.fn(async (request: { outputDirectory: string; toolName: string; videoPath: string }) => {
      expect(exportCompleted).toBe(true);
      expect((await stat(request.videoPath)).size).toBeGreaterThan(0);
      const evidencePath = join(request.outputDirectory, "keyframe_contact_sheet.png");
      await writeFile(evidencePath, Buffer.from("evidence"));
      return {
        view: {
          status: "pass" as const,
          automatic: true as const,
          toolName: request.toolName,
          ruleVersion: "1.0.0",
          evidenceContractVersion: "1.0.0",
          evidenceStatus: "sufficient" as const,
          macroView: { file_name: "kaleidoscope.mp4", original_request: "缓慢旋转的万花筒", summary: {}, metadata: {} },
          evidenceImages: [{ evidenceId: "keyframe_contact_sheet", label: "关键帧", mime: "image/png" as const, width: 1, height: 1 }],
          result: { status: "pass" as const, summary: "通过", checks: [], issues: [] }
        },
        evidenceFiles: new Map([["keyframe_contact_sheet", evidencePath]])
      };
    });
    const exportFrames = vi.fn(async (options: ExportOptions) => {
      const request = { frame: 0, time: 0, deltaTime: 0.1, fps: 10, width: 12, height: 8 };
      await options.renderFrame(request, options.signal);
      await writeFile(options.outputPath, Buffer.from("final-mp4"));
      exportCompleted = true;
      return { outputPath: options.outputPath, frameCount: 1, inspections: [], encoder: "libx264" };
    });
    const service = new EffectToolVideoService({
      media: { resolve: vi.fn(async () => { throw new Error("media resolution is not expected"); }) },
      outputRoot,
      exportFrames: exportFrames as never,
      visualSelfCheckRunner: runner as never,
      durationSeconds: 0.1,
      fps: 10,
      gpuSampler: vi.fn(async () => ({ name: "test", memoryUsedMiB: 1, memoryTotalMiB: 2, utilizationPercent: 1 }))
    });
    const definition = EFFECT_TOOL_REGISTRY.getByToolName("kaleidoscope")!;
    const pixels = sample(0, 0).pixels;
    const inputs: AuthorizedEffectInputs = Object.freeze({
      primary_image: Object.freeze({
        slot: "primary_image", kind: "image", tenantId: "tenant-test", userId: "user-test", locked: true,
        binding: Object.freeze({ width: 12, height: 8, data: pixels })
      })
    });
    const owner = { tenantId: "tenant-test", userId: "user-test" };
    const queued = await service.createPrepared(owner, definition,
      { type: "kaleidoscope", data: definition.defaults }, inputs, [], 7, 0.1, 12, 8,
      undefined, 10, undefined, false, "缓慢旋转的万花筒");
    expect(queued.selfCheck).toMatchObject({ status: "queued", toolName: "kaleidoscope" });
    let completed = service.get(owner, queued.id);
    for (let attempt = 0; attempt < 100 && completed.status !== "completed"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      completed = service.get(owner, queued.id);
    }
    expect(completed).toMatchObject({ status: "completed", selfCheck: { status: "pass", toolName: "kaleidoscope" } });
    expect(runner).toHaveBeenCalledOnce();
    await service.close();
  });
});
