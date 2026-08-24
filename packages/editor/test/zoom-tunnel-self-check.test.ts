import { describe, expect, it } from "vitest";
import { runZoomTunnelSelfCheck, zoomTunnelSamplingPlan } from "../src/zoom-tunnel-self-check.js";
import { selfCheckFixture } from "./self-check-test-helpers.js";

describe("zoom_tunnel dedicated self-check", () => {
  it("keeps transition-before evidence and covers tunnel entry through completion", async () => {
    const request = await selfCheckFixture("zoom_tunnel", { transitionStart: 1, duration: 1 }, { durationSeconds: 4 });
    expect(zoomTunnelSamplingPlan(request).map((item) => item.role)).toEqual([
      "before_tunnel", "tunnel_onset", "tunnel_enter", "tunnel_middle", "tunnel_exit", "tunnel_complete"
    ]);
    const artifacts = await runZoomTunnelSelfCheck(request);
    expect(artifacts.json.summary.description).toMatch(/缩放穿梭/u);
    expect(artifacts.json.metadata.effect_observation).toMatchObject({ completion: "完成" });
    expect(artifacts.json.metadata.keyframe_evidence.image_count).toBe(6);
  });
});
