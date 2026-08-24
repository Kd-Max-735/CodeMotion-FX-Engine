import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { runBeatPulseSelfCheck } from "../../src/self-check/beat-pulse-self-check.js";
import { runKineticTypographySelfCheck } from "../../src/self-check/kinetic-typography-self-check.js";
import { runNumberCounterSelfCheck } from "../../src/self-check/number-counter-self-check.js";
import { runOnsetTriggerSelfCheck } from "../../src/self-check/onset-trigger-self-check.js";
import { runPathTrimSelfCheck } from "../../src/self-check/path-trim-self-check.js";
import { runSpectrumBarsSelfCheck } from "../../src/self-check/spectrum-bars-self-check.js";
import { runTextMorphSelfCheck } from "../../src/self-check/text-morph-self-check.js";
import { runTypewriterSelfCheck } from "../../src/self-check/typewriter-self-check.js";
import { runVocalReactiveTextSelfCheck } from "../../src/self-check/vocal-reactive-text-self-check.js";
import { runWaveformSelfCheck } from "../../src/self-check/waveform-self-check.js";
import { EffectToolVideoService } from "../../src/effect-tool-video-service.js";
import { runListedToolSelfCheck } from "../../src/self-check/listed-tool-self-check.js";
import { importantParameterDefinitions } from "../../src/self-check-parameter-summary.js";
import type { EffectToolDefinition } from "@codemotion/effect-functions";
import type {
  ObservedSelfCheckArtifacts,
  ObservedSelfCheckToolName,
  ObservedVideoSelfCheckRequest
} from "../../src/self-check/observed-video-self-check.js";

type Runner = (request: ObservedVideoSelfCheckRequest) => Promise<ObservedSelfCheckArtifacts>;

const CASES: readonly Readonly<{
  toolName: ObservedSelfCheckToolName;
  runner: Runner;
  request: string;
  params: Readonly<Record<string, unknown>>;
  factKeys: readonly string[];
}>[] = Object.freeze([
  { toolName: "beat_pulse", runner: runBeatPulseSelfCheck, request: "让画面跟随节拍产生清晰脉冲",
    params: {}, factKeys: ["visible_pulse_count", "strength_matches_request", "recovery_between_pulses"] },
  { toolName: "onset_trigger", runner: runOnsetTriggerSelfCheck, request: "每次起音产生一次清晰冲击",
    params: {}, factKeys: ["visible_trigger_count", "post_trigger_recovery"] },
  { toolName: "spectrum_bars", runner: runSpectrumBarsSelfCheck, request: "显示持续跳动的多柱频谱",
    params: {}, factKeys: ["visible_bar_groups", "height_range"] },
  { toolName: "vocal_reactive_text", runner: runVocalReactiveTextSelfCheck, request: "让 VOICE 随人声呼吸",
    params: {}, factKeys: ["visible_content", "response_dimension", "quiet_state", "active_state"] },
  { toolName: "waveform", runner: runWaveformSelfCheck, request: "显示随音频变化的连续波形",
    params: {}, factKeys: ["trace_count", "vertical_extent_range", "continuity"] },
  { toolName: "number_counter", runner: runNumberCounterSelfCheck, request: "从 0 滚动到 100 并完整停留",
    params: { fromValue: 0, toValue: 100, format: "integer", duration: 1.5 },
    factKeys: ["visible_sequence", "start_value", "end_value", "complete", "rhythm"] },
  { toolName: "typewriter", runner: runTypewriterSelfCheck, request: "逐字显示测试文字并保留游标",
    params: { text: "测试文字", speed: 4, cursor: true },
    factKeys: ["visible_content", "reveal_order", "stage_sequence", "complete", "cursor_visible"] },
  { toolName: "text_morph", runner: runTextMorphSelfCheck, request: "把 CODE 变形成 MOTION",
    params: { sourceText: "CODE", targetText: "MOTION", duration: 1.5 },
    factKeys: ["source_content", "target_content", "morph_sequence", "transition_state", "complete"] },
  { toolName: "kinetic_typography", runner: runKineticTypographySelfCheck, request: "让动感排版有三次明显跳动",
    params: { text: "动感排版", jumpDuration: 1.5 },
    factKeys: ["visible_content", "layout_motion", "scale_rhythm", "readability"] },
  { toolName: "path_trim", runner: runPathTrimSelfCheck, request: "从左到右连续显现主体路径",
    params: { mode: "reveal", direction: "left_to_right", duration: 1.5 },
    factKeys: ["visible_path_progression", "direction", "coverage_change", "stroke_continuity", "complete"] }
]);

