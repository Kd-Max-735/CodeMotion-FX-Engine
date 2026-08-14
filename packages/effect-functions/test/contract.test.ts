import { describe, expect, it } from "vitest";
import type { JsonObject } from "@codemotion/core";
import {
  EFFECT_TOOL_REGISTRY,
  EffectToolContractError,
  assertEffectToolDefinition,
  executeSelectedEffectTool,
  validateAndNormalizeEffectEnvelope,
  type AuthorizedEffectInputs,
  type EffectToolDefinition,
  type ServerEffectRenderContext
} from "../src/index.js";

interface DemoParams extends JsonObject {
  intensity: number;
  mode: string;
}

const backend = Object.freeze({
  backendId: "server-cpu-v1",
  kind: "server-cpu" as const,
  version: "1.0.0",
  deterministic: true
});

let renderCalls = 0;

function demoDefinition(
  normalizeParams: EffectToolDefinition<DemoParams>["normalizeParams"] = (params) => ({
    intensity: Math.round(params.intensity * 100) / 100,
    mode: params.mode
  })
): EffectToolDefinition<DemoParams> {
  return {
    effectId: "fx.test.serverGlow",
    toolName: "server_glow",
    displayName: "服务端发光",
    version: "1.0.0",
    category: "test",
    parameterSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      required: ["intensity"],
      properties: {
        intensity: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
        mode: { type: "string", enum: ["soft", "hard"], default: "soft" }
      }
    },
    defaults: { intensity: 0.5, mode: "soft" },
    presets: [{
      presetId: "preset.test.soft",
      displayName: "柔和",
      params: { intensity: 0.5, mode: "soft" }
    }],
    inputSlots: [],
    primaryBackend: backend,
    fallbackStrategy: { kind: "reject", reason: "No equivalent fallback." },
    performanceGrade: "light",
    normalizeParams,
    validateParams: (params) => params.mode === "soft" || params.mode === "hard"
      ? { valid: true }
      : { valid: false, issues: [{ path: "$.mode", message: "unsupported mode" }] },
    render: (_context, params) => {
      renderCalls += 1;
      return {
        kind: "metadata",
        backendId: backend.backendId,
        output: { intensity: params.intensity, mode: params.mode },
        degraded: false,
        warnings: []
      };
    }
  };
}

function context(inputs: AuthorizedEffectInputs = {}): ServerEffectRenderContext {
  return {
    environment: "server",
    requestId: "request-1",
    tenantId: "tenant-1",
    userId: "user-1",
    time: 0,
    deltaTime: 0,
    frame: 0,
    fps: 30,
    width: 1920,
    height: 1080,
    seed: 1,
    quality: "final",
    backend,
    inputs
  };
}

async function expectRejectedWithoutRender(
  definition: EffectToolDefinition<DemoParams>,
  modelOutput: unknown,
  code: EffectToolContractError["code"]
): Promise<void> {
  renderCalls = 0;
  await expect(executeSelectedEffectTool(
    definition,
    "server_glow",
    modelOutput,
    context()
  )).rejects.toMatchObject({ code });
  expect(renderCalls).toBe(0);
}

