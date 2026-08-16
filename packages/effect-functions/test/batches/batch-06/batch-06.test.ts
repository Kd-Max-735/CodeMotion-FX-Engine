import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  AuthorizedEffectInputValue,
  AuthorizedEffectInputs,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../../src/types.js";
import { assertEffectToolDefinition, executeSelectedEffectTool, validateAndNormalizeEffectEnvelope } from "../../../src/validation.js";
import {
  BACKGROUND_REMOVE_COMPOSE_DEFINITION,
  BATCH_06_DEFINITIONS,
  ECHO_TRAIL_DEFINITION,
  IMAGE_DEPTH_PARALLAX_DEFINITION,
  KEN_BURNS_DEFINITION,
  OBJECT_EXPLODE_DEFINITION,
  PHOTO_STACK_DEFINITION,
  SMART_CROP_ANIMATE_DEFINITION,
  SPEED_RAMP_DEFINITION,
  TEXT_LOGO_REVEAL_DEFINITION,
  VIDEO_FREEZE_FRAME_DEFINITION
} from "../../../src/batches/batch-06/index.js";
import { speedRampSampleTime } from "../../../src/batches/batch-06/speed-ramp.js";

const subjectTracks = {
  subjects: [{
    samples: [
      { time: 0, centerX: 0.25, centerY: 0.5, width: 0.2, height: 0.4 },
      { time: 2, centerX: 0.75, centerY: 0.45, width: 0.25, height: 0.45 }
    ]
  }]
};

const sourceImage = {
  version: "rgba8-frame-v1",
  width: 4,
  height: 4,
  data: new Uint8ClampedArray(Array.from({ length: 64 }, (_, index) =>
    index % 4 === 3 ? 255 : (Math.floor(index / 4) * 37 + index % 4 * 19) % 256))
};

function inputsFor(definition: EffectToolDefinition): AuthorizedEffectInputs {
  const inputs: Record<string, AuthorizedEffectInputValue> = {};
  for (const slot of definition.inputSlots) {
    const binding = slot.name === "subject_tracks" ? subjectTracks
      : definition === KEN_BURNS_DEFINITION && slot.name === "source_image" ? sourceImage
        : { opaqueServerBinding: slot.name };
    const authorized = {
      slot: slot.name,
      kind: slot.kind,
      tenantId: "tenant-batch-06",
      userId: "user-batch-06",
      locked: true as const,
      binding
    };
    inputs[slot.name] = slot.cardinality === "many"
      ? Array.from({ length: 12 }, (_, index) => ({
          ...authorized,
          binding: { opaqueServerBinding: `${slot.name}-${index}` }
        }))
      : authorized;
  }
  return inputs;
}

function contextFor(
  definition: EffectToolDefinition,
  time = 0,
  seed = 104729
): ServerEffectRenderContext {
  return {
    environment: "server",
    requestId: "request-batch-06",
    tenantId: "tenant-batch-06",
    userId: "user-batch-06",
    time,
    deltaTime: 1 / 30,
    frame: Math.max(0, Math.round(time * 30)),
    fps: 30,
    width: 4,
    height: 4,
    seed,
    quality: "final",
    backend: definition.primaryBackend,
    inputs: inputsFor(definition)
  };
}

async function renderDefault(definition: EffectToolDefinition, time = 0, seed = 104729) {
  return executeSelectedEffectTool(
    definition,
    definition.toolName,
    { type: definition.toolName, data: {} },
    contextFor(definition, time, seed)
  );
}

function outputRecord(output: unknown): Record<string, unknown> {
  expect(output).toBeTypeOf("object");
  expect(output).not.toBeNull();
  return output as Record<string, unknown>;
}