function drawFixture(toolName: ObservedSelfCheckToolName, time: number): Buffer {
  const width = 320;
  const height = 180;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#07101f";
  context.fillRect(0, 0, width, height);
  const phase = Math.max(0, time);
  context.strokeStyle = "#5cf4ff";
  context.fillStyle = "#ff5ca8";
  context.lineWidth = 4;
  if (toolName === "beat_pulse") {
    const pulse = Math.max(0, Math.sin(phase * Math.PI * 4));
    context.beginPath(); context.arc(160, 90, 22 + pulse * 55, 0, Math.PI * 2); context.stroke();
    context.globalAlpha = 0.25 + pulse * 0.75; context.fillRect(145, 75, 30, 30);
  } else if (toolName === "onset_trigger") {
    const burst = Math.max(0, 1 - Math.abs((phase % 0.6) - 0.12) / 0.12);
    for (let index = 0; index < 16; index += 1) {
      const angle = index / 16 * Math.PI * 2;
      context.beginPath(); context.moveTo(160, 90);
      context.lineTo(160 + Math.cos(angle) * (18 + burst * 72), 90 + Math.sin(angle) * (18 + burst * 72));
      context.stroke();
    }
  } else if (toolName === "spectrum_bars") {
    for (let index = 0; index < 16; index += 1) {
      const bar = 12 + (0.5 + 0.5 * Math.sin(phase * 6 + index * 0.9)) * 95;
      context.fillRect(10 + index * 19, 150 - bar, 11, bar);
    }
  } else if (toolName === "vocal_reactive_text") {
    const size = 34 + (0.5 + 0.5 * Math.sin(phase * 5)) * 34;
    context.font = `bold ${size}px sans-serif`; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText("VOICE", 160, 90);
  } else if (toolName === "waveform") {
    context.beginPath();
    for (let x = 0; x < width; x += 1) {
      const y = 90 + Math.sin(x * 0.08 + phase * 8) * (12 + 42 * (0.5 + 0.5 * Math.sin(phase * 3)));
      if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
  } else if (toolName === "number_counter") {
    const value = Math.min(100, Math.round(phase / 1.5 * 100));
    context.font = "bold 62px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(String(value), 160, 82); context.fillRect(40, 135, 240 * value / 100, 8);
  } else if (toolName === "typewriter") {
    const text = [..."测试文字"].slice(0, Math.min(4, Math.floor(phase * 4) + 1)).join("");
    context.font = "bold 48px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(text, 150, 90); context.fillRect(278, 62, 4, 56);
  } else if (toolName === "text_morph") {
    const progress = Math.min(1, phase / 1.5);
    context.globalAlpha = 1 - progress; context.font = "bold 56px sans-serif"; context.textAlign = "center";
    context.fillText("CODE", 160 - progress * 18, 104);
    context.globalAlpha = progress; context.fillText("MOTION", 160 + (1 - progress) * 18, 104);
  } else if (toolName === "kinetic_typography") {
    const size = 40 + Math.abs(Math.sin(phase * Math.PI * 3)) * 32;
    context.font = `bold ${size}px sans-serif`; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText("动感排版", 160 + Math.sin(phase * 5) * 24, 90);
  } else {
    const progress = Math.min(1, phase / 1.5);
    context.beginPath(); context.moveTo(24, 140); context.lineTo(24 + 272 * progress, 40); context.stroke();
    context.globalAlpha = 0.3 + progress * 0.7; context.fillRect(24, 45, 272 * progress, 90);
  }
  return canvas.toBuffer("image/png");
}

async function execute(item: typeof CASES[number]): Promise<ObservedSelfCheckArtifacts> {
  const outputDirectory = await mkdtemp(join(tmpdir(), `cmfx-${item.toolName}-`));
  return item.runner({
    userRequest: item.request,
    videoPath: join(outputDirectory, `${item.toolName}.mp4`),
    outputDirectory,
    width: 320,
    height: 180,
    fps: 20,
    durationSeconds: 2,
    frameCount: 40,
    bytes: 4_096,
    effectParams: item.params,
    frameExtractor: async (_inputPath, outputPath, time) => writeFile(outputPath, drawFixture(item.toolName, time))
  });
}

describe("listed tools final-video self-checks", () => {
  for (const item of CASES) {
    it(`${item.toolName} has an independent function, facts, actual-frame plan, JSON, and contact sheet`, async () => {
      const artifacts = await execute(item);
      expect(artifacts.view).toMatchObject({
        status: "pass",
        toolName: item.toolName,
        evidenceStatus: "sufficient",
        macroView: {
          original_request: item.request,
          metadata: { keyframe_evidence: { coverage: "sufficient" } }
        },
        evidenceImages: [{ evidenceId: "keyframe_contact_sheet" }]
      });
      expect(artifacts.view.failure).toBeUndefined();
      const json = artifacts.view.macroView as Record<string, unknown>;
      expect(Object.keys(json)).toEqual(["file_name", "original_request", "summary", "metadata"]);
      const metadata = json.metadata as Record<string, unknown>;
      const summary = json.summary as {
        key_information: Record<string, { label: string; value: unknown }>;
      };
      expect(Object.keys(summary.key_information)).toEqual(
        importantParameterDefinitions(item.toolName).map(([name]) => name)
      );
      const facts = metadata.observed_effect as Record<string, unknown>;
      for (const factKey of item.factKeys) expect(facts, factKey).toHaveProperty(factKey);
      expect((metadata.keyframe_evidence as { image_count: number }).image_count).toBeGreaterThanOrEqual(2);
      const serialized = JSON.stringify(json);
      expect(serialized).not.toMatch(/audio_analysis|fontHandle|layerHandle|backendId|resourceId|effectId|formula|algorithm/u);
      expect(artifacts.jsonPath).toBeTypeOf("string");
      expect(artifacts.evidenceFiles.get("keyframe_contact_sheet")).toBeTypeOf("string");
    });
  }

  it("exports ten distinct self-check function identities", () => {
    expect(new Set(CASES.map((item) => item.runner)).size).toBe(CASES.length);
  });

  it("fails beat_pulse when an observed obvious pulse conflicts with a weaker request", async () => {
    const base = CASES.find((item) => item.toolName === "beat_pulse")!;
    const artifacts = await execute({ ...base, request: "脉冲强度较弱" });
    const facts = (artifacts.view.macroView!.metadata as {
      observed_effect: Record<string, unknown> & {
        key_information: readonly { label: string; value: string }[];
      };
    }).observed_effect;

    expect(artifacts.view.status).toBe("fail");
    expect(facts.key_information).toEqual(expect.arrayContaining([
      { label: "用户要求强弱", value: "较弱" },
      { label: "实际脉冲强弱", value: "明显" },
      { label: "强弱要求匹配", value: "不一致：要求较弱，实际为明显" }
    ]));
    expect(facts).toMatchObject({ pulse_peak_level: "明显", strength_matches_request: false });
  });

  it("changes typewriter keyframe count with the actual reveal-stage count", async () => {
    const base = CASES.find((item) => item.toolName === "typewriter")!;
    const short = await execute({ ...base, params: { text: "短文", speed: 4, cursor: true } });
    const long = await execute({ ...base, params: { text: "这是一段用于覆盖更多实际显现阶段的较长测试文字", speed: 12, cursor: true } });
    const count = (artifacts: ObservedSelfCheckArtifacts): number => ((artifacts.view.macroView!
      .metadata as Record<string, unknown>).keyframe_evidence as { image_count: number }).image_count;
    expect(count(short)).not.toBe(count(long));
  });

  it("dispatches every listed function only after its MP4 export has completed", async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), "cmfx-listed-service-"));
    type ServiceOptions = ConstructorParameters<typeof EffectToolVideoService>[0];
    type ExportFrames = NonNullable<ServiceOptions["exportFrames"]>;
    const exportFrames = vi.fn(async (options: Parameters<ExportFrames>[0]) => {
      await options.renderFrame({
        frame: 0, time: 0, deltaTime: 1 / 20, fps: 20,
        width: options.preset.settings.width, height: options.preset.settings.height
      }, options.signal);
      await writeFile(options.outputPath, "final-mp4");
      return { outputPath: options.outputPath, frameCount: 1, inspections: [], encoder: "libx264" };
    });
    const calls: ObservedSelfCheckToolName[] = [];
    const listedToolSelfCheckRunner = vi.fn(async (
      toolName: Parameters<typeof runListedToolSelfCheck>[0],
      request: Parameters<typeof runListedToolSelfCheck>[1]
    ): Promise<ObservedSelfCheckArtifacts> => {
      calls.push(toolName);
      expect(exportFrames).toHaveBeenCalled();
      const evidencePath = join(request.outputDirectory, `${toolName}-contact-sheet.png`);
      await writeFile(evidencePath, "png");
      const macroView = Object.freeze({
        file_name: `${toolName}.mp4`, original_request: request.userRequest,
        summary: Object.freeze({ description: toolName }), metadata: Object.freeze({ observed_effect: Object.freeze({}) })
      });
      return Object.freeze({
        view: Object.freeze({
          status: "pass", automatic: true, toolName, evidenceStatus: "sufficient", macroView,
          evidenceImages: Object.freeze([Object.freeze({
            evidenceId: "keyframe_contact_sheet", label: toolName, mime: "image/png", width: 64, height: 36
          })]),
          result: Object.freeze({ status: "pass", summary: "通过", checks: Object.freeze([]), issues: Object.freeze([]) })
        }),
        evidenceFiles: new Map([["keyframe_contact_sheet", evidencePath]])
      });
    });
    const service = new EffectToolVideoService({
      media: { resolve: async () => { throw new Error("prepared task must not resolve media"); } },
      outputRoot,
      exportFrames,
      durationSeconds: 0.05,
      fps: 20,
      gpuSampler: () => new Promise(() => {}),
      listedToolSelfCheckRunner
    });
    const views = [];
    for (const item of CASES) {
      const definition = {
        effectId: `fx.test.${item.toolName}`,
        toolName: item.toolName,
        displayName: item.toolName,
        version: "1.0.0",
        category: "test",
        parameterSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
        defaults: {}, presets: [], inputSlots: [],
        primaryBackend: { backendId: "test-cpu", kind: "cpu", determinism: "deterministic" },
        fallbackStrategy: { kind: "reject", reason: "test" },
        performanceGrade: "light",
        normalizeParams: (params: Readonly<Record<string, unknown>>) => params,
        validateParams: () => ({ valid: true }),
        render: () => ({ kind: "metadata", backendId: "test-cpu", output: {}, degraded: false, warnings: [] })
      } as unknown as EffectToolDefinition;
      views.push(await service.createPrepared(
        { tenantId: "tenant-test", userId: "user-test" }, definition,
        { type: item.toolName, data: {} }, {}, [], 7, 0.05, 64, 36,
        undefined, 20, undefined, false, item.request
      ));
    }
    for (const view of views) {
      for (let attempt = 0; attempt < 1_000 && service.get(
        { tenantId: "tenant-test", userId: "user-test" }, view.id
      ).selfCheck?.status !== "pass"; attempt += 1) await new Promise<void>((resolve) => setImmediate(resolve));
      const finalView = service.get({ tenantId: "tenant-test", userId: "user-test" }, view.id);
      expect(finalView.selfCheck, JSON.stringify({ finalView, calls }))
        .toMatchObject({ status: "pass", toolName: view.toolName });
    }
    expect(calls).toEqual(CASES.map((item) => item.toolName));
    expect(listedToolSelfCheckRunner).toHaveBeenCalledTimes(CASES.length);
    await service.close();
  });
});
