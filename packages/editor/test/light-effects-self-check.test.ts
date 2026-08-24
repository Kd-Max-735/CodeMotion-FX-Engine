import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { runAuraFieldSelfCheck, auraFieldSamplingPlan } from "../src/aura-field-self-check.js";
import { runGradientFlowSelfCheck, gradientFlowSamplingPlan } from "../src/gradient-flow-self-check.js";
import { runNeonGlowSelfCheck, neonGlowSamplingPlan } from "../src/neon-glow-self-check.js";
import { runEnergyPulseSelfCheck, energyPulseSamplingPlan } from "../src/energy-pulse-self-check.js";
import { runLensFlareSelfCheck } from "../src/lens-flare-self-check.js";
import { runNeonTraceSelfCheck, neonTraceSamplingPlan } from "../src/neon-trace-self-check.js";
import { runSacredGeometrySelfCheck } from "../src/sacred-geometry-self-check.js";
import { runScanBeamSelfCheck, scanBeamSamplingPlan } from "../src/scan-beam-self-check.js";
import { runVolumetricRaySelfCheck } from "../src/volumetric-ray-self-check.js";
import { runHologramSelfCheck, hologramSamplingPlan } from "../src/hologram-self-check.js";
import type { FinalVideoSelfCheckArtifacts, FinalVideoSelfCheckRequest } from "../src/final-video-self-check.js";

type ToolName = FinalVideoSelfCheckRequest["envelope"]["type"];
type Runner = (request: FinalVideoSelfCheckRequest) => Promise<FinalVideoSelfCheckArtifacts>;

const CASES: readonly Readonly<{
  toolName: ToolName;
  runner: Runner;
  params: Readonly<Record<string, unknown>>;
  expectedLabels: readonly string[];
}>[] = Object.freeze([
  { toolName: "aura_field", runner: runAuraFieldSelfCheck, params: { intensity: 0.7, pulseRate: 1, centerX: 0.5, centerY: 0.5 }, expectedLabels: ["实际亮度", "实际光场位置", "呼吸表现"] },
  { toolName: "gradient_flow", runner: runGradientFlowSelfCheck, params: { intensity: 0.6, speed: 0.7 }, expectedLabels: ["色彩表现", "传播方向", "流动速度"] },
  { toolName: "neon_glow", runner: runNeonGlowSelfCheck, params: { intensity: 2, flicker: 0.5 }, expectedLabels: ["霓虹颜色", "光晕范围", "时间表现"] },
  { toolName: "energy_pulse", runner: runEnergyPulseSelfCheck, params: { radius: 0.7, rings: 3, center: [0.5, 0.5] }, expectedLabels: ["脉冲中心", "传播方向", "脉冲阶段"] },
  { toolName: "lens_flare", runner: runLensFlareSelfCheck, params: { source: [0.72, 0.28], ghosts: 3, streak: 0.4, chromatic: 0.1 }, expectedLabels: ["光源位置", "鬼影表现", "镜头条纹"] },
  { toolName: "neon_trace", runner: runNeonTraceSelfCheck, params: { intensity: 2, progress: 1, pulseRate: 1, startX: 0.15, startY: 0.55 }, expectedLabels: ["路径起始区域", "追踪方向", "显现与保留"] },
  { toolName: "sacred_geometry", runner: runSacredGeometrySelfCheck, params: { speed: 0.2 }, expectedLabels: ["几何位置", "层次与密度", "对称表现"] },
  { toolName: "scan_beam", runner: runScanBeamSelfCheck, params: { speed: 0.8 }, expectedLabels: ["光束朝向", "扫描方向", "扫描速度"] },
  { toolName: "volumetric_ray", runner: runVolumetricRaySelfCheck, params: { exposure: 1, weight: 0.2, flowSpeed: 0.5, lightX: 0.5, lightY: 0.1 }, expectedLabels: ["光束朝向", "光束层次", "内部流动"] },
  { toolName: "hologram", runner: runHologramSelfCheck, params: { brightness: 1.4, opacity: 0.72, scanline: 0.7, flicker: 0.3, glitch: 0.3 }, expectedLabels: ["扫描表现", "全息抖动", "深度层次"] }
]);

function base(context: SKRSContext2D, width: number, height: number): void {
  context.fillStyle = "#20283a";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#3b465d";
  context.fillRect(width * 0.28, height * 0.25, width * 0.44, height * 0.5);
}

