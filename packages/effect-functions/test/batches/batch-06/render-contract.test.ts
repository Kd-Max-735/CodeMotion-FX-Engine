import { describe, expect, it } from "vitest";
import type {
  AuthorizedEffectInput,
  AuthorizedEffectInputValue,
  AuthorizedEffectInputs,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../../src/types.js";
import {
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope
} from "../../../src/validation.js";
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
import {
  Batch06AdapterRequiredError,
  RGBA8_FRAME_VERSION,
  type Rgba8FrameOutput
} from "../../../src/batches/batch-06/common.js";
import { speedRampSampleTime } from "../../../src/batches/batch-06/speed-ramp.js";

const BLOCKED_DEFINITIONS = [
  OBJECT_EXPLODE_DEFINITION,
  TEXT_LOGO_REVEAL_DEFINITION,
  SMART_CROP_ANIMATE_DEFINITION,
  IMAGE_DEPTH_PARALLAX_DEFINITION,
  PHOTO_STACK_DEFINITION,
  VIDEO_FREEZE_FRAME_DEFINITION,
  SPEED_RAMP_DEFINITION,
  ECHO_TRAIL_DEFINITION,
  BACKGROUND_REMOVE_COMPOSE_DEFINITION
] as const;

const EXPECTED_SLOTS: Readonly<Record<string, readonly string[]>> = {
  object_explode: ["source_model"],
  text_logo_reveal: ["logo_geometry", "typeface"],
  ken_burns: ["source_image"],
  smart_crop_animate: ["source_video", "subject_tracks"],
  image_depth_parallax: ["source_image", "source_depth"],
  photo_stack: ["source_images"],
  video_freeze_frame: ["source_video"],
  speed_ramp: ["source_video"],
  echo_trail: ["source_video"],
  background_remove_compose: ["foreground_video", "foreground_matte", "background_image"]
};

const sourceImage = {
  version: RGBA8_FRAME_VERSION,
  width: 4,
  height: 4,
  data: new Uint8ClampedArray(Array.from({ length: 64 }, (_, index) => {
    const channel = index % 4;
    if (channel === 3) return 255;
    const pixel = Math.floor(index / 4);
    return channel === 0 ? (pixel % 4) * 70 : channel === 1 ? Math.floor(pixel / 4) * 70 : 40;
  }))
};

function authorized(
  slot: EffectToolDefinition["inputSlots"][number],
  binding: unknown
): AuthorizedEffectInput {
  return {
    slot: slot.name,
    kind: slot.kind,
    tenantId: "tenant-batch-06",
    userId: "user-batch-06",
    locked: true,
    binding
  };
}

function inputsFor(definition: EffectToolDefinition): AuthorizedEffectInputs {
  const inputs: Record<string, AuthorizedEffectInputValue> = {};
  for (const slot of definition.inputSlots) {
    const binding = definition === KEN_BURNS_DEFINITION && slot.name === "source_image"
      ? sourceImage
      : { adapterFixture: slot.name };
    inputs[slot.name] = slot.cardinality === "many"
      ? [authorized(slot, { adapterFixture: `${slot.name}-0` }), authorized(slot, { adapterFixture: `${slot.name}-1` })]
      : authorized(slot, binding);
  }
  return inputs;
}

function contextFor(
  definition: EffectToolDefinition,
  time = 0,
  inputs: AuthorizedEffectInputs = inputsFor(definition)
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
    seed: 104729,
    quality: "final",
    backend: definition.primaryBackend,
    inputs
  };
}

function executeDefault(
  definition: EffectToolDefinition,
  context = contextFor(definition)
) {
  return executeSelectedEffectTool(
    definition,
    definition.toolName,
    { type: definition.toolName, data: {} },
    context
  );
}

