import { describe, expect, it } from "vitest";
import type { EffectRenderResult } from "@codemotion/effect-functions";
import { composeEffectToolFrame } from "../src/effect-tool-frame-compositor.js";

const request = {
  frame: 0,
  time: 0,
  deltaTime: 1 / 30,
  fps: 30,
  width: 1,
  height: 1
};

function frame(data: readonly number[]): EffectRenderResult {
  return {
    kind: "frame",
    backendId: "test",
    degraded: false,
    warnings: [],
    output: { width: 1, height: 1, data: Uint8Array.from(data) }
  };
}

describe("effect tool frame compositor", () => {
  it("composites transparent text effect frames over the uploaded source image", () => {
    const source = Uint8Array.from([10, 20, 30, 255]);
    expect([...composeEffectToolFrame(frame([250, 0, 0, 128]), request, "typewriter", source)])
      .toEqual([130, 10, 15, 255]);
    expect([...composeEffectToolFrame(frame([250, 0, 0, 128]), request, "film_grain", source)])
      .toEqual([250, 0, 0, 128]);
  });
});