function effectFrame(toolName: ToolName, width: number, height: number, time: number, baseline: boolean): Buffer {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  base(context, width, height);
  if (baseline) return canvas.toBuffer("image/png");
  const phase = time * Math.PI * 2;
  if (toolName === "aura_field") {
    const gradient = context.createRadialGradient(width * (0.5 + Math.sin(phase) * 0.025), height * 0.5, 2, width * 0.5, height * 0.5, width * 0.42);
    gradient.addColorStop(0, `rgba(220,90,255,${0.72 + Math.sin(phase) * 0.12})`);
    gradient.addColorStop(1, "rgba(30,220,255,0)");
    context.fillStyle = gradient; context.fillRect(0, 0, width, height);
  } else if (toolName === "gradient_flow") {
    const offset = (time * 0.22) % 1;
    const gradient = context.createLinearGradient(-width * offset, 0, width * (1 - offset), height);
    gradient.addColorStop(0, "rgba(30,255,170,0.72)"); gradient.addColorStop(0.5, "rgba(30,150,255,0.68)"); gradient.addColorStop(1, "rgba(220,40,255,0.7)");
    context.fillStyle = gradient; context.fillRect(0, 0, width, height);
  } else if (toolName === "neon_glow") {
    context.shadowColor = "#35ddff"; context.shadowBlur = width * 0.09;
    context.strokeStyle = `rgba(80,240,255,${0.75 + Math.sin(phase * 3) * 0.2})`; context.lineWidth = 4;
    context.strokeRect(width * 0.29, height * 0.26, width * 0.42, height * 0.48);
  } else if (toolName === "energy_pulse") {
    const progress = (time % 1.4) / 1.4;
    context.strokeStyle = `rgba(165,90,255,${Math.sin(Math.PI * progress)})`; context.lineWidth = 3 + progress * 5;
    context.beginPath(); context.arc(width * 0.5, height * 0.5, Math.max(2, progress * width * 0.42), 0, Math.PI * 2); context.stroke();
  } else if (toolName === "lens_flare") {
    context.fillStyle = "rgba(255,238,170,0.9)"; context.beginPath(); context.arc(width * 0.72, height * 0.28, 8, 0, Math.PI * 2); context.fill();
    context.fillStyle = "rgba(255,150,110,0.45)";
    for (const [x, y, r] of [[0.61, 0.37, 5], [0.5, 0.46, 7], [0.4, 0.55, 4]] as const) { context.beginPath(); context.arc(width * x, height * y, r, 0, Math.PI * 2); context.fill(); }
    context.fillStyle = "rgba(255,210,150,0.25)"; context.fillRect(width * 0.15, height * 0.275, width * 0.75, 2);
  } else if (toolName === "neon_trace") {
    const progress = Math.min(1, time / 1.4);
    context.shadowColor = "#35eaff"; context.shadowBlur = 10; context.strokeStyle = "#8ff8ff"; context.lineWidth = 3;
    context.beginPath(); context.moveTo(width * 0.15, height * 0.58); context.quadraticCurveTo(width * 0.5, height * 0.2, width * (0.15 + 0.7 * progress), height * (0.58 - 0.08 * progress)); context.stroke();
  } else if (toolName === "sacred_geometry") {
    context.save(); context.translate(width / 2, height / 2); context.rotate(time * 0.2); context.strokeStyle = "#ffd166"; context.lineWidth = 1.5;
    for (let ring = 1; ring <= 3; ring += 1) for (let index = 0; index < 6; index += 1) { const angle = index * Math.PI / 3; context.beginPath(); context.arc(Math.cos(angle) * ring * 8, Math.sin(angle) * ring * 8, 13, 0, Math.PI * 2); context.stroke(); }
    context.restore();
  } else if (toolName === "scan_beam") {
    const center = ((time * 0.8) % 1) * width; const gradient = context.createLinearGradient(center - 18, 0, center + 18, 0);
    gradient.addColorStop(0, "rgba(80,220,255,0)"); gradient.addColorStop(0.5, "rgba(120,240,255,0.9)"); gradient.addColorStop(1, "rgba(80,220,255,0)"); context.fillStyle = gradient; context.fillRect(center - 20, 0, 40, height);
  } else if (toolName === "volumetric_ray") {
    context.fillStyle = `rgba(255,235,175,${0.24 + Math.sin(phase) * 0.03})`;
    context.beginPath(); context.moveTo(width * 0.5, 0); context.lineTo(width * 0.12, height); context.lineTo(width * 0.46, height); context.closePath(); context.fill();
    context.beginPath(); context.moveTo(width * 0.56, 0); context.lineTo(width * 0.54, height); context.lineTo(width * 0.86, height); context.closePath(); context.fill();
  } else if (toolName === "hologram") {
    const offset = Math.sin(phase * 4) * 2; context.fillStyle = `rgba(20,235,255,${0.35 + Math.sin(phase * 2) * 0.08})`;
    context.fillRect(width * 0.27 + offset, height * 0.2, width * 0.46, height * 0.62);
    context.strokeStyle = "rgba(180,255,255,0.72)"; context.lineWidth = 1;
    for (let y = height * 0.22; y < height * 0.8; y += 5) { context.beginPath(); context.moveTo(width * 0.27 + offset, y); context.lineTo(width * 0.73 + offset, y); context.stroke(); }
  }
  return canvas.toBuffer("image/png");
}

