import { afterEach, describe, expect, it, vi } from "vitest";
import { selectedEffectToolApi } from "../src/effect-tool-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("selected effect-tool browser client", () => {
  it("accepts exactly 120 unique Registry catalog items with input summaries", async () => {
    const tools = Array.from({ length: 120 }, (_, index) => ({
      toolName: `tool_${index}`,
      displayName: `工具 ${index}`,
      category: index % 2 === 0 ? "post" : "motion",
      configured: true,
      inputRequirements: [{
        name: "source_frame",
        kind: "image",
        required: true,
        cardinality: "one",
        description: "源图片",
        acceptedMimeTypes: ["image/png"],
        acceptsUploadedImage: true
      }]
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ count: 120, tools })));

    const catalog = await selectedEffectToolApi.catalog();
    expect(catalog).toHaveLength(120);
    expect(catalog[73]).toMatchObject({
      toolName: "tool_73",
      displayName: "工具 73",
      inputRequirements: [{ name: "source_frame", acceptsUploadedImage: true }]
    });
  });

  it("sends the exact selected toolName in a closed v3 turn and validates response identity", async () => {
    vi.stubGlobal("document", { cookie: "cmfx_dev_csrf=test-csrf-token" });
    const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        toolName: "film_grain",
        prompt: "解释 temporal",
        inputIds: {}
      });
      expect(new Headers(init?.headers).get("X-CMFX-CSRF")).toBe("test-csrf-token");
      return jsonResponse({
        turn: {
          kind: "message",
          tool: { toolName: "film_grain", displayName: "胶片颗粒", category: "post" },
          reasoningContent: "用户正在询问参数。",
          content: "temporal 控制颗粒随时间变化的程度。"
        }
      });
    });
    vi.stubGlobal("fetch", transport);

    await expect(selectedEffectToolApi.turn({
      toolName: "film_grain",
      prompt: "解释 temporal",
      inputIds: {}
    })).resolves.toMatchObject({
      kind: "message",
      tool: { toolName: "film_grain", displayName: "胶片颗粒" }
    });
    expect(transport).toHaveBeenCalledOnce();
  });
});
