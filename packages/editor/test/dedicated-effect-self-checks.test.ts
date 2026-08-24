import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it, vi } from "vitest";
import { EFFECT_TOOL_REGISTRY, type EffectParameterEnvelope } from "@codemotion/effect-functions";
import { EffectToolVideoService } from "../src/effect-tool-video-service.js";
import { importantParameterDefinitions } from "../src/self-check-parameter-summary.js";
import {
  type DedicatedSelfCheckRunner,
  type DedicatedSelfCheckToolName
} from "../src/dedicated-effect-self-check-common.js";
import {
  BACKGROUND_REMOVE_COMPOSE_RULE_IDS,
  backgroundRemoveComposeSamplingPlan,
  runBackgroundRemoveComposeSelfCheck
} from "../src/background-remove-compose-self-check.js";
import { BLEND_RULE_IDS, blendSamplingPlan, runBlendSelfCheck } from "../src/blend-self-check.js";
import { BLOB_MORPH_RULE_IDS, blobMorphSamplingPlan, runBlobMorphSelfCheck } from "../src/blob-morph-self-check.js";
import { CHART_REVEAL_RULE_IDS, chartRevealSamplingPlan, runChartRevealSelfCheck } from "../src/chart-reveal-self-check.js";
import {
  CHARACTER_CASCADE_RULE_IDS,
  characterCascadeSamplingPlan,
  runCharacterCascadeSelfCheck
} from "../src/character-cascade-self-check.js";
import { HANDWRITING_RULE_IDS, handwritingSamplingPlan, runHandwritingSelfCheck } from "../src/handwriting-self-check.js";
import { BRUSH_REVEAL_RULE_IDS, brushRevealSamplingPlan, runBrushRevealSelfCheck } from "../src/brush-reveal-self-check.js";
import { MASK_REVEAL_RULE_IDS, maskRevealSamplingPlan, runMaskRevealSelfCheck } from "../src/mask-reveal-self-check.js";
import { PAINT_ON_RULE_IDS, paintOnSamplingPlan, runPaintOnSelfCheck } from "../src/paint-on-self-check.js";

type Case = Readonly<{
  toolName: DedicatedSelfCheckToolName;
  params: Readonly<Record<string, unknown>>;
  runner: DedicatedSelfCheckRunner;
  ruleIds: readonly string[];
  expectedLabel: string;
  referenceSlots: readonly string[];
}>;

const CASES: readonly Case[] = Object.freeze([
  { toolName: "background_remove_compose", params: {}, runner: runBackgroundRemoveComposeSelfCheck,
    ruleIds: BACKGROUND_REMOVE_COMPOSE_RULE_IDS, expectedLabel: "前景主体", referenceSlots: ["foreground_video", "background_image"] },
  { toolName: "blend", params: {}, runner: runBlendSelfCheck,
    ruleIds: BLEND_RULE_IDS, expectedLabel: "图层贡献", referenceSlots: ["source_layer", "overlay_layer"] },
  { toolName: "blob_morph", params: { speed: 1 }, runner: runBlobMorphSelfCheck,
    ruleIds: BLOB_MORPH_RULE_IDS, expectedLabel: "形态变化", referenceSlots: [] },
  { toolName: "chart_reveal", params: { duration: 1, stagger: 0.1, labels: ["甲", "乙", "丙"] },
    runner: runChartRevealSelfCheck, ruleIds: CHART_REVEAL_RULE_IDS, expectedLabel: "图表呈现", referenceSlots: [] },
  { toolName: "character_cascade", params: { text: "文字级联", selector: "character", stagger: 0.1 },
    runner: runCharacterCascadeSelfCheck, ruleIds: CHARACTER_CASCADE_RULE_IDS, expectedLabel: "文字完整性", referenceSlots: ["source_image"] },
  { toolName: "handwriting", params: {}, runner: runHandwritingSelfCheck,
    ruleIds: HANDWRITING_RULE_IDS, expectedLabel: "笔迹进度", referenceSlots: ["source_image"] },
  { toolName: "brush_reveal", params: {}, runner: runBrushRevealSelfCheck,
    ruleIds: BRUSH_REVEAL_RULE_IDS, expectedLabel: "目标画面显现", referenceSlots: ["source_frame", "target_frame"] },
  { toolName: "mask_reveal", params: { duration: 1 }, runner: runMaskRevealSelfCheck,
    ruleIds: MASK_REVEAL_RULE_IDS, expectedLabel: "遮罩覆盖", referenceSlots: ["source_frame", "target_frame"] },
  { toolName: "paint_on", params: { duration: 1 }, runner: runPaintOnSelfCheck,
    ruleIds: PAINT_ON_RULE_IDS, expectedLabel: "已绘制范围", referenceSlots: ["source_image"] }
]);