async function runCase(entry: typeof CASES[number], userRequest = `测试 ${entry.toolName} 的实际成片表现`) {
  const outputDirectory = await mkdtemp(join(tmpdir(), `cmfx-${entry.toolName}-`));
  const videoPath = join(outputDirectory, "output.mp4");
  const baselineVideoPath = join(outputDirectory, "baseline.mp4");
  const artifacts = await entry.runner({
    userRequest,
    envelope: { type: entry.toolName, data: entry.params },
    videoPath,
    fileName: `${entry.toolName}.mp4`,
    baselineVideoPath,
    outputDirectory,
    width: 160,
    height: 90,
    fps: 30,
    durationSeconds: 3,
    frameCount: 90,
    bytes: 2048,
    frameExtractor: async (inputPath, outputPath, width, height, time) => {
      await writeFile(outputPath, effectFrame(entry.toolName, width, height, time, inputPath === baselineVideoPath));
    }
  });
  return artifacts;
}

describe("ten independent final-MP4 light-effect self-check functions", () => {
  for (const entry of CASES) {
    it(`${entry.toolName} creates its dedicated compact JSON and contact sheet`, async () => {
      const artifacts = await runCase(entry);
      expect(artifacts.view.evidenceStatus).toBe("sufficient");
      expect(artifacts.view.toolName).toBe(entry.toolName);
      expect(artifacts.view.evidenceImages).toHaveLength(1);
      expect(artifacts.view.evidenceImages[0]?.evidenceId).toBe("keyframe_contact_sheet");
      expect(artifacts.view.macroView).toBeDefined();
      expect(Object.keys(artifacts.view.macroView!)).toEqual(["file_name", "original_request", "summary", "metadata"]);
      const summary = artifacts.view.macroView!.summary as { key_information: readonly { label: string }[] };
      for (const label of entry.expectedLabels) expect(summary.key_information.map((item) => item.label)).toContain(label);
      const metadata = artifacts.view.macroView!.metadata as { keyframe_evidence: { image_count: number } };
      expect(metadata.keyframe_evidence.image_count).toBeGreaterThanOrEqual(2);
      expect(metadata.keyframe_evidence.image_count).toBeLessThanOrEqual(8);
      const serialized = JSON.stringify(artifacts.view.macroView);
      expect(serialized).not.toMatch(/backend|algorithm|threshold|normalizedParams|resourceId|[A-Za-z]:\\|\/tmp\//u);
      expect(artifacts.jsonFile).toBeTypeOf("string");
      expect(Object.keys(JSON.parse(await readFile(artifacts.jsonFile!, "utf8")) as object))
        .toEqual(["file_name", "original_request", "summary", "metadata"]);
    });
  }

  it("uses effect-specific non-fixed sampling plans", () => {
    expect(auraFieldSamplingPlan(3, 30, { pulseRate: 0 })).toHaveLength(3);
    expect(auraFieldSamplingPlan(3, 30, { pulseRate: 1 })).toHaveLength(15);
    expect(gradientFlowSamplingPlan(3, 30, { speed: 0 })).toHaveLength(3);
    expect(gradientFlowSamplingPlan(3, 30, { speed: 1 })).toHaveLength(16);
    expect(neonGlowSamplingPlan(3, 30, { flicker: 0.5 })).toHaveLength(13);
    expect(energyPulseSamplingPlan(3, 30, { rings: 3 })).toHaveLength(13);
    expect(neonTraceSamplingPlan(3, 30).map((item) => item.role)).toContain("追踪完成");
    expect(scanBeamSamplingPlan(3, 30, { speed: 0 })).toHaveLength(3);
    expect(scanBeamSamplingPlan(3, 30, { speed: 1 })).toHaveLength(17);
    expect(hologramSamplingPlan(3, 30, { scanline: 0, flicker: 0, glitch: 0 })).toHaveLength(5);
  });

  it("fails aura_field when the observed location conflicts with an explicit requested corner", async () => {
    const entry = CASES.find((item) => item.toolName === "aura_field")!;
    const artifacts = await runCase(entry, "让光场位于右上角");
    const information = (artifacts.view.macroView!.summary as {
      key_information: readonly { label: string; value: string }[];
    }).key_information;

    expect(artifacts.view.status).toBe("fail");
    expect(information).toEqual(expect.arrayContaining([
      { label: "用户要求位置", value: "右上角" },
      { label: "实际光场位置", value: "中央中部" },
      { label: "位置要求匹配", value: "不一致：要求右上角，实际为中央中部" }
    ]));
    expect(artifacts.view.result?.checks).toContainEqual(expect.objectContaining({
      ruleId: "AURA_FIELD_REQUESTED_LOCATION",
      status: "fail"
    }));
  });

  it("protects normal neon, pulse, scan and hologram motion from false flicker failures", async () => {
    for (const toolName of ["neon_glow", "energy_pulse", "scan_beam", "hologram"] as const) {
      const artifacts = await runCase(CASES.find((entry) => entry.toolName === toolName)!);
      const guard = artifacts.view.result?.checks.find((item) => /PROTECTION|GUARD/u.test(item.ruleId));
      expect(guard, toolName).toMatchObject({ status: "pass" });
      const quality = (artifacts.view.macroView!.metadata as { quality: { unexpected_flicker: string } }).quality;
      expect(quality.unexpected_flicker, toolName).toMatch(/未|正常|属于|处理/u);
    }
  });
});