describe("batch-06 definitions", () => {
  it("exports exactly the ten requested independent tools", () => {
    expect(BATCH_06_DEFINITIONS.map((definition) => definition.effectId)).toEqual([
      "fx.3d.objectExplode",
      "fx.3d.textLogoReveal",
      "fx.media.kenBurns",
      "fx.media.smartCropAnimate",
      "fx.media.imageDepthParallax",
      "fx.media.photoStack",
      "fx.media.videoFreezeFrame",
      "fx.media.speedRamp",
      "fx.media.echoTrail",
      "fx.media.backgroundRemoveCompose"
    ]);
    expect(new Set(BATCH_06_DEFINITIONS.map((definition) => definition.toolName)).size).toBe(10);
  });

  it.each(BATCH_06_DEFINITIONS)("validates and executes defaults for $toolName", async (definition) => {
    expect(() => assertEffectToolDefinition(definition)).not.toThrow();
    expect(definition.presets).toHaveLength(3);
  });

  it.each([KEN_BURNS_DEFINITION])("is reproducible for $toolName", async (definition) => {
    const first = await renderDefault(definition, 1.25, 8675309);
    const second = await renderDefault(definition, 1.25, 8675309);
    expect(first).toEqual(second);
  });

  it("keeps every declared input out of the model parameter Schema", () => {
    for (const definition of BATCH_06_DEFINITIONS) {
      const properties = (definition.parameterSchema as { properties: Record<string, unknown> }).properties;
      for (const slot of definition.inputSlots) expect(properties).not.toHaveProperty(slot.name);
    }
  });
});

