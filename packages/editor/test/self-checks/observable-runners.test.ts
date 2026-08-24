import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  runNoiseFieldSelfCheck,
  runParticleDissolveSelfCheck,
  runParticleEmitterSelfCheck,
  runParticleFlowFieldSelfCheck,
  runParticleLogoAssembleSelfCheck,
  runParticleOrbitFieldSelfCheck,
  runParticleSnowRainSelfCheck,
  runParticleSparkSelfCheck,
  runParticleTrailSelfCheck,
  runSimCollisionShatterSelfCheck,
  type ObservableFrameObservation,
  type ObservableSelfCheckRequest
} from "../../src/self-checks/index.js";
import { expectNoInternalParticleData, observation } from "./observable-test-helpers.js";
import { effectiveParamsFor } from "../self-check-test-helpers.js";

const runners = [
  ["particle_dissolve", runParticleDissolveSelfCheck, "溶解"],
  ["particle_flow_field", runParticleFlowFieldSelfCheck, "流场"],
  ["particle_orbit_field", runParticleOrbitFieldSelfCheck, "轨道"],
  ["particle_snow_rain", runParticleSnowRainSelfCheck, "粒子"],
  ["particle_spark", runParticleSparkSelfCheck, "火花"],
  ["particle_emitter", runParticleEmitterSelfCheck, "发射"],
  ["particle_logo_assemble", runParticleLogoAssembleSelfCheck, "聚合"],
  ["particle_trail", runParticleTrailSelfCheck, "拖尾"],
  ["noise_field", runNoiseFieldSelfCheck, "噪声"],
  ["sim_collision_shatter", runSimCollisionShatterSelfCheck, "碎裂"]
] as const;

function observations(toolName: string): readonly ObservableFrameObservation[] {
  if (toolName === "particle_dissolve") return [
    observation(0, { activity: 0, sourceRemaining: 1 }),
    observation(5, { activity: 80, sourceRemaining: 0.45, coverage: 0.6 }),
    observation(10, { activity: 0, sourceRemaining: 0 })
  ];
  if (toolName === "particle_logo_assemble") return [
    observation(0, { opacity: 0, spread: 0.8 }),
    observation(5, { opacity: 0.8, spread: 0.35 }),
    observation(10, { opacity: 0.2, spread: 0.08 })
  ];
  if (toolName === "noise_field") return [
    observation(0, { signature: [0.1, 0.2], contrast: 0.08, detail: 0.04 }),
    observation(5, { signature: [0.4, 0.7], contrast: 0.2, detail: 0.15 }),
    observation(10, { signature: [0.2, 0.5], contrast: 0.14, detail: 0.1 })
  ];
  return [observation(0, { activity: 0 }), observation(5, {
    activity: 100, coverage: 0.7, speed: 0.8, angularMotion: toolName.includes("orbit") ? 1 : 0,
    displacement: toolName.includes("shatter") ? 0.8 : undefined
  } as Partial<ObservableFrameObservation>), observation(10, { activity: 20 })];
}

describe("independent observable-effect runners", () => {
  it.each(runners)("%s builds its own public JSON and final-video contact sheet", async (toolName, runner, expectedWord) => {
    const outputDirectory = await mkdtemp(join(tmpdir(), `cmfx-${toolName}-self-check-`));
    const canvas = createCanvas(64, 36);
    const context = canvas.getContext("2d");
    context.fillStyle = "#234c75";
    context.fillRect(0, 0, 64, 36);
    const png = canvas.toBuffer("image/png");
    let reviewedView: Readonly<Record<string, unknown>> | undefined;
    const request: ObservableSelfCheckRequest = {
      requestId: `request-${toolName}`,
      tenantId: "tenant-test",
      userId: "user-test",
      userRequest: `生成${expectedWord}效果`,
      videoPath: join(outputDirectory, "final.mp4"),
      fileName: `${toolName}.mp4`,
      outputDirectory,
      width: 64,
      height: 36,
      fps: 10,
      durationSeconds: 1.1,
      frameCount: 11,
      bytes: 2048,
      effectiveParams: effectiveParamsFor(toolName),
      observations: observations(toolName),
      frameExtractor: async (_input, output) => { await writeFile(output, png); },
      reviewer: { review: async (reviewRequest) => {
        reviewedView = reviewRequest.acceptanceView;
        return {
          status: "pass" as const,
          summary: `${expectedWord}效果符合要求。`,
          checks: ["DELIVERY_QUALITY", "EFFECT_APPEARANCE", "TEMPORAL_PROCESS", "USER_INTENT", "VISUAL_SAFETY"].map((ruleId) => ({
            ruleId, status: "pass" as const, evidenceRefs: ["self_check_view"], reason: "证据完整。"
          })) as never,
          issues: []
        };
      } } as never
    };
    const artifacts = await runner(request);
    expect(artifacts.view).toMatchObject({ status: "pass", toolName, evidenceStatus: "sufficient" });
    expect(artifacts.evidenceFiles.has("keyframe_contact_sheet")).toBe(true);
    expect(reviewedView).toBeDefined();
    expect(Object.keys(reviewedView!).sort()).toEqual(["file_name", "metadata", "original_request", "summary"]);
    expect(JSON.stringify(reviewedView)).toContain(expectedWord);
    expectNoInternalParticleData(JSON.stringify(reviewedView));
  });
});
