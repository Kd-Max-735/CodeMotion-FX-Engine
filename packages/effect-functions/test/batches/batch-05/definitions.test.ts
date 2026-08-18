import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@codemotion/core";
import {
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope
} from "../../../src/validation.js";
import type {
  AuthorizedEffectInput,
  AuthorizedEffectInputValue,
  AuthorizedEffectInputs,
  EffectToolDefinition,
  ServerEffectRenderContext
} from "../../../src/types.js";
import {
  BATCH_05_DEFINITIONS,
  DOLLY_DEFINITION,
  DOLLY_ZOOM_DEFINITION,
  HANDHELD_DEFINITION,
  OBJECT_MATCH_CUT_DEFINITION,
  ORBIT_DEFINITION,
  PAGE_TURN_DEFINITION,
  PAN_TILT_DEFINITION,
  PARALLAX_LAYERS_DEFINITION,
  PORTAL_DEFINITION,
  ZOOM_TUNNEL_DEFINITION
} from "../../../src/batches/batch-05/index.js";

function authorizedInputs(definition: EffectToolDefinition): AuthorizedEffectInputs {
  return Object.fromEntries(definition.inputSlots.map((slot, index) => [
    slot.name, {
      slot: slot.name,
      kind: slot.kind,
      tenantId: "tenant-batch-05",
      userId: "user-batch-05",
      locked: true as const,
      binding: { opaqueServerBinding: `${slot.name}-${index}` }
    } satisfies AuthorizedEffectInputValue
  ]));
}

function context(
  definition: EffectToolDefinition,
  time = 0.5,
  inputs: AuthorizedEffectInputs = authorizedInputs(definition),
  seed = 12345
): ServerEffectRenderContext {
  return {
    environment: "server",
    requestId: "request-batch-05",
    tenantId: "tenant-batch-05",
    userId: "user-batch-05",
    time,
    deltaTime: 1 / 30,
    frame: Math.max(0, Math.round(time * 30)),
    fps: 30,
    width: 1920,
    height: 1080,
    seed,
    quality: "final",
    backend: definition.primaryBackend,
    inputs
  };
}

async function defaultOutput(definition: EffectToolDefinition, time = 0.5): Promise<JsonObject> {
  const result = await executeSelectedEffectTool(
    definition,
    definition.toolName,
    { type: definition.toolName, data: {} },
    context(definition, time)
  );
  expect(result.kind).toBe("frame");
  expect(result.backendId).toBe(definition.primaryBackend.backendId);
  expect(result.degraded).toBe(false);
  expect((result.output as JsonObject).operation).toEqual(expect.any(String));
  return result.output as JsonObject;
}

function schemaProperties(definition: EffectToolDefinition): Record<string, Record<string, unknown>> {
  return (definition.parameterSchema as { properties: Record<string, Record<string, unknown>> }).properties;
}

function oneInput(definition: EffectToolDefinition, slotName: string): AuthorizedEffectInput {
  const value = authorizedInputs(definition)[slotName];
  if (value === undefined || Array.isArray(value)) throw new Error(`Expected one input for ${slotName}.`);
  return value as AuthorizedEffectInput;
}

function inputsWith(
  definition: EffectToolDefinition,
  slotName: string,
  replacement: AuthorizedEffectInputValue | undefined
): AuthorizedEffectInputs {
  const inputs: Record<string, AuthorizedEffectInputValue> = { ...authorizedInputs(definition) };
  if (replacement === undefined) delete inputs[slotName];
  else inputs[slotName] = replacement;
  return inputs;
}

