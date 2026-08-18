import { describe, expect, it } from "vitest";
import type { SelectedEffectToolView } from "../src/effect-tool-client.js";
import {
  filterEffectTools,
  imageUploadRequirement,
  reconcileSelectedAssetIds,
  turnInputIds,
  turnInputIdsForAssets
} from "../src/EffectToolConsole.js";
import type { BrowserAssetSummaryV1 } from "../src/media-asset-client.js";

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
  cardinality: "one" | "many" = "one",
  acceptsUploadedVideo = false
) {
  return {
    name,
    kind,
    required,
    cardinality,
    description: name,
    acceptedMimeTypes: [],
    acceptsUploadedImage,
    acceptsUploadedVideo
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

  it("binds two independent uploaded images for blend", () => {
    const blend = tool({
      toolName: "blend",
      inputRequirements: [input("source_layer", "data"), input("overlay_layer", "image")]
    });
    const assetIds = ["asset_blendbase00", "asset_blendover00"];

    expect(imageUploadRequirement(blend)).toEqual({ min: 2, max: 2 });
    expect(turnInputIds(blend, assetIds)).toEqual({
      source_layer: assetIds[0],
      overlay_layer: assetIds[1]
    });
  });

  it.each([
    ["blob_morph", [["source_shape", "data"]]],
    ["bounce", [["source_layer", "data"]]],
    ["brush_reveal", [["vector_source", "data"], ["brush_texture", "texture"]]],
    ["chalk_stroke", [["vector_source", "data"]]],
    ["character_cascade", [["text_raster", "data"]]],
    ["chart_reveal", [["chart_data", "data"]]],
    ["dash_flow", [["source_path", "data"]]]
  ] as const)("requires no upload for prompt-only tool %s", (toolName, slots) => {
    const promptOnly = tool({
      toolName,
      inputRequirements: slots.map(([name, kind]) => input(name, kind, true, false))
    });

    expect(imageUploadRequirement(promptOnly)).toEqual({ min: 0, max: 0 });
    expect(turnInputIds(promptOnly, [])).toEqual({});
  });

  it("binds one uploaded video without counting server-derived analysis as a second asset", () => {
    const smartCrop = tool({
      toolName: "smart_crop_animate",
      inputRequirements: [
        input("source_video", "video", true, true, "one", true),
        input("subject_tracks", "data", true, false)
      ]
    });
    expect(imageUploadRequirement(smartCrop)).toEqual({ min: 1, max: 1 });
    expect(turnInputIds(smartCrop, ["asset_videoabcdefgh"]))
      .toEqual({ source_video: "asset_videoabcdefgh" });
  });

  it("binds mixed foreground video and background image by media kind rather than picker order", () => {
    const compose = tool({
      toolName: "background_remove_compose",
      inputRequirements: [
        input("foreground_video", "video", true, true, "one", true),
        input("foreground_matte", "mask", true, false),
        input("background_image", "image")
      ]
    });
    const asset = (assetId: string, kind: "image" | "video") => ({
      assetId, kind, displayName: assetId, mime: kind === "video" ? "video/mp4" : "image/png",
      codec: kind === "video" ? "h264" : "png", bytes: 100, uploadedAt: new Date(0).toISOString(),
      allowedPurposes: [kind === "video" ? "reference-video" : "reference-image"]
    }) as BrowserAssetSummaryV1;
    expect(turnInputIdsForAssets(compose, [asset("asset_bg00000000", "image"), asset("asset_fg00000000", "video")]))
      .toEqual({ foreground_video: "asset_fg00000000", background_image: "asset_bg00000000" });
  });

  it("requires one upload when the server derives depth or stroke geometry", () => {
    const depth = tool({
      toolName: "depth_of_field",
      inputRequirements: [
        input("source_frame", "image"),
        input("depth_field", "depth-map", true, false)
      ]
    });
    const paint = tool({
      toolName: "paint_on",
      inputRequirements: [
        input("source_image", "image"),
        input("stroke_plan", "data", true, false)
      ]
    });
    for (const derived of [depth, paint]) {
      expect(imageUploadRequirement(derived)).toEqual({ min: 1, max: 1 });
      expect(turnInputIds(derived, ["asset_imageabcdefgh"]))
        .toEqual({ [derived.inputRequirements[0]!.name]: "asset_imageabcdefgh" });
    }
  });

  it.each(["particle_snow_rain", "particle_spark"])(
    "requires one background image for %s",
    (toolName) => {
      const particleTool = tool({
        toolName,
        inputRequirements: [input("background_image", "image")]
      });
      expect(imageUploadRequirement(particleTool)).toEqual({ min: 1, max: 1 });
      expect(turnInputIds(particleTool, ["asset_imageabcdefgh"]))
        .toEqual({ background_image: "asset_imageabcdefgh" });
    }
  );

  it.each([
    ["sim_boids", "background_image"],
    ["sim_cloth", "cloth_image"],
    ["sim_collision_shatter", "source_image"],
    ["sim_fluid_lite", "source_image"],
    ["sim_rigid_body_2d", "source_image"],
    ["sim_rope", "source_image"],
    ["sim_soft_body", "source_image"],
    ["sim_spring", "source_image"]
  ])("requires exactly one image for %s", (toolName, slotName) => {
    const simulation = tool({
      toolName,
      inputRequirements: [
        input(slotName, "image"),
        input("server_geometry", "data", false)
      ]
    });
    expect(imageUploadRequirement(simulation)).toEqual({ min: 1, max: 1 });
    expect(turnInputIds(simulation, ["asset_imageabcdefgh"]))
      .toEqual({ [slotName]: "asset_imageabcdefgh" });
  });

  it("keeps camera targets, match masks, and preview depth server-derived", () => {
    const dollyZoom = tool({
      toolName: "dolly_zoom",
      inputRequirements: [
        input("source_video", "video"),
        input("camera_target", "data", true, false)
      ]
    });
    const objectMatch = tool({
      toolName: "object_match_cut",
      inputRequirements: [
        input("from_video", "video"), input("to_video", "video"),
        input("from_match_mask", "mask", true, false), input("to_match_mask", "mask", true, false)
      ]
    });
    const parallax = tool({
      toolName: "parallax_layers",
      inputRequirements: [
        input("source_video", "video"),
        input("depth_map", "depth-map", true, false),
        input("camera_target", "data", false, false)
      ]
    });

    expect(imageUploadRequirement(dollyZoom)).toEqual({ min: 1, max: 1 });
    expect(turnInputIds(dollyZoom, ["asset_imageabcdefgh"]))
      .toEqual({ source_video: "asset_imageabcdefgh" });
    expect(imageUploadRequirement(objectMatch)).toEqual({ min: 2, max: 2 });
    expect(turnInputIds(objectMatch, ["asset_imageabcdefgh", "asset_imageijklmnop"]))
      .toEqual({ from_video: "asset_imageabcdefgh", to_video: "asset_imageijklmnop" });
    expect(imageUploadRequirement(parallax)).toEqual({ min: 1, max: 1 });
    expect(turnInputIds(parallax, ["asset_imageabcdefgh"]))
      .toEqual({ source_video: "asset_imageabcdefgh" });
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