function rgba(width: number, height: number, red: number, green: number, blue: number): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  for (let offset = 0; offset < output.length; offset += 4) {
    output[offset] = red;
    output[offset + 1] = green;
    output[offset + 2] = blue;
    output[offset + 3] = 255;
  }
  return output;
}

async function waitForCompletedTask(
  service: EffectToolVideoService,
  owner: Readonly<{ tenantId: string; userId: string }>,
  id: string
): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (service.get(owner, id).status === "completed") return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Dedicated self-check task did not complete.");
}

describe("nine dedicated automatic self-check functions", () => {
  it("uses effect-specific candidate plans instead of one fixed sampling template", () => {
    expect(backgroundRemoveComposeSamplingPlan({ durationSeconds: 5, fps: 30, params: {} })).toHaveLength(6);
    expect(blendSamplingPlan({ durationSeconds: 5, fps: 30, params: {} })).toHaveLength(5);
    expect(blobMorphSamplingPlan({ durationSeconds: 5, fps: 30, params: { speed: 0 } })).toHaveLength(3);
    expect(blobMorphSamplingPlan({ durationSeconds: 5, fps: 30, params: { speed: 2 } }).length).toBeGreaterThan(3);
    expect(chartRevealSamplingPlan({ durationSeconds: 5, fps: 30, params: { duration: 1, stagger: 0.1, labels: ["a", "b"] } }).length)
      .toBeLessThan(chartRevealSamplingPlan({ durationSeconds: 5, fps: 30, params: { duration: 1, stagger: 0.1, labels: ["a", "b", "c", "d", "e", "f"] } }).length);
    expect(characterCascadeSamplingPlan({ durationSeconds: 5, fps: 30, params: { text: "短", stagger: 0.1 } }).length)
      .toBeLessThan(characterCascadeSamplingPlan({ durationSeconds: 5, fps: 30, params: { text: "更长的字符级联文字", stagger: 0.1 } }).length);
    expect(handwritingSamplingPlan({ durationSeconds: 5, fps: 30, params: {} })).toHaveLength(6);
    expect(brushRevealSamplingPlan({ durationSeconds: 5, fps: 30, params: {} })).toHaveLength(6);
    expect(maskRevealSamplingPlan({ durationSeconds: 5, fps: 30, params: { duration: 1 } }).map((item) => item.role))
      .toContain("boundary_check");
    expect(paintOnSamplingPlan({ durationSeconds: 5, fps: 30, params: { duration: 1 } }).map((item) => item.role))
      .toContain("coverage_check");
  });

  it("changes the final evidence count when the rendered result contains more useful visual changes", async () => {
    const run = async (changing: boolean): Promise<number> => {
      const outputDirectory = await mkdtemp(join(tmpdir(), `cmfx-dynamic-evidence-${changing}-`));
      const decision = Object.freeze({
        status: "pass" as const,
        summary: "图层混合证据通过。",
        checks: Object.freeze(BLEND_RULE_IDS.map((ruleId) => Object.freeze({
          ruleId,
          status: "pass" as const,
          evidenceRefs: Object.freeze(["keyframe_contact_sheet"]),
          reason: "最终视频证据与用户要求一致。"
        }))),
        issues: Object.freeze([])
      });
      const artifacts = await runBlendSelfCheck({
        requestId: `dynamic-${changing}`,
        tenantId: "tenant-test",
        userId: "user-test",
        userRequest: "检查图层混合",
        envelope: { type: "blend", data: {} },
        videoPath: join(outputDirectory, "output.mp4"),
        outputDirectory,
        width: 96,
        height: 54,
        fps: 30,
        durationSeconds: 5,
        frameCount: 150,
        bytes: 4096,
        reviewer: { review: async () => decision },
        frameExtractor: async (_inputPath, outputPath, width, height, time = 0) => {
          const canvas = createCanvas(width, height);
          const context = canvas.getContext("2d");
          const phase = changing ? Math.max(0, Math.min(1, time / 5)) : 0.4;
          context.fillStyle = `rgb(${Math.round(30 + phase * 180)}, ${Math.round(45 + phase * 100)}, 90)`;
          context.fillRect(0, 0, width, height);
          await writeFile(outputPath, canvas.toBuffer("image/png"));
        }
      });
      const metadata = artifacts.view.macroView!.metadata as {
        keyframe_evidence: { image_count: number };
      };
      return metadata.keyframe_evidence.image_count;
    };

    const stableCount = await run(false);
    const changingCount = await run(true);
    expect(stableCount).toBe(3);
    expect(changingCount).toBeGreaterThan(stableCount);
  });

  it.each(CASES)("$toolName generates its own public facts and final-MP4 contact sheet", async (entry) => {
    const width = 96;
    const height = 54;
    const outputDirectory = await mkdtemp(join(tmpdir(), `cmfx-${entry.toolName}-self-check-`));
    const references = Object.freeze(Object.fromEntries(entry.referenceSlots.map((slot, index) => [
      slot,
      rgba(width, height, 20 + index * 70, 45 + index * 35, 80 + index * 50)
    ])));
    const decision = Object.freeze({
      status: "pass" as const,
      summary: `${entry.toolName} 专属证据通过。`,
      checks: Object.freeze(entry.ruleIds.map((ruleId) => Object.freeze({
        ruleId,
        status: "pass" as const,
        evidenceRefs: Object.freeze(["keyframe_contact_sheet"]),
        reason: "最终视频证据与用户要求一致。"
      }))),
      issues: Object.freeze([])
    });
    const envelope: EffectParameterEnvelope = { type: entry.toolName, data: entry.params };
    const artifacts = await entry.runner({
      requestId: `request-${entry.toolName}`,
      tenantId: "tenant-test",
      userId: "user-test",
      userRequest: `请生成${entry.toolName}效果`,
      envelope,
      videoPath: join(outputDirectory, "output.mp4"),
      fileName: `${entry.toolName}.mp4`,
      outputDirectory,
      width,
      height,
      fps: 30,
      durationSeconds: 5,
      frameCount: 150,
      bytes: 4096,
      references,
      reviewer: { review: async (reviewRequest) => {
        expect(reviewRequest.toolName).toBe(entry.toolName);
        expect(reviewRequest.rule).toMatch(new RegExp(`^# ${entry.toolName} 自检规则`, "u"));
        expect(reviewRequest.rule).not.toContain("# wave_path 自检规则");
        expect(Object.keys(reviewRequest.acceptanceView)).toEqual([
          "file_name", "original_request", "summary", "metadata"
        ]);
        expect(reviewRequest.evidencePng.byteLength).toBeGreaterThan(0);
        return decision;
      } },
      frameExtractor: async (_inputPath, outputPath, frameWidth, frameHeight, time = 0) => {
        const canvas = createCanvas(frameWidth, frameHeight);
        const context = canvas.getContext("2d");
        const phase = Math.max(0, Math.min(1, time / 5));
        context.fillStyle = `rgb(${Math.round(28 + phase * 150)}, ${Math.round(42 + phase * 90)}, ${Math.round(70 + phase * 70)})`;
        context.fillRect(0, 0, frameWidth, frameHeight);
        context.fillStyle = "#f4f0df";
        context.fillRect(Math.round(frameWidth * 0.1), Math.round(frameHeight * 0.2),
          Math.max(2, Math.round(frameWidth * phase * 0.7)), Math.round(frameHeight * 0.5));
        await writeFile(outputPath, canvas.toBuffer("image/png"));
      }
    });

    expect(artifacts.view).toMatchObject({
      status: "pass",
      toolName: entry.toolName,
      evidenceStatus: "sufficient",
      evidenceImages: [{ evidenceId: "keyframe_contact_sheet" }]
    });
    const macro = artifacts.view.macroView!;
    expect(Object.keys(macro)).toEqual(["file_name", "original_request", "summary", "metadata"]);
    const summary = macro.summary as { key_information: Record<string, { label: string; value: unknown }> };
    expect(Object.keys(summary.key_information)).toEqual(
      importantParameterDefinitions(entry.toolName).map(([name]) => name)
    );
    const metadata = macro.metadata as {
      keyframe_evidence: { keyframes: ReadonlyArray<Readonly<Record<string, unknown>>> };
      observed_effect: { key_information: ReadonlyArray<{ label: string; value: string }> };
    };
    expect(metadata.observed_effect.key_information.map((item) => item.label)).toContain(entry.expectedLabel);
    expect(metadata.keyframe_evidence.keyframes.length).toBeGreaterThanOrEqual(3);
    for (const keyframe of metadata.keyframe_evidence.keyframes) {
      expect(Object.keys(keyframe)).toEqual(["sequence", "time_seconds", "role"]);
    }
    const serializedMacro = JSON.stringify(macro);
    expect(serializedMacro).not.toMatch(/normalizedParams|backendId|algorithm|resourceId|[A-Za-z]:\\|https?:\/\//u);
    for (const [field] of importantParameterDefinitions(entry.toolName)) {
      expect(summary.key_information).toHaveProperty(field);
    }
    const boardPath = artifacts.evidenceFiles.get("keyframe_contact_sheet");
    expect(boardPath).toBeTypeOf("string");
    await expect(stat(boardPath!)).resolves.toMatchObject({ size: expect.any(Number) });
  });

  it("dispatches every independent runner only after its final MP4 has been written", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "cmfx-dedicated-dispatch-"));
    const owner = Object.freeze({ tenantId: "tenant-dedicated", userId: "user-dedicated" });
    const callOrder: string[] = [];
    const runners = Object.fromEntries(CASES.map((entry) => [
      entry.toolName,
      vi.fn(async (request: Parameters<DedicatedSelfCheckRunner>[0]) => {
        await expect(stat(request.videoPath)).resolves.toMatchObject({ size: expect.any(Number) });
        callOrder.push(entry.toolName);
        const evidencePath = join(request.outputDirectory, "keyframe_contact_sheet.png");
        await writeFile(evidencePath, Buffer.from(`evidence-${entry.toolName}`));
        return {
          view: {
            status: "pass" as const,
            automatic: true as const,
            toolName: entry.toolName,
            ruleVersion: "1.0.0" as const,
            evidenceContractVersion: "1.0.0" as const,
            evidenceStatus: "sufficient" as const,
            macroView: {
              file_name: `${entry.toolName}.mp4`,
              original_request: `请检查${entry.toolName}`,
              summary: { description: "已检查最终视频。", key_information: [], missing_information: [] },
              metadata: { media: { format: "mp4" }, quality: {}, keyframe_evidence: [] }
            },
            evidenceImages: [{
              evidenceId: "keyframe_contact_sheet",
              label: "关键帧合成图",
              mime: "image/png" as const,
              width: 96,
              height: 54
            }],
            result: { status: "pass" as const, summary: "通过。", checks: [], issues: [] }
          },
          evidenceFiles: new Map([["keyframe_contact_sheet", evidencePath]])
        };
      })
    ])) as unknown as Record<DedicatedSelfCheckToolName, DedicatedSelfCheckRunner>;
    const exportFrames = vi.fn(async (options: Readonly<{ outputPath: string }>) => {
      callOrder.push(`render:${options.outputPath}`);
      await writeFile(options.outputPath, Buffer.from("final-mp4"));
      return { outputPath: options.outputPath, frameCount: 1, inspections: [], encoder: "libx264" };
    });
    const service = new EffectToolVideoService({
      media: { resolve: vi.fn(async () => { throw new Error("No media should be resolved."); }) },
      outputRoot,
      exportFrames: exportFrames as never,
      durationSeconds: 1 / 30,
      fps: 30,
      gpuSampler: vi.fn(async () => ({
        name: "Test NVIDIA GPU",
        memoryUsedMiB: 256,
        memoryTotalMiB: 8_192,
        utilizationPercent: 42
      })),
      dedicatedSelfCheckRunners: runners
    });

    for (const entry of CASES) {
      const definition = EFFECT_TOOL_REGISTRY.getByToolName(entry.toolName);
      if (definition === undefined) throw new Error(`Missing effect definition: ${entry.toolName}`);
      const queued = await service.createPrepared(
        owner,
        definition,
        { type: entry.toolName, data: definition.defaults },
        {},
        [],
        1,
        1 / 30,
        96,
        54,
        undefined,
        30,
        undefined,
        false,
        `请检查${entry.toolName}`
      );
      expect(queued.selfCheck).toMatchObject({ status: "queued", automatic: true, toolName: entry.toolName });
      await waitForCompletedTask(service, owner, queued.id);
      expect(service.get(owner, queued.id)).toMatchObject({
        status: "completed",
        video: { bytes: 9 },
        selfCheck: { status: "pass", toolName: entry.toolName, evidenceStatus: "sufficient" }
      });
      expect(vi.mocked(runners[entry.toolName])).toHaveBeenCalledOnce();
      const renderIndex = callOrder.findIndex((item) => item.startsWith("render:"));
      const checkIndex = callOrder.indexOf(entry.toolName);
      expect(renderIndex).toBeGreaterThanOrEqual(0);
      expect(checkIndex).toBeGreaterThan(renderIndex);
      callOrder.length = 0;
    }

    expect(exportFrames).toHaveBeenCalledTimes(CASES.length);
    await service.close();
  });
});
