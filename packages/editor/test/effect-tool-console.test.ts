import { describe, expect, it } from "vitest";
import type { SelectedEffectToolView } from "../src/effect-tool-client.js";
import { filterEffectTools, turnInputIds } from "../src/EffectToolConsole.js";

function tool(overrides: Partial<SelectedEffectToolView> = {}): SelectedEffectToolView {
  return {
    toolName: "film_grain",
    displayName: "胶片颗粒",
    category: "post",
    configured: true,
    inputRequirements: [],
    ...overrides
  };
}

function input(
  name: string,
  kind: SelectedEffectToolView["inputRequirements"][number]["kind"],
  required = true,
  acceptsUploadedImage = true
) {
  return {
    name,
    kind,
    required,
    cardinality: "one" as const,
    description: name,
    acceptedMimeTypes: [],
    acceptsUploadedImage
  };
}

describe("120-tool selector helpers", () => {
  it("searches Chinese display names, snake_case names, and categories", () => {
    const tools = [
      tool(),
      tool({ toolName: "depth_of_field", displayName: "景深", category: "camera" }),
      tool({ toolName: "particle_spark", displayName: "火花粒子", category: "particle" })
    ];
    expect(filterEffectTools(tools, "胶片").map((item) => item.toolName)).toEqual(["film_grain"]);
    expect(filterEffectTools(tools, "depth_of").map((item) => item.toolName)).toEqual(["depth_of_field"]);
    expect(filterEffectTools(tools, "PARTICLE").map((item) => item.toolName)).toEqual(["particle_spark"]);
  });

  it("binds one uploaded image to one explicit slot for server-side preview derivation", () => {
    const depth = tool({
      toolName: "depth_of_field",
      inputRequirements: [input("source_frame", "image"), input("depth_field", "depth-map")]
    });
    expect(turnInputIds(depth, "asset_imageabcdefgh")).toEqual({
      source_frame: "asset_imageabcdefgh"
    });

    const transition = tool({
      toolName: "wipe",
      inputRequirements: [input("source_frame", "image"), input("target_frame", "image")]
    });
    expect(turnInputIds(transition, "asset_imageabcdefgh")).toEqual({
      source_frame: "asset_imageabcdefgh"
    });

    const audio = tool({
      toolName: "beat_pulse",
      inputRequirements: [input("audio_analysis", "audio")]
    });
    expect(turnInputIds(audio, "asset_imageabcdefgh")).toEqual({
      audio_analysis: "asset_imageabcdefgh"
    });
  });
});
