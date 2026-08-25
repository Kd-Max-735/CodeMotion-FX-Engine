import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { EFFECT_TOOL_REGISTRY } from "@codemotion/effect-functions";
import { describe, expect, it } from "vitest";
import { runChalkStrokeSelfCheck } from "../src/chalk-stroke-self-check.js";
import { runDashFlowSelfCheck } from "../src/dash-flow-self-check.js";
import { runDepthOfFieldSelfCheck } from "../src/depth-of-field-self-check.js";
import { runDollyZoomSelfCheck } from "../src/dolly-zoom-self-check.js";
import { runMarkerStrokeSelfCheck } from "../src/marker-stroke-self-check.js";
import { runRadialWipeSelfCheck } from "../src/radial-wipe-self-check.js";
import { runShakeSelfCheck } from "../src/shake-self-check.js";
import { runSimClothSelfCheck } from "../src/sim-cloth-self-check.js";
import { runSimRigidBody2dSelfCheck } from "../src/sim-rigid-body-2d-self-check.js";
import { runSimRopeSelfCheck } from "../src/sim-rope-self-check.js";
import { importantParameterDefinitions } from "../src/self-check-parameter-summary.js";
import type { EffectSelfCheckRequest } from "../src/ten-tool-self-check-io.js";

const CASES = Object.freeze([
  ["chalk_stroke", runChalkStrokeSelfCheck], ["dash_flow", runDashFlowSelfCheck],
  ["depth_of_field", runDepthOfFieldSelfCheck], ["dolly_zoom", runDollyZoomSelfCheck],
  ["marker_stroke", runMarkerStrokeSelfCheck], ["radial_wipe", runRadialWipeSelfCheck],
  ["shake", runShakeSelfCheck], ["sim_cloth", runSimClothSelfCheck],
  ["sim_rigid_body_2d", runSimRigidBody2dSelfCheck], ["sim_rope", runSimRopeSelfCheck]
] as const);

async function frame(path: string, width: number, height: number, time: number, baseline: boolean): Promise<void> {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#26354a";
  context.fillRect(0, 0, width, height);
  if (!baseline) {
    const x = Math.round((0.15 + time * 0.09 % 0.55) * width);
    context.fillStyle = "#f4cf63";
    context.fillRect(x, Math.round(height * 0.2), Math.max(4, Math.round(width * 0.24)), Math.round(height * 0.55));
  }
  await writeFile(path, canvas.toBuffer("image/png"));
}

describe("ten shared-frame self-check tools", () => {
  for (const [toolName, runner] of CASES) {
    it(`${toolName} sends its real parameter view and keyframes through the unified reviewer`, async () => {
      const outputDirectory = await mkdtemp(join(tmpdir(), `cmfx-${toolName}-`));
      const baselineVideoPath = join(outputDirectory, "baseline.mp4");
      const effectiveParams = EFFECT_TOOL_REGISTRY.getByToolName(toolName)!.defaults;
      let reviewed = false;
      const request: EffectSelfCheckRequest<typeof toolName> = {
        requestId: `request-${toolName}`,
        tenantId: "tenant-test",
        userId: "user-test",
        toolName,
        userRequest: `生成${toolName}效果`,
        effectiveParams,
        videoPath: join(outputDirectory, "output.mp4"),
        baselineVideoPath,
        outputDirectory,
        width: 96,
        height: 54,
        fps: 12,
        durationSeconds: 1,
        frameCount: 12,
        bytes: 2_048,
        frameExtractor: async (input, output, width, height, time) =>
          frame(output, width, height, time, input === baselineVideoPath),
        reviewer: {
          review: async ({ ruleIds, acceptanceView }) => {
            reviewed = true;
            const summary = acceptanceView.summary as { key_information: Record<string, unknown> };
            expect(Object.keys(summary.key_information)).toEqual(importantParameterDefinitions(toolName).map(([name]) => name));
            return {
              status: "pass",
              summary: "关键帧显示效果符合用户要求。",
              checks: ruleIds.map((ruleId) => ({ ruleId, status: "pass" as const,
                evidenceRefs: ["self_check_view", "keyframe_contact_sheet"], reason: "最终成片证据支持该项判断。" })),
              issues: []
            };
          }
        }
      };
      const artifacts = await (runner as (value: EffectSelfCheckRequest<typeof toolName>) => ReturnType<typeof runner>)(request);
      expect(reviewed).toBe(true);
      expect(artifacts.view).toMatchObject({ status: "pass", toolName, result: { status: "pass" } });
      expect(artifacts.evidenceFiles.has("keyframe_contact_sheet")).toBe(true);
    });
  }
});