describe("batch-05 definitions", () => {
  it("exports exactly ten unique requested effects and snake_case tools", () => {
    expect(BATCH_05_DEFINITIONS).toHaveLength(10);
    expect(BATCH_05_DEFINITIONS.map((definition) => definition.toolName)).toEqual([
      "page_turn",
      "portal",
      "zoom_tunnel",
      "object_match_cut",
      "pan_tilt",
      "dolly",
      "dolly_zoom",
      "orbit",
      "handheld",
      "parallax_layers"
    ]);
    expect(new Set(BATCH_05_DEFINITIONS.map((definition) => definition.effectId))).toEqual(new Set([
      "fx.transition.pageTurn",
      "fx.transition.portal",
      "fx.transition.zoomTunnel",
      "fx.transition.objectMatchCut",
      "fx.camera.panTilt",
      "fx.camera.dolly",
      "fx.camera.dollyZoom",
      "fx.camera.orbit",
      "fx.camera.handheld",
      "fx.3d.parallaxLayers"
    ]));
    expect(new Set(BATCH_05_DEFINITIONS.map((definition) => definition.toolName)).size).toBe(10);
    for (const definition of BATCH_05_DEFINITIONS) {
      expect(definition.toolName).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u);
    }
  });

  it("passes the public definition contract with defaults and three presets each", () => {
    for (const definition of BATCH_05_DEFINITIONS) {
      expect(() => assertEffectToolDefinition(definition)).not.toThrow();
      expect(definition.parameterSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(definition.primaryBackend.deterministic).toBe(true);
      expect(definition.presets).toHaveLength(3);
      expect(validateAndNormalizeEffectEnvelope(
        definition,
        definition.toolName,
        { type: definition.toolName, data: {} }
      ).data).toEqual(definition.defaults);
      for (const preset of definition.presets) {
        expect(() => validateAndNormalizeEffectEnvelope(
          definition,
          definition.toolName,
          { type: definition.toolName, data: preset.params }
        )).not.toThrow();
      }
    }
  });

  it("rejects every numeric parameter outside its declared bounds", () => {
    for (const definition of BATCH_05_DEFINITIONS) {
      for (const [name, property] of Object.entries(schemaProperties(definition))) {
        if (typeof property.minimum === "number") {
          expect(() => validateAndNormalizeEffectEnvelope(
            definition,
            definition.toolName,
            { type: definition.toolName, data: { [name]: property.minimum - 0.0001 } }
          ), `${definition.toolName}.${name} below minimum`).toThrow(expect.objectContaining({
            code: "PARAMETER_INVALID"
          }));
        }
        if (typeof property.maximum === "number") {
          expect(() => validateAndNormalizeEffectEnvelope(
            definition,
            definition.toolName,
            { type: definition.toolName, data: { [name]: property.maximum + 0.0001 } }
          ), `${definition.toolName}.${name} above maximum`).toThrow(expect.objectContaining({
            code: "PARAMETER_INVALID"
          }));
        }
      }
    }
  });

  it("keeps resources out of every model parameter Schema", () => {
    const forbidden = /(?:^|_)(?:asset|resource|file|path|url|uri|image|video|audio|mask|depth_map|camera_target)(?:_|$)|(?:_id|_path|_url|_uri)$/u;
    for (const definition of BATCH_05_DEFINITIONS) {
      const properties = (definition.parameterSchema as { properties: Record<string, unknown> }).properties;
      expect(Object.keys(properties).some((name) => forbidden.test(
        name.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase()
      ))).toBe(false);
      expect(definition.inputSlots.length).toBeGreaterThan(0);
    }
    for (const transition of BATCH_05_DEFINITIONS.slice(0, 4)) {
      expect(transition.inputSlots.filter((slot) => slot.kind === "video" && slot.required)).toHaveLength(2);
    }
    expect(OBJECT_MATCH_CUT_DEFINITION.inputSlots.filter((slot) => slot.kind === "mask" && slot.required)).toHaveLength(2);
    expect(PARALLAX_LAYERS_DEFINITION.inputSlots).toContainEqual(expect.objectContaining({ name: "depth_map", kind: "depth-map", required: true }));
    expect(DOLLY_ZOOM_DEFINITION.inputSlots).toContainEqual(expect.objectContaining({ name: "camera_target", kind: "data", required: true }));
  });

  it("keeps each declared slot out of its model Schema", () => {
    for (const definition of BATCH_05_DEFINITIONS) {
      const properties = schemaProperties(definition);
      for (const slot of definition.inputSlots) expect(properties).not.toHaveProperty(slot.name);
    }
  });

  it("rejects unknown model fields before render", async () => {
    await expect(executeSelectedEffectTool(
      PAGE_TURN_DEFINITION,
      PAGE_TURN_DEFINITION.toolName,
      { type: PAGE_TURN_DEFINITION.toolName, data: { video: "not-allowed" } },
      context(PAGE_TURN_DEFINITION)
    )).rejects.toMatchObject({ code: "RESOURCE_INJECTION" });
    await expect(executeSelectedEffectTool(
      PAGE_TURN_DEFINITION,
      PAGE_TURN_DEFINITION.toolName,
      { type: PAGE_TURN_DEFINITION.toolName, data: { surprise: true } },
      context(PAGE_TURN_DEFINITION)
    )).rejects.toMatchObject({ code: "PARAMETER_INVALID" });
  });
});