describe("server single-tool envelope", () => {
  it("accepts the exact selected tool and applies optional defaults", async () => {
    renderCalls = 0;
    const result = await executeSelectedEffectTool(
      demoDefinition(),
      "server_glow",
      { type: "server_glow", data: { intensity: 0.625 } },
      context()
    );
    expect(result.output).toEqual({ intensity: 0.63, mode: "soft" });
    expect(renderCalls).toBe(1);
  });

  it("rejects a type that differs from the user-selected tool", async () => {
    await expectRejectedWithoutRender(
      demoDefinition(),
      { type: "another_tool", data: { intensity: 0.5 } },
      "TYPE_MISMATCH"
    );
  });

  it("rejects unknown parameters", async () => {
    await expectRejectedWithoutRender(
      demoDefinition(),
      { type: "server_glow", data: { intensity: 0.5, surprise: true } },
      "PARAMETER_INVALID"
    );
  });

  it("rejects out-of-range values and non-finite direct input", async () => {
    await expectRejectedWithoutRender(
      demoDefinition(),
      { type: "server_glow", data: { intensity: 1.01 } },
      "PARAMETER_INVALID"
    );
    await expectRejectedWithoutRender(
      demoDefinition(),
      { type: "server_glow", data: { intensity: Number.NaN } },
      "PARAMETER_INVALID"
    );
    await expectRejectedWithoutRender(
      demoDefinition(),
      { type: "server_glow", data: { intensity: Number.POSITIVE_INFINITY } },
      "PARAMETER_INVALID"
    );
    await expectRejectedWithoutRender(
      demoDefinition(),
      { type: "server_glow", data: { intensity: 0.5, mode: "unknown" } },
      "PARAMETER_INVALID"
    );
    await expectRejectedWithoutRender(
      demoDefinition(),
      { type: "server_glow", data: { intensity: 0.5, mode: null } },
      "PARAMETER_INVALID"
    );
  });

  it("rejects model-generated resource IDs even in an otherwise allowed string", async () => {
    await expectRejectedWithoutRender(
      demoDefinition(),
      { type: "server_glow", data: { intensity: 0.5, mode: "asset_0123456789abcdef01234567" } },
      "RESOURCE_INJECTION"
    );
  });

  it("rejects URL and filesystem path injection before rendering", async () => {
    for (const mode of ["https://example.invalid/a.png", "C:\\tenant\\a.png", "../tenant/a.png"]) {
      await expectRejectedWithoutRender(
        demoDefinition(),
        { type: "server_glow", data: { intensity: 0.5, mode } },
        "RESOURCE_INJECTION"
      );
    }
  });

  it("revalidates normalized parameters", () => {
    const invalidNormalizer = demoDefinition((params) => ({ ...params, intensity: 2 }));
    expect(() => validateAndNormalizeEffectEnvelope(
      invalidNormalizer,
      "server_glow",
      { type: "server_glow", data: { intensity: 0.5 } }
    )).toThrow(expect.objectContaining({ code: "NORMALIZATION_INVALID" }));
  });

  it("requires Schema defaults to exactly match the definition defaults", () => {
    const mismatched = demoDefinition();
    const definition = {
      ...mismatched,
      defaults: { intensity: 0.6, mode: "soft" }
    } satisfies EffectToolDefinition<DemoParams>;
    expect(() => assertEffectToolDefinition(definition)).toThrow(
      expect.objectContaining({ code: "DEFINITION_INVALID" })
    );
  });

  it("rejects resource-bearing fields in a model parameter Schema", () => {
    const base = demoDefinition();
    const definition = {
      ...base,
      parameterSchema: {
        type: "object",
        additionalProperties: false,
        required: ["intensity"],
        properties: {
          intensity: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
          mode: { type: "string", enum: ["soft", "hard"], default: "soft" },
          assetId: { type: "string", default: "none" }
        }
      },
      defaults: { intensity: 0.5, mode: "soft", assetId: "none" }
    } as unknown as EffectToolDefinition<DemoParams>;
    expect(() => assertEffectToolDefinition(definition)).toThrow(
      expect.objectContaining({ code: "DEFINITION_INVALID" })
    );
  });

  it("keeps authorized resources in a separate owner-locked server input channel", async () => {
    const definition: EffectToolDefinition<DemoParams> = {
      ...demoDefinition(),
      inputSlots: [{
        name: "primary_image",
        kind: "image",
        required: true,
        cardinality: "one",
        description: "Server-authorized primary image."
      }]
    };
    renderCalls = 0;
    await expect(executeSelectedEffectTool(
      definition,
      "server_glow",
      { type: "server_glow", data: { intensity: 0.5 } },
      context({
        primary_image: {
          slot: "primary_image",
          kind: "image",
          tenantId: "another-tenant",
          userId: "user-1",
          locked: true,
          binding: { opaque: true }
        }
      })
    )).rejects.toMatchObject({ code: "INPUT_AUTHORIZATION_INVALID" });
    expect(renderCalls).toBe(0);
  });

  it("exports a registry with no references to unimplemented batches", () => {
    expect(EFFECT_TOOL_REGISTRY.list()).toEqual([]);
  });

  it("uses a server context with no DOM or browser-global fields", () => {
    const keys = Object.keys(context());
    expect(keys).not.toContain("window");
    expect(keys).not.toContain("document");
    expect(keys).not.toContain("canvas");
    expect(keys).not.toContain("HTMLElement");
  });
});
