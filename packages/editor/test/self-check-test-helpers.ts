import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import {
  EFFECT_TOOL_REGISTRY,
  validateAndNormalizeEffectEnvelope
} from "@codemotion/effect-functions";

export function effectiveParamsFor(
  toolName: string,
  overrides: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  const definition = EFFECT_TOOL_REGISTRY.getByToolName(toolName);
  if (definition === undefined) throw new TypeError(`Unknown effect tool: ${toolName}`);
  return validateAndNormalizeEffectEnvelope(definition, toolName, {
    type: toolName,
    data: Object.freeze({ ...definition.defaults, ...overrides })
  }).data;
}

export async function selfCheckFixture<Params extends Readonly<Record<string, unknown>>>(
  toolName: string,
  params: Params,
  options: Readonly<{ durationSeconds?: number; failValidation?: boolean; freezeWindow?: readonly [number, number] }> = {}
) {
  const outputDirectory = await mkdtemp(join(tmpdir(), `cmfx-${toolName}-self-check-`));
  const durationSeconds = options.durationSeconds ?? 5;
  return {
    userRequest: `请生成${toolName}专属效果`,
    videoPath: join(outputDirectory, "final.mp4"),
    fileName: `${toolName}-final.mp4`,
    outputDirectory,
    width: 320,
    height: 180,
    fps: 30,
    durationSeconds,
    frameCount: Math.round(durationSeconds * 30),
    bytes: 4096,
    params,
    videoValidator: async () => {
      if (options.failValidation === true) throw new Error("corrupt stream");
    },
    frameExtractor: async (
      _inputPath: string,
      outputPath: string,
      width: number,
      height: number,
      time: number
    ) => {
      const canvas = createCanvas(width, height);
      const context = canvas.getContext("2d");
      const inFreeze = options.freezeWindow !== undefined
        && time >= options.freezeWindow[0] && time <= options.freezeWindow[1];
      const phase = inFreeze ? 91 : Math.round(time * 97);
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, `rgb(${40 + phase % 90}, ${25 + phase % 60}, ${90 + phase % 100})`);
      gradient.addColorStop(1, `rgb(${140 + phase % 80}, ${80 + phase % 90}, ${30 + phase % 70})`);
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      context.fillStyle = "rgba(255,255,255,0.75)";
      for (let index = 0; index < 8; index += 1) {
        const offset = (phase + index * 37) % Math.max(1, width - 25);
        context.fillRect(offset, index * Math.max(2, height / 9), 22 + index * 3, 5 + index % 3);
      }
      await writeFile(outputPath, canvas.toBuffer("image/png"));
    }
  } as const;
}