describe("batch-05 authorized resource bindings", () => {
  it.each(BATCH_05_DEFINITIONS)("rejects a missing required input for $toolName", async (definition) => {
    const required = definition.inputSlots.find((slot) => slot.required);
    expect(required).toBeDefined();
    await expect(executeSelectedEffectTool(
      definition,
      definition.toolName,
      { type: definition.toolName, data: {} },
      context(definition, 0.5, inputsWith(definition, required!.name, undefined))
    )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
  });

  it("rejects wrong kind, owner, and lock state before rendering", async () => {
    const source = oneInput(PAGE_TURN_DEFINITION, "from_video");
    const invalidBindings = [
      { ...source, kind: "image" as const },
      { ...source, tenantId: "another-tenant" },
      { ...source, userId: "another-user" },
      { ...source, locked: false }
    ];
    for (const invalidBinding of invalidBindings) {
      await expect(executeSelectedEffectTool(
        PAGE_TURN_DEFINITION,
        "page_turn",
        { type: "page_turn", data: {} },
        context(PAGE_TURN_DEFINITION, 0.5, inputsWith(
          PAGE_TURN_DEFINITION,
          "from_video",
          invalidBinding as AuthorizedEffectInputValue
        ))
      )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
    }
  });

  it("does not let one server binding impersonate two independent videos or masks", async () => {
    const transitionInputs = { ...authorizedInputs(PAGE_TURN_DEFINITION) } as Record<string, AuthorizedEffectInputValue>;
    const sharedVideo = { opaqueServerBinding: "shared-video" };
    transitionInputs.from_video = { ...oneInput(PAGE_TURN_DEFINITION, "from_video"), binding: sharedVideo };
    transitionInputs.to_video = { ...oneInput(PAGE_TURN_DEFINITION, "to_video"), binding: sharedVideo };
    await expect(executeSelectedEffectTool(
      PAGE_TURN_DEFINITION,
      "page_turn",
      { type: "page_turn", data: {} },
      context(PAGE_TURN_DEFINITION, 0.5, transitionInputs)
    )).rejects.toThrow("require distinct server bindings");

    const matchInputs = { ...authorizedInputs(OBJECT_MATCH_CUT_DEFINITION) } as Record<string, AuthorizedEffectInputValue>;
    const sharedMask = { opaqueServerBinding: "shared-mask" };
    matchInputs.from_match_mask = { ...oneInput(OBJECT_MATCH_CUT_DEFINITION, "from_match_mask"), binding: sharedMask };
    matchInputs.to_match_mask = { ...oneInput(OBJECT_MATCH_CUT_DEFINITION, "to_match_mask"), binding: sharedMask };
    await expect(executeSelectedEffectTool(
      OBJECT_MATCH_CUT_DEFINITION,
      "object_match_cut",
      { type: "object_match_cut", data: {} },
      context(OBJECT_MATCH_CUT_DEFINITION, 0.5, matchInputs)
    )).rejects.toThrow("require distinct server bindings");
  });

  it("executes portal without its optional mask and reports that absence", async () => {
    const output = (await executeSelectedEffectTool(
      PORTAL_DEFINITION,
      "portal",
      { type: "portal", data: {} },
      context(PORTAL_DEFINITION, 0.5, inputsWith(PORTAL_DEFINITION, "portal_mask", undefined))
    )).output as JsonObject;
    expect(output.inputSlots).toMatchObject({ apertureMask: null });
  });
});

describe("batch-05 rendering behavior", () => {
  it("returns executable frame operations that expose only declared slot names", async () => {
    for (const definition of BATCH_05_DEFINITIONS) {
      const result = await executeSelectedEffectTool(
        definition,
        definition.toolName,
        { type: definition.toolName, data: {} },
        context(definition)
      );
      expect(result).toMatchObject({
        kind: "frame",
        backendId: definition.primaryBackend.backendId,
        degraded: false,
        warnings: []
      });
      const output = result.output as JsonObject;
      expect(output).toMatchObject({ operation: expect.any(String), frame: 15, sampleTime: 0.5 });
      expect(JSON.stringify(output)).not.toContain("opaqueServerBinding");
    }
  });

  it("is deterministic for fixed server frame, time, and seed", async () => {
    for (const definition of BATCH_05_DEFINITIONS) {
      const first = await defaultOutput(definition, 1.25);
      const second = await defaultOutput(definition, 1.25);
      expect(second).toEqual(first);
    }
  });

  it("uses four distinct transition algorithms", async () => {
    const outputs = await Promise.all([
      defaultOutput(PAGE_TURN_DEFINITION),
      defaultOutput(PORTAL_DEFINITION),
      defaultOutput(ZOOM_TUNNEL_DEFINITION),
      defaultOutput(OBJECT_MATCH_CUT_DEFINITION)
    ]);
    expect(new Set(outputs.map((output) => output.algorithm))).toEqual(new Set([
      "page-turn-mesh",
      "radial-portal-wipe",
      "perspective-zoom-tunnel",
      "masked-object-match-cut"
    ]));
  });

  it("clamps every transition to exact source and destination boundaries", async () => {
    for (const definition of [
      PAGE_TURN_DEFINITION,
      PORTAL_DEFINITION,
      ZOOM_TUNNEL_DEFINITION,
      OBJECT_MATCH_CUT_DEFINITION
    ]) {
      const start = await defaultOutput(definition, 0);
      const end = await defaultOutput(definition, 999);
      expect(start.progress).toBe(0);
      expect(end.progress).toBe(1);
      if (definition === PAGE_TURN_DEFINITION) {
        expect(start.sourceWeights).toEqual({ from: 1, to: 0 });
        expect(end.sourceWeights).toEqual({ from: 0, to: 1 });
      } else if (definition === PORTAL_DEFINITION) {
        expect(start.completionMix).toBe(0);
        expect(end.completionMix).toBe(1);
      } else if (definition === ZOOM_TUNNEL_DEFINITION) {
        expect(start.outgoing).toMatchObject({ opacity: 1 });
        expect(start.incoming).toMatchObject({ opacity: 0 });
        expect(end.outgoing).toMatchObject({ opacity: 0 });
        expect(end.incoming).toMatchObject({ opacity: 1 });
      } else {
        expect(start.blend).toBe(0);
        expect(end.blend).toBe(1);
      }
    }
  });

  it("produces real camera matrices and spatial movement", async () => {
    const panTilt = await defaultOutput(PAN_TILT_DEFINITION, 1);
    const orbit = await defaultOutput(ORBIT_DEFINITION, 2.5);
    const parallax = await defaultOutput(PARALLAX_LAYERS_DEFINITION, 2);
    for (const output of [panTilt, orbit, parallax]) {
      expect(output.viewMatrix).toBeInstanceOf(Array);
      expect(output.viewMatrix).toHaveLength(16);
    }
    expect(panTilt.rotationDegrees).toMatchObject({ y: expect.any(Number) });
    expect(orbit.position).not.toEqual({ x: 0, y: 0, z: 0 });
    expect(parallax.layers).toHaveLength(PARALLAX_LAYERS_DEFINITION.defaults.layerCount);
  });

  it("moves the dolly camera and compensates FOV to preserve subject scale", async () => {
    const output = await defaultOutput(DOLLY_ZOOM_DEFINITION, 2);
    const position = output.position as JsonObject;
    expect(position.z).not.toBe(0);
    expect(output.verticalFovDegrees).not.toBe(DOLLY_ZOOM_DEFINITION.defaults.initialFovDegrees);
    expect(output.projectionCompensation).toBe("constant-subject-scale");
  });

  it("supports both ordered round trips for dolly and dolly zoom", async () => {
    const positionAt = async (
      definition: EffectToolDefinition,
      direction: "forward_then_backward" | "backward_then_forward",
      time: number
    ) => {
      const result = await executeSelectedEffectTool(
        definition,
        definition.toolName,
        { type: definition.toolName, data: { direction, duration: 4, easing: "linear" } },
        context(definition, time)
      );
      return result.output as JsonObject;
    };
    for (const definition of [DOLLY_DEFINITION, DOLLY_ZOOM_DEFINITION]) {
      expect(schemaProperties(definition).direction!.enum).toEqual([
        "forward", "backward", "forward_then_backward", "backward_then_forward"
      ]);
      const start = await positionAt(definition, "forward_then_backward", 0);
      const forwardPeak = await positionAt(definition, "forward_then_backward", 2);
      const returned = await positionAt(definition, "forward_then_backward", 4);
      const backwardPeak = await positionAt(definition, "backward_then_forward", 2);
      expect((start.position as JsonObject).z).toBe(0);
      expect((forwardPeak.position as JsonObject).z).toBeLessThan(0);
      expect((backwardPeak.position as JsonObject).z).toBeGreaterThan(0);
      expect((returned.position as JsonObject).z).toBe(0);
    }
  });

  it("clamps bounded camera moves and keeps handheld sampling seed-stable", async () => {
    const dollyStart = await defaultOutput(DOLLY_DEFINITION, -10);
    const dollyEnd = await defaultOutput(DOLLY_DEFINITION, 999);
    expect(dollyStart.progress).toBe(0);
    expect(dollyStart.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(dollyEnd.progress).toBe(1);
    expect(dollyEnd.position).toEqual({ x: 0, y: 0, z: -DOLLY_DEFINITION.defaults.distance });

    const first = await executeSelectedEffectTool(
      HANDHELD_DEFINITION,
      "handheld",
      { type: "handheld", data: {} },
      context(HANDHELD_DEFINITION, 2.25, authorizedInputs(HANDHELD_DEFINITION), 77)
    );
    const same = await executeSelectedEffectTool(
      HANDHELD_DEFINITION,
      "handheld",
      { type: "handheld", data: {} },
      context(HANDHELD_DEFINITION, 2.25, authorizedInputs(HANDHELD_DEFINITION), 77)
    );
    const otherSeed = await executeSelectedEffectTool(
      HANDHELD_DEFINITION,
      "handheld",
      { type: "handheld", data: {} },
      context(HANDHELD_DEFINITION, 2.25, authorizedInputs(HANDHELD_DEFINITION), 78)
    );
    expect(same).toEqual(first);
    expect(otherSeed.output).not.toEqual(first.output);
  });
});

describe("batch-05 field specifications", () => {
  const tools = [
    "page_turn", "portal", "zoom_tunnel", "object_match_cut", "pan_tilt",
    "dolly", "dolly_zoom", "orbit", "handheld", "parallax_layers"
  ];

  it("provides ten Chinese model-field documents with all required sections", async () => {
    const directory = fileURLToPath(new URL("../../../field-specs/batch-05/", import.meta.url));
    for (const toolName of tools) {
      const markdown = await readFile(`${directory}${toolName}.md`, "utf8");
      expect(markdown).toContain(`# `);
      expect(markdown).toContain(`\`${toolName}\``);
      expect(markdown).toContain(`"type":"${toolName}"`);
      expect(markdown).toMatch(/只输出(?:一个)? JSON/u);
      expect(markdown).toContain("| 字段 | 必填 | 取值 | 选择策略 |");
      expect(markdown).toContain("参数选择方法与优先级");
      expect(markdown).toContain("自然语言示例");
      expect(markdown).toContain("推荐值、默认值与边界");
      expect(markdown).toContain("不适用");
      expect(markdown).toContain("服务端绑定");
      expect(markdown).toContain("服务器静态帧源适配");
      expect(markdown).toContain("不得把 `image` 直接绑定为 `video`");
      const jsonBlocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gu)];
      expect(jsonBlocks).toHaveLength(1);
      const example = JSON.parse(jsonBlocks[0]![1]!) as unknown;
      expect(() => validateAndNormalizeEffectEnvelope(
        BATCH_05_DEFINITIONS.find((definition) => definition.toolName === toolName)!,
        toolName,
        example
      )).not.toThrow();
      const exampleRows = markdown.match(/^\| [^|]+ \| `\{.+\}` \|$/gmu) ?? [];
      expect(exampleRows.length).toBeGreaterThanOrEqual(5);
      expect(exampleRows.length).toBeLessThanOrEqual(8);
    }
  });
});
