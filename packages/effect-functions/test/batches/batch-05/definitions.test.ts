import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { JsonObject } from "@codemotion/core";
import {
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope,
  type AuthorizedEffectInputs,
  type EffectToolDefinition,
  type ServerEffectRenderContext
} from "../../../src/index.js";
import {
  BATCH_05_DEFINITIONS,
  DOLLY_ZOOM_DEFINITION,
  OBJECT_MATCH_CUT_DEFINITION,
  ORBIT_DEFINITION,
  PAGE_TURN_DEFINITION,
  PAN_TILT_DEFINITION,
  PARALLAX_LAYERS_DEFINITION,
  PORTAL_DEFINITION,
  ZOOM_TUNNEL_DEFINITION
} from "../../../src/batches/batch-05/index.js";

function authorizedInputs(definition: EffectToolDefinition): AuthorizedEffectInputs {
  return Object.fromEntries(definition.inputSlots.map((slot) => [
    slot.name,
    {
      slot: slot.name,
      kind: slot.kind,
      tenantId: "tenant-batch-05",
      userId: "user-batch-05",
      locked: true as const,
      binding: { opaqueServerBinding: slot.name }
    }
  ]));
}

function context(definition: EffectToolDefinition, time = 0.5): ServerEffectRenderContext {
  return {
    environment: "server",
    requestId: "request-batch-05",
    tenantId: "tenant-batch-05",
    userId: "user-batch-05",
    time,
    deltaTime: 1 / 30,
    frame: Math.round(time * 30),
    fps: 30,
    width: 1920,
    height: 1080,
    seed: 12345,
    quality: "final",
    backend: definition.primaryBackend,
    inputs: authorizedInputs(definition)
  };
}

async function defaultOutput(definition: EffectToolDefinition, time = 0.5): Promise<JsonObject> {
  const result = await executeSelectedEffectTool(
    definition,
    definition.toolName,
    { type: definition.toolName, data: {} },
    context(definition, time)
  );
  expect(result.kind).toBe("metadata");
  expect(result.backendId).toBe(definition.primaryBackend.backendId);
  expect(result.degraded).toBe(false);
  return result.output as JsonObject;
}

describe("batch-05 definitions", () => {
  it("exports exactly ten unique requested effects and snake_case tools", () => {
    expect(BATCH_05_DEFINITIONS).toHaveLength(10);
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

describe("batch-05 rendering behavior", () => {
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
      const exampleRows = markdown.match(/^\| [^|]+ \| `\{.+\}` \|$/gmu) ?? [];
      expect(exampleRows.length).toBeGreaterThanOrEqual(5);
      expect(exampleRows.length).toBeLessThanOrEqual(8);
    }
  });
});