describe("batch-06 resource contracts", () => {
  it.each(BATCH_06_DEFINITIONS)("declares exact isolated slots for $toolName", (definition) => {
    expect(definition.inputSlots.map((slot) => slot.name)).toEqual(EXPECTED_SLOTS[definition.toolName]);
    const properties = (definition.parameterSchema as { properties: Record<string, unknown> }).properties;
    for (const slot of definition.inputSlots) expect(properties).not.toHaveProperty(slot.name);
  });

  it.each(BATCH_06_DEFINITIONS)("rejects model resource injection for $toolName", (definition) => {
    expect(() => validateAndNormalizeEffectEnvelope(
      definition,
      definition.toolName,
      { type: definition.toolName, data: { resource_id: "asset_0123456789abcdef" } }
    )).toThrow(expect.objectContaining({ code: "RESOURCE_INJECTION" }));
  });

  it.each(BATCH_06_DEFINITIONS)("rejects missing required resources for $toolName", async (definition) => {
    const required = definition.inputSlots.find((slot) => slot.required)!;
    const missing = Object.fromEntries(
      Object.entries(inputsFor(definition)).filter(([name]) => name !== required.name)
    );
    await expect(executeDefault(definition, contextFor(definition, 0, missing)))
      .rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
  });

  it.each(BATCH_06_DEFINITIONS)("rejects cross-tool input slots for $toolName", async (definition) => {
    const required = definition.inputSlots.find((slot) => slot.required)!;
    const extra = { ...inputsFor(definition), other_batch_asset: authorized(required, {}) };
    await expect(executeDefault(definition, contextFor(definition, 0, extra)))
      .rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
  });

  it.each(BATCH_06_DEFINITIONS)("rejects non-finite model values for $toolName", (definition) => {
    const propertyName = Object.keys(
      (definition.parameterSchema as { properties: Record<string, unknown> }).properties
    )[0]!;
    for (const invalidValue of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateAndNormalizeEffectEnvelope(
        definition,
        definition.toolName,
        { type: definition.toolName, data: { [propertyName]: invalidValue } }
      )).toThrow(expect.objectContaining({ code: "PARAMETER_INVALID" }));
    }
  });
});

describe("batch-06 real rendering and explicit blockers", () => {
  it("renders deterministic finite Ken Burns RGBA frames that change over time", async () => {
    const start = await executeDefault(KEN_BURNS_DEFINITION, contextFor(KEN_BURNS_DEFINITION, 0));
    const end = await executeDefault(KEN_BURNS_DEFINITION, contextFor(KEN_BURNS_DEFINITION, 5));
    const repeatedEnd = await executeDefault(KEN_BURNS_DEFINITION, contextFor(KEN_BURNS_DEFINITION, 5));
    expect(start.kind).toBe("frame");
    expect(start.backendId).toBe(KEN_BURNS_DEFINITION.primaryBackend.backendId);
    const startFrame = start.output as Rgba8FrameOutput;
    const endFrame = end.output as Rgba8FrameOutput;
    expect(startFrame).toMatchObject({
      version: RGBA8_FRAME_VERSION,
      width: 4,
      height: 4,
      sourceSlot: "source_image",
      sampleTime: 0
    });
    expect(startFrame.data).toBeInstanceOf(Uint8ClampedArray);
    expect(startFrame.data).toHaveLength(64);
    expect([...startFrame.data].every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)).toBe(true);
    expect([...endFrame.data]).not.toEqual([...startFrame.data]);
    expect(repeatedEnd).toEqual(end);
  });

  it("rejects a same-image opaque stand-in on the executable Ken Burns path", async () => {
    const slot = KEN_BURNS_DEFINITION.inputSlots[0]!;
    const fakeInputs = { source_image: authorized(slot, { opaqueServerBinding: "same-image" }) };
    await expect(executeDefault(KEN_BURNS_DEFINITION, contextFor(KEN_BURNS_DEFINITION, 0, fakeInputs)))
      .rejects.toThrow("source_image must bind");
  });

  it.each(BLOCKED_DEFINITIONS)("reports an adapter blocker instead of a fake frame for $toolName", async (definition) => {
    await expect(executeDefault(definition)).rejects.toBeInstanceOf(Batch06AdapterRequiredError);
    await expect(executeDefault(definition)).rejects.toMatchObject({
      code: "BATCH_06_ADAPTER_REQUIRED",
      toolName: definition.toolName
    });
  });

  it("keeps speed-ramp sample time deterministic while frame decoding is blocked", () => {
    const params = SPEED_RAMP_DEFINITION.defaults;
    expect(speedRampSampleTime(1, params)).toBeCloseTo(1, 8);
    expect(speedRampSampleTime(3, params)).toBeCloseTo(4, 8);
    expect(speedRampSampleTime(4, params)).toBeCloseTo(6, 8);
  });
});
