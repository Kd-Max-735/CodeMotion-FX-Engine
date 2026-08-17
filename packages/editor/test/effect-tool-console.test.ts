import { describe, expect, it } from "vitest";
import type { SelectedEffectToolView } from "../src/effect-tool-client.js";
import {
  filterEffectTools,
  imageUploadRequirement,
  reconcileSelectedAssetIds,
  turnInputIds
} from "../src/EffectToolConsole.js";

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
  acceptsUploadedImage = true,
  cardinality: "one" | "many" = "one"
) {
  return {
    name,
    kind,
    required,
    cardinality,
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

  it("binds distinct uploaded images to the selected tool slots in declaration order", () => {
    const transition = tool({
      toolName: "wipe",
      inputRequirements: [input("source_frame", "image"), input("target_frame", "image")]
    });
    expect(turnInputIds(transition, ["asset_imageabcdefgh", "asset_imageijklmnop"])).toEqual({
      source_frame: "asset_imageabcdefgh",
      target_frame: "asset_imageijklmnop"
    });

    const fourFrames = tool({
      toolName: "four_frame_transition",
      inputRequirements: ["a", "b", "c", "d"].map((name) => input(name, "image"))
    });
    expect(turnInputIds(fourFrames, ["asset_a0000000", "asset_b0000000", "asset_c0000000", "asset_d0000000"]))
      .toEqual({
        a: "asset_a0000000",
        b: "asset_b0000000",
        c: "asset_c0000000",
        d: "asset_d0000000"
      });
  });

  it("maps multi-image tools and reports their upload limits", () => {
    const single = tool({ inputRequirements: [input("source_frame", "image")] });
    const transition = tool({
      inputRequirements: [input("source_frame", "image"), input("target_frame", "image")]
    });
    const stack = tool({
      toolName: "photo_stack",
      inputRequirements: [input("source_images", "image", true, true, "many")]
    });
    const stackIds = ["asset_imageabcdefgh", "asset_imageijklmnop", "asset_imageqrstuvwx"];

    expect(imageUploadRequirement(single)).toEqual({ min: 1, max: 1 });
    expect(imageUploadRequirement(transition)).toEqual({ min: 2, max: 2 });
    expect(imageUploadRequirement(stack)).toEqual({ min: 2, max: 32 });
    expect(turnInputIds(stack, stackIds)).toEqual({ source_images: stackIds });
  });

  it("preserves available selections, truncates excess, and fills the required minimum", () => {
    const transition = tool({
      inputRequirements: [input("source_frame", "image"), input("target_frame", "image")]
    });
    expect(reconcileSelectedAssetIds(
      transition,
      ["asset_missing000", "asset_imageb000000"],
      ["asset_imagea000000", "asset_imageb000000", "asset_imagec000000"]
    )).toEqual(["asset_imageb000000", "asset_imagea000000"]);
  });
});