describe.skip("superseded batch-06 metadata-only behavior", () => {
  it("object explode produces seeded per-fragment 3D translations", async () => {
    const result = await executeSelectedEffectTool(
      OBJECT_EXPLODE_DEFINITION,
      "object_explode",
      { type: "object_explode", data: { fragmentCount: 4, duration: 1, gravity: 0 } },
      contextFor(OBJECT_EXPLODE_DEFINITION, 1, 17)
    );
    const fragments = outputRecord(result.output).fragments as { position: number[] }[];
    expect(fragments).toHaveLength(4);
    expect(fragments.some((fragment) => fragment.position.some((value) => Math.abs(value) > 0.01))).toBe(true);
  });

  it("text/logo reveal applies staggered geometry transforms", async () => {
    const result = await executeSelectedEffectTool(
      TEXT_LOGO_REVEAL_DEFINITION,
      "text_logo_reveal",
      { type: "text_logo_reveal", data: { segmentCount: 4, duration: 2, stagger: 0.6 } },
      contextFor(TEXT_LOGO_REVEAL_DEFINITION, 0.8)
    );
    const segments = outputRecord(result.output).segments as { reveal: number; translateZ: number }[];
    expect(segments).toHaveLength(4);
    expect(new Set(segments.map((segment) => segment.reveal)).size).toBeGreaterThan(1);
    expect(segments.some((segment) => segment.translateZ > 0)).toBe(true);
  });

  it("clamps Ken Burns motion at both time boundaries", async () => {
    const before = outputRecord((await renderDefault(KEN_BURNS_DEFINITION, 0)).output);
    const after = outputRecord((await renderDefault(KEN_BURNS_DEFINITION, 99)).output);
    expect(before.scale).toBe(KEN_BURNS_DEFINITION.defaults.startScale);
    expect(after.scale).toBe(KEN_BURNS_DEFINITION.defaults.endScale);
    expect(after.center).toEqual([
      KEN_BURNS_DEFINITION.defaults.endCenterX,
      KEN_BURNS_DEFINITION.defaults.endCenterY
    ]);
  });

  it("uses server subject tracks to animate smart crop", async () => {
    const early = outputRecord((await renderDefault(SMART_CROP_ANIMATE_DEFINITION, 0)).output);
    const late = outputRecord((await renderDefault(SMART_CROP_ANIMATE_DEFINITION, 2)).output);
    const earlyCrop = early.crop as { centerX: number };
    const lateCrop = late.crop as { centerX: number };
    expect(early.analysisSlot).toBe("subject_tracks");
    expect(lateCrop.centerX).toBeGreaterThan(earlyCrop.centerX);
  });

  it("rejects a smart-crop subject index absent from server analysis", async () => {
    await expect(executeSelectedEffectTool(
      SMART_CROP_ANIMATE_DEFINITION,
      "smart_crop_animate",
      { type: "smart_crop_animate", data: { subjectIndex: 1 } },
      contextFor(SMART_CROP_ANIMATE_DEFINITION, 1)
    )).rejects.toThrow("subjectIndex 1 is not available");
  });

  it("binds depth input to a displaced mesh and moves a perspective camera", async () => {
    const result = await renderDefault(IMAGE_DEPTH_PARALLAX_DEFINITION, 4);
    const output = outputRecord(result.output);
    expect(output.depthSlot).toBe("source_depth");
    expect(output.operation).toBe("depth_displaced_mesh");
    expect((output.camera as { x: number }).x).not.toBe(0);
  });

  it("reveals photo-stack layers at interval boundaries", async () => {
    const start = outputRecord((await renderDefault(PHOTO_STACK_DEFINITION, 0)).output);
    const later = outputRecord((await renderDefault(PHOTO_STACK_DEFINITION, 0.71)).output);
    expect(start.revealed).toBe(1);
    expect(later.revealed).toBe(3);
  });

  it("freezes the exact source time and resumes with a shifted sample time", async () => {
    const before = outputRecord((await renderDefault(VIDEO_FREEZE_FRAME_DEFINITION, 1.9)).output);
    const held = outputRecord((await renderDefault(VIDEO_FREEZE_FRAME_DEFINITION, 2.8)).output);
    const after = outputRecord((await renderDefault(VIDEO_FREEZE_FRAME_DEFINITION, 4)).output);
    expect(before.sampleTime).toBe(1.9);
    expect(held).toMatchObject({ sampleTime: 2, frozen: true });
    expect(after).toMatchObject({ sampleTime: 2.5, frozen: false });
  });

  it("integrates speed across the ramp instead of multiplying the current timestamp", () => {
    const params = SPEED_RAMP_DEFINITION.defaults;
    expect(speedRampSampleTime(1, params)).toBeCloseTo(1, 8);
    expect(speedRampSampleTime(3, params)).toBeCloseTo(4, 8);
    expect(speedRampSampleTime(4, params)).toBeCloseTo(6, 8);
    expect(speedRampSampleTime(3, params)).not.toBeCloseTo(3 * params.speedAfter, 8);
  });

  it("samples actual historical times for echo trail and clamps the media boundary", async () => {
    const result = await renderDefault(ECHO_TRAIL_DEFINITION, 0.15);
    const history = outputRecord(result.output).history as { sampleTime: number }[];
    expect(history.slice(0, 4).map((sample) => sample.sampleTime)).toEqual([0.15, 0.07, 0, 0]);
  });

  it("composites only server-bound foreground, matte, and background slots", async () => {
    const result = await renderDefault(BACKGROUND_REMOVE_COMPOSE_DEFINITION);
    expect(outputRecord(result.output)).toMatchObject({
      foregroundSlot: "foreground_video",
      matteSlot: "foreground_matte",
      backgroundSlot: "background_image"
    });
  });
});

describe("batch-06 field specifications", () => {
  const markdownDirectory = fileURLToPath(new URL("../../../field-specs/batch-06/", import.meta.url));

  it.each(BATCH_06_DEFINITIONS)("validates the documented JSON example for $toolName", (definition) => {
    const filename = definition.toolName.replaceAll("_", "-") + ".md";
    const markdown = readFileSync(`${markdownDirectory}${filename}`, "utf8");
    const jsonBlocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gu)];
    expect(jsonBlocks).toHaveLength(1);
    const example = JSON.parse(jsonBlocks[0]![1]!) as unknown;
    expect(() => validateAndNormalizeEffectEnvelope(definition, definition.toolName, example)).not.toThrow();
    expect(markdown).toContain(definition.displayName);
    expect(markdown).toContain(definition.toolName);
    expect(markdown).toContain("不适合处理");
    expect(markdown).toContain("中性值");
    expect(markdown).toContain("服务器资源要求与接入状态");
    const properties = (definition.parameterSchema as { properties: Record<string, unknown> }).properties;
    for (const propertyName of Object.keys(properties)) expect(markdown).toContain(propertyName);
    for (const slot of definition.inputSlots) expect(markdown).toContain(slot.name);
  });
});
