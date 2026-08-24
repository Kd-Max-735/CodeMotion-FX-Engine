import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import type {
  ObservedMotionSelfCheckArtifacts,
  ObservedMotionSelfCheckRequest
} from "../../src/observed-motion-self-check.js";

export interface TestPose {
  readonly x?: number;
  readonly y?: number;
  readonly scale?: number;
  readonly angle?: number;
  readonly opacity?: number;
}

export function testFrame(width: number, height: number, pose: TestPose): Buffer {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#101722";
  context.fillRect(0, 0, width, height);
  context.save();
  context.globalAlpha = pose.opacity ?? 1;
  context.translate(width * (0.5 + (pose.x ?? 0)), height * (0.54 + (pose.y ?? 0)));
  context.rotate(pose.angle ?? 0);
  context.scale(pose.scale ?? 1, pose.scale ?? 1);
  context.fillStyle = "#f08a35";
  context.fillRect(-width * 0.18, -height * 0.22, width * 0.36, height * 0.44);
  context.fillStyle = "#f7f1dc";
  context.fillRect(-width * 0.13, -height * 0.15, width * 0.08, height * 0.1);
  context.fillStyle = "#57c6d4";
  context.fillRect(width * 0.02, height * 0.04, width * 0.12, height * 0.12);
  context.restore();
  return canvas.toBuffer("image/png");
}

export async function runObservedFixture(
  run: (request: ObservedMotionSelfCheckRequest) => Promise<ObservedMotionSelfCheckArtifacts>,
  render: (time: number, duration: number, width: number, height: number) => Buffer,
  userRequest: string
): Promise<Readonly<{
  artifacts: ObservedMotionSelfCheckArtifacts;
  macro: Readonly<Record<string, unknown>>;
  keyframes: readonly Readonly<Record<string, unknown>>[];
}>> {
  const directory = await mkdtemp(join(tmpdir(), "cmfx-independent-self-check-"));
  const duration = 2;
  const artifacts = await run({
    requestId: "request-test",
    tenantId: "tenant-test",
    userId: "user-test",
    userRequest,
    videoPath: join(directory, "final.mp4"),
    fileName: "final.mp4",
    outputDirectory: directory,
    width: 200,
    height: 120,
    fps: 30,
    durationSeconds: duration,
    frameCount: 60,
    bytes: 4096,
    reviewer: {
      review: async (request) => Object.freeze({
        status: "pass" as const,
        summary: "最终成片的专属运动证据符合验收规则。",
        checks: Object.freeze(request.ruleIds.map((ruleId) => Object.freeze({
          ruleId,
          status: "pass" as const,
          evidenceRefs: Object.freeze(["keyframe_contact_sheet"]),
          reason: "最终 MP4 关键帧与用户要求一致。"
        }))),
        issues: Object.freeze([])
      })
    },
    frameExtractor: async (_input, output, width, height, time) => {
      await writeFile(output, render(time, duration, width, height));
    }
  });
  if (artifacts.view.macroView === undefined) throw new Error("macro view was not generated");
  const macro = artifacts.view.macroView;
  const metadata = macro.metadata as Readonly<Record<string, unknown>>;
  const evidence = metadata.keyframe_evidence as Readonly<Record<string, unknown>>;
  const keyframes = evidence.keyframes as readonly Readonly<Record<string, unknown>>[];
  const boardPath = artifacts.evidenceFiles.get("keyframe_contact_sheet");
  if (boardPath === undefined) throw new Error("contact sheet was not generated");
  const board = await loadImage(boardPath);
  if (board.width < 500 || board.height < 200) throw new Error("contact sheet is not readable");
  const serialized = JSON.stringify(macro);
  if (/backend|algorithm|sampling|trajectory|resource|asset_|tenant-test|user-test/iu.test(serialized)) {
    throw new Error("public self-check JSON leaked internal information");
  }
  await readFile(boardPath);
  return Object.freeze({ artifacts, macro, keyframes });
}
