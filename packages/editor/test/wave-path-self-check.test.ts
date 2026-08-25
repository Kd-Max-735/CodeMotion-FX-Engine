import { describe, expect, it } from "vitest";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { SelfCheckReviewValidationError } from "../src/unified-self-check-review.js";
import {
  parseWavePathSelfCheckResult,
  runWavePathSelfCheck,
  VolcengineArkWavePathSelfCheckReviewer,
  wavePathSamplingPlan
} from "../src/wave-path-self-check.js";

const RULE_IDS = [
  "WP_EXECUTION_INTEGRITY",
  "WP_BASELINE_AND_DIRECTION",
  "WP_WAVE_GEOMETRY",
  "WP_PHASE_AND_MOTION",
  "WP_TAPER_BEHAVIOR",
  "WP_FRAME_SAFETY",
  "WP_USER_INTENT"
] as const;

describe("wave_path automatic self-check contract", () => {
  it("selects evidence-bearing keyframes according to static or moving behavior", () => {
    const staticPlan = wavePathSamplingPlan(5, 30, { phase: 30, speed: 0 });
    expect(staticPlan.map((item) => item.role)).toEqual(["static_early", "static_middle", "static_late"]);
    expect(staticPlan.map((item) => item.frame)).toEqual([15, 75, 134]);

    const movingPlan = wavePathSamplingPlan(5, 30, { phase: 0, speed: 1 });
    expect(movingPlan[0]).toMatchObject({ evidenceId: "motion_start", role: "motion_start" });
    expect(movingPlan.at(-1)).toMatchObject({ evidenceId: "motion_end", role: "motion_end" });
    expect(movingPlan.filter((item) => item.role === "phase_probe")).toHaveLength(3);
  });

  it("accepts only the closed seven-rule Ark decision object", () => {
    const value = {
      status: "pass",
      summary: "路径几何、运动和技术质量均符合规则。",
      checks: RULE_IDS.map((ruleId) => ({
        ruleId,
        status: "pass",
        evidenceRefs: ["keyframe_contact_sheet"],
        reason: "参数、宏观指标和最终成片关键帧相互一致。"
      })),
      issues: []
    };
    const parsed = parseWavePathSelfCheckResult(value);
    expect(parsed.status).toBe("pass");
    expect(parsed.checks.map((check) => check.ruleId)).toEqual(RULE_IDS);
    expect(() => parseWavePathSelfCheckResult({ ...value, extra: true })).toThrow(SelfCheckReviewValidationError);
    expect(() => parseWavePathSelfCheckResult({
      ...value,
      checks: value.checks.map((check, index) => index === 2 ? { ...check, status: "fail" } : check)
    })).toThrow(/issue/u);
    expect(() => parseWavePathSelfCheckResult({
      ...value,
      status: "fail",
      checks: value.checks.map((check, index) => index === 2 ? { ...check, status: "fail" } : check)
    })).toThrow(/issue/u);
  });

  it("recovers a contract-valid JSON object from an Ark fenced response", async () => {
    const decision = {
      status: "pass",
      summary: "路径波浪全部规则通过。",
      checks: RULE_IDS.map((ruleId, index) => ({
        ruleId,
        status: "pass",
        evidenceRefs: [index === 0 ? "self_check_view" : "keyframe_contact_sheet"],
        reason: "证据板与宏观指标一致。"
      })),
      issues: []
    };
    const reviewer = new VolcengineArkWavePathSelfCheckReviewer({
      apiKey: "test-api-key-long-enough",
      fetchImpl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(decision)}\n\`\`\`` } }]
      }), { status: 200, headers: { "content-type": "application/json" } })
    });
    await expect(reviewer.review({
      requestId: "request-test",
      tenantId: "tenant-test",
      userId: "user-test",
      rule: "test rule",
      acceptanceView: {
        original_request: "生成路径波浪",
        metadata: { media: { encoding_completed: true }, keyframe_evidence: { keyframes: [] } }
      },
      evidencePng: Buffer.from("png")
    })).resolves.toMatchObject({ status: "pass", summary: "路径波浪全部规则通过。" });
  });

  it("builds a sufficient macro JSON and a readable final-frame evidence board", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "cmfx-wave-self-check-"));
    const fixturePath = join(outputDirectory, "fixture.png");
    const canvas = createCanvas(640, 360);
    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 640, 360);
    gradient.addColorStop(0, "#12243a");
    gradient.addColorStop(1, "#2a1640");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 640, 360);
    await writeFile(fixturePath, canvas.toBuffer("image/png"));
    const params = {
      amplitude: 10, wavelength: 72, phase: 0, speed: 0, taper: 0.75,
      sampleSpacing: 8, startX: 0.1, startY: 0.5, endX: 0.9, endY: 0.5
    };
    const sourcePoints = Array.from({ length: 65 }, (_, index) => ({ x: 64 + index * 8, y: 180 }));
    const snapshots = wavePathSamplingPlan(5, 30, params).map((item) => ({
      ...item,
      algorithm: "arc_length_normal_wave",
      backendId: "effect-functions-existing-cpu-v1",
      degraded: false,
      warnings: [],
      sourcePoints,
      points: sourcePoints.map((point, index) => ({
        x: point.x,
        y: point.y + Math.sin(index * 8 / params.wavelength * Math.PI * 2 + item.phaseRadians) * params.amplitude
      })),
      rawPointCount: sourcePoints.length,
      rawSourcePointCount: sourcePoints.length,
      phaseRadiansFromRenderer: item.phaseRadians
    }));
    const decision = {
      status: "pass" as const,
      summary: "路径几何、静态时序和最终画面质量均符合规则。",
      checks: RULE_IDS.map((ruleId) => ({
        ruleId,
        status: "pass" as const,
        evidenceRefs: ["keyframe_contact_sheet"],
        reason: "宏观指标与关键帧证据一致。"
      })),
      issues: []
    };
    const artifacts = await runWavePathSelfCheck({
      requestId: "test-wave-path-self-check",
      tenantId: "tenant-test",
      userId: "user-test",
      userRequest: "生成一条细密、静止并自然收束的路径波浪",
      envelope: { type: "wave_path", data: params },
      videoPath: join(outputDirectory, "output.mp4"),
      baselineVideoPath: join(outputDirectory, "self-check-codec-baseline.mp4"),
      outputDirectory,
      width: 640,
      height: 360,
      fps: 30,
      durationSeconds: 5,
      frameCount: 150,
      bytes: 1024,
      backendId: "effect-functions-existing-cpu-v1",
      snapshots,
      reviewer: { review: async () => decision },
      frameExtractor: async (_inputPath, outputPath) => copyFile(fixturePath, outputPath)
    });

    expect(artifacts.view).toMatchObject({
      status: "pass",
      evidenceStatus: "sufficient",
      macroView: {
        file_name: "output.mp4",
        original_request: "生成一条细密、静止并自然收束的路径波浪",
        summary: { key_information: {
          amplitude: { label: "波动幅度", value: 10 },
          wavelength: { label: "波长", value: 72 },
          speed: { label: "波动速度", value: 0 },
          taper: { label: "两端收束", value: 0.75 }
        } },
        metadata: {
          media: { media_type: "video/mp4", width_px: 640, height_px: 360, duration_seconds: 5 },
          quality: { black_frame_ratio: 0, unexpected_global_change_ratio: 0 },
          keyframe_evidence: { coverage: "sufficient", image_count: 3 }
        }
      },
      evidenceImages: [{ evidenceId: "keyframe_contact_sheet", width: 928, height: 317 }]
    });
    const boardPath = artifacts.evidenceFiles.get("keyframe_contact_sheet");
    expect(boardPath).toBeTypeOf("string");
    const board = await loadImage(boardPath!);
    expect(board.width).toBe(928);
    expect(board.height).toBe(317);
  });

  it("compares against the same-codec control and still reports real changes outside the path", async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), "cmfx-wave-control-baseline-"));
    const baselineFixture = join(outputDirectory, "baseline.png");
    const finalFixture = join(outputDirectory, "final.png");
    const baseline = createCanvas(100, 100);
    const baselineContext = baseline.getContext("2d");
    baselineContext.fillStyle = "#30363a";
    baselineContext.fillRect(0, 0, 100, 100);
    await writeFile(baselineFixture, baseline.toBuffer("image/png"));
    const final = createCanvas(100, 100);
    const finalContext = final.getContext("2d");
    finalContext.drawImage(baseline, 0, 0);
    finalContext.fillStyle = "#ffffff";
    finalContext.fillRect(0, 0, 20, 20);
    await writeFile(finalFixture, final.toBuffer("image/png"));
    const params = {
      amplitude: 4, wavelength: 80, phase: 0, speed: 0, taper: 0,
      sampleSpacing: 8, startX: 0.4, startY: 0.5, endX: 0.6, endY: 0.5
    };
    const sourcePoints = [{ x: 40, y: 50 }, { x: 60, y: 50 }];
    const snapshots = wavePathSamplingPlan(1, 30, params).map((item) => ({
      ...item,
      algorithm: "arc_length_normal_wave",
      backendId: "effect-functions-existing-cpu-v1",
      degraded: false,
      warnings: [],
      sourcePoints,
      points: sourcePoints,
      rawPointCount: sourcePoints.length,
      rawSourcePointCount: sourcePoints.length,
      phaseRadiansFromRenderer: item.phaseRadians
    }));
    const decision = {
      status: "pass" as const,
      summary: "测试审查器只回传宏观指标。",
      checks: RULE_IDS.map((ruleId) => ({
        ruleId,
        status: "pass" as const,
        evidenceRefs: ["keyframe_contact_sheet"],
        reason: "测试判断。"
      })),
      issues: []
    };
    let reviewedView: Readonly<Record<string, unknown>> | undefined;
    const baselineVideoPath = join(outputDirectory, "self-check-codec-baseline.mp4");
    await runWavePathSelfCheck({
      requestId: "test-wave-path-control-baseline",
      tenantId: "tenant-test",
      userId: "user-test",
      userRequest: "保持路径外画面干净",
      envelope: { type: "wave_path", data: params },
      videoPath: join(outputDirectory, "output.mp4"),
      baselineVideoPath,
      outputDirectory,
      width: 100,
      height: 100,
      fps: 30,
      durationSeconds: 1,
      frameCount: 30,
      bytes: 1024,
      backendId: "effect-functions-existing-cpu-v1",
      snapshots,
      reviewer: {
        review: async (request) => {
          reviewedView = request.acceptanceView;
          return decision;
        }
      },
      frameExtractor: async (inputPath, outputPath) => copyFile(
        inputPath === baselineVideoPath ? baselineFixture : finalFixture,
        outputPath
      )
    });

    expect(JSON.stringify(reviewedView)).not.toMatch(/normalizedParams|sampleSpacing|backendId|algorithm|phaseRadians/u);
    const metadata = reviewedView?.metadata as Record<string, unknown>;
    expect((metadata.quality as Record<string, unknown>).unexpected_global_change_ratio)
      .toBeGreaterThan(0.005);
  });
});
