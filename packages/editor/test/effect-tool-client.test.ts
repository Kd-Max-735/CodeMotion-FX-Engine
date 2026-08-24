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

  it("parses the visible wave_path self-check view and builds an owner-scoped evidence URL", async () => {
    const checks = [
      "WP_EXECUTION_INTEGRITY", "WP_BASELINE_AND_DIRECTION", "WP_WAVE_GEOMETRY",
      "WP_PHASE_AND_MOTION", "WP_TAPER_BEHAVIOR", "WP_FRAME_SAFETY", "WP_USER_INTENT"
    ].map((ruleId) => ({
      ruleId,
      status: "pass",
      evidenceRefs: ["keyframe_contact_sheet"],
      reason: "证据一致。"
    }));
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      execution: {
        id: "execution-wave-path",
        status: "completed",
        toolName: "wave_path",
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:01.000Z",
        source: { kind: "image", assetId: "asset_imageabcdefgh" },
        video: {
          format: "mp4", mime: "video/mp4", width: 640, height: 360, fps: 30,
          durationSeconds: 5, frameCount: 150, completedFrames: 150, progress: 1,
          audio: false, bytes: 1234, downloadName: "wave-path.mp4"
        },
        gpu: { available: false, message: "unavailable" },
        selfCheck: {
          status: "pass",
          automatic: true,
          toolName: "wave_path",
          ruleVersion: "1.2.0",
          evidenceContractVersion: "1.2.0",
          evidenceStatus: "sufficient",
          macroView: {
            file_name: "wave_path.mp4",
            original_request: "生成路径波浪",
            summary: { key_information: [{ label: "波动强度", value: "明显" }] },
            metadata: { quality: { black_frame_ratio: 0 } }
          },
          evidenceImages: [{
            evidenceId: "keyframe_contact_sheet", label: "最终 MP4 关键帧合成图", mime: "image/png",
            width: 928, height: 317
          }],
          result: { status: "pass", summary: "全部通过。", checks, issues: [] }
        }
      }
    })));

    const execution = await selectedEffectToolApi.execution("execution-wave-path", "wave_path");
    expect(execution).toMatchObject({
      selfCheck: {
        status: "pass",
        evidenceStatus: "sufficient",
        evidenceImages: [{ evidenceId: "keyframe_contact_sheet" }],
        result: { status: "pass" }
      }
    });
    expect(execution.selfCheck?.result?.checks[0]?.ruleId).toBe("WP_EXECUTION_INTEGRITY");
    expect(selectedEffectToolApi.selfCheckEvidenceUrl("execution-wave-path", "keyframe_contact_sheet"))
      .toBe("/api/effect-tools/v3/executions/execution-wave-path/self-check/evidence/keyframe_contact_sheet");
  });

  it("parses an observed beat_pulse self-check without treating it as an authentication failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      execution: {
        id: "execution-beat-pulse",
        status: "completed",
        toolName: "beat_pulse",
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:01.000Z",
        video: {
          format: "mp4", mime: "video/mp4", width: 640, height: 360, fps: 30,
          durationSeconds: 5, frameCount: 150, completedFrames: 150, progress: 1,
          audio: false, bytes: 1234, downloadName: "beat-pulse.mp4"
        },
        gpu: { available: false, message: "unavailable" },
        selfCheck: {
          status: "fail",
          automatic: true,
          toolName: "beat_pulse",
          ruleVersion: "1.0.0",
          evidenceContractVersion: "1.0.0",
          evidenceStatus: "sufficient",
          macroView: { file_name: "beat-pulse.mp4", original_request: "跟随节拍脉冲" },
          evidenceImages: [{
            evidenceId: "keyframe_contact_sheet", label: "节拍脉冲关键帧", mime: "image/png",
            width: 928, height: 317
          }],
          result: {
            status: "fail",
            summary: "脉冲不够明显。",
            checks: [{ name: "visible_effect", status: "fail", reason: "未观察到清晰脉冲。" }],
            issues: ["节拍峰值没有形成清晰可见的脉冲。"]
          }
        }
      }
    })));

    const execution = await selectedEffectToolApi.execution("execution-beat-pulse", "beat_pulse");
    expect(execution.selfCheck?.result).toMatchObject({
      checks: [{ name: "visible_effect", status: "fail" }],
      issues: [{ message: "节拍峰值没有形成清晰可见的脉冲。" }]
    });
  });
});
