import { describe, expect, it, vi } from "vitest";
import type { JsonSchema } from "@codemotion/core";
import {
  ARK_V1_MODEL,
  DEFAULT_VIDEO_GENERATION_MODE,
  VIDEO_GENERATION_MODE_FPS,
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
    choices: [{
      message: {
        role: "assistant",
        reasoning_content: "用户要求实际生成火花。",
        content: "准备生成火花。",
        tool_calls: [{
          id: "call-particle-spark-1",
          type: "function",
          function: { name: "particle_spark", arguments: JSON.stringify({ intensity: 0.4 }) }
        }]
      },
      finish_reason: "tool_calls"
    }]
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("selected-tool Ark Provider", () => {
  it("defines deterministic fast, standard, and fine frame rates", () => {
    expect(DEFAULT_VIDEO_GENERATION_MODE).toBe("standard");
    expect(VIDEO_GENERATION_MODE_FPS).toEqual({ fast: 15, standard: 30, fine: 60 });
  });

  it("sends only one native selected function tool and wraps its arguments as the internal envelope", async () => {
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
    expect(String(url)).toBe("https://ark.cn-beijing.volces.com/api/v3/chat/completions");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      thinking: { type: string };
      messages: Array<{ content: string }>;
      tools: Array<{ type: string; function: { name: string; strict: boolean; parameters: unknown } }>;
      tool_choice: { type: string; function: { name: string } };
    };
    const serialized = JSON.stringify(body);
    expect(body.model).toBe(ARK_V1_MODEL);
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.messages[0]!.content).toContain("ONLY_SELECTED_FIELD_SPEC");
    expect(body.messages[0]!.content).toContain("particle_spark");
    expect(body.tools).toEqual([{
      type: "function",
      function: expect.objectContaining({
        name: "particle_spark",
        strict: true,
        parameters: parameterSchema
      })
    }]);
    expect(body.tool_choice).toEqual({
      type: "function",
      function: { name: "particle_spark" }
    });
    expect(serialized).not.toContain("OTHER_FIELD_SPEC");
    expect(serialized).not.toContain("fx.motion.fade");
    expect(serialized).not.toContain("asset_aaaaaaaa");
    expect(serialized).not.toContain("effectId");
  });

  it("uses automatic tool choice for conversations and preserves direct natural-language answers", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      model: ARK_V1_MODEL,
      choices: [{
        message: {
          role: "assistant",
          reasoning_content: "用户只询问参数含义，不需要执行。",
          content: "intensity 控制火花强度。"
        },
        finish_reason: "stop"
      }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const provider = new VolcengineArkSelectedToolProvider({
      apiKey: "unit-test-key-that-is-not-real",
      fetchImpl
    });

    await expect(provider.respond(request())).resolves.toEqual({
      reasoningContent: "用户只询问参数含义，不需要执行。",
      content: "intensity 控制火花强度。"
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as {
      tool_choice: unknown;
      messages: Array<{ content: string }>;
      tools: Array<{ function: { parameters: { properties: { output: unknown } } } }>;
    };
    expect(body.tool_choice).toBe("auto");
    expect(body.messages[0]!.content).toContain("生成快一点");
    expect(body.messages[0]!.content).toContain("generationMode");
    expect(body.tools[0]!.function.parameters.properties.output).toMatchObject({
      required: ["durationSeconds", "generationMode"],
      properties: { generationMode: { enum: ["fast", "standard", "fine"], default: "standard" } }
    });
  });

  it("rejects a second call or any function name other than the selected tool", async () => {
    const wrongName = new VolcengineArkSelectedToolProvider({
      apiKey: "unit-test-key-that-is-not-real",
      fetchImpl: async () => new Response(JSON.stringify({
        model: ARK_V1_MODEL,
        choices: [{ message: { content: "", tool_calls: [{
          id: "call-wrong", type: "function", function: { name: "other_tool", arguments: "{}" }
        }] } }]
      }), { status: 200 })
    });
    await expect(wrongName.respond(request())).rejects.toMatchObject({
      code: "security",
      reason: "INVALID_TOOL_RESPONSE"
    });
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
