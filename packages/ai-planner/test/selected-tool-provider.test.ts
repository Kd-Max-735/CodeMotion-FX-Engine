import { describe, expect, it, vi } from "vitest";
import type { JsonSchema } from "@codemotion/core";
import {
  ARK_V1_MODEL,
  VolcengineArkSelectedToolProvider,
  type SelectedToolParameterRequest
} from "../src/index.js";

const parameterSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { intensity: { type: "number", minimum: 0, maximum: 1, default: 0.5 } }
};

function request(): SelectedToolParameterRequest {
  return {
    requestId: "request-selected-tool-00000001",
    tenantId: "tenant-selected-tool",
    userId: "user-selected-tool",
    toolName: "particle_spark",
    prompt: "生成轻微火花",
    fieldSpec: "ONLY_SELECTED_FIELD_SPEC",
    parameterSchema
  };
}

function response(model: string = ARK_V1_MODEL): Response {
  return new Response(JSON.stringify({
    model,
    output: [{ content: [{
      type: "output_text",
      text: JSON.stringify({ type: "particle_spark", data: { intensity: 0.4 } })
    }] }]
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("selected-tool Ark Provider", () => {
  it("sends only the selected tool field spec and a strict selected envelope schema", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response());
    const provider = new VolcengineArkSelectedToolProvider({
      apiKey: "unit-test-key-that-is-not-real",
      fetchImpl
    });

    await expect(provider.generate(request())).resolves.toEqual({
      type: "particle_spark",
      data: { intensity: 0.4 }
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("https://ark.cn-beijing.volces.com/api/v3/responses");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      input: Array<{ content: Array<{ text: string }> }>;
      text: { format: { strict: boolean; schema: Record<string, unknown> } };
    };
    const serialized = JSON.stringify(body);
    expect(body.model).toBe(ARK_V1_MODEL);
    expect(body.input[0]!.content[0]!.text).toContain("ONLY_SELECTED_FIELD_SPEC");
    expect(body.input[0]!.content[0]!.text).toContain("particle_spark");
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema).toMatchObject({
      additionalProperties: false,
      required: ["type", "data"],
      properties: {
        type: { const: "particle_spark" },
        data: parameterSchema
      }
    });
    expect(serialized).not.toContain("OTHER_FIELD_SPEC");
    expect(serialized).not.toContain("fx.motion.fade");
    expect(serialized).not.toContain("asset_aaaaaaaa");
    expect(serialized).not.toContain("effectId");
  });

  it("rejects a response produced by any model other than the configured Ark model", async () => {
    const provider = new VolcengineArkSelectedToolProvider({
      apiKey: "unit-test-key-that-is-not-real",
      fetchImpl: async () => response("another-model")
    });
    await expect(provider.generate(request())).rejects.toMatchObject({
      code: "security",
      reason: "MODEL_MISMATCH"
    });
  });
});
