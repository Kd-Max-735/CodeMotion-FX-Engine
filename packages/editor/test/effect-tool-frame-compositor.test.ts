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

function metadata(output: Record<string, unknown>): EffectRenderResult {
  return {
    kind: "metadata",
    backendId: "test",
    degraded: false,
    warnings: [],
    output
  };
}

const detailedRequest = {
  frame: 18,
  time: 0.6,
  deltaTime: 1 / 30,
  fps: 30,
  width: 96,
  height: 64
};

function solidSource(): Uint8Array {
  const source = new Uint8Array(detailedRequest.width * detailedRequest.height * 4);
  for (let offset = 0; offset < source.length; offset += 4) {
    source[offset] = 18;
    source[offset + 1] = 24;
    source[offset + 2] = 32;
    source[offset + 3] = 255;
  }
  return source;
}

function gradientSource(redBias = 0, blueBias = 0): Uint8Array {
  const source = new Uint8Array(detailedRequest.width * detailedRequest.height * 4);
  for (let y = 0; y < detailedRequest.height; y += 1) {
    for (let x = 0; x < detailedRequest.width; x += 1) {
      const offset = (y * detailedRequest.width + x) * 4;
      source[offset] = Math.min(255, redBias + x * 2);
      source[offset + 1] = Math.min(255, 24 + y * 3);
      source[offset + 2] = Math.min(255, blueBias + (x + y) % 64);
      source[offset + 3] = 255;
    }
  }
  return source;
}

function changedPixelCount(source: Uint8Array, output: Uint8Array): number {
  let count = 0;
  for (let offset = 0; offset < source.length; offset += 4) {
    if (source[offset] !== output[offset] || source[offset + 1] !== output[offset + 1]
      || source[offset + 2] !== output[offset + 2]) count += 1;
  }
  return count;
}

function rightMarkerSource(): Uint8Array {
  const source = new Uint8Array(detailedRequest.width * detailedRequest.height * 4);
  for (let y = 0; y < detailedRequest.height; y += 1) {
    for (let x = 0; x < detailedRequest.width; x += 1) {
      const offset = (y * detailedRequest.width + x) * 4;
      source[offset] = x >= 70 && x <= 72 ? 255 : 0;
      source[offset + 3] = 255;
    }
  }
  return source;
}

function redCentroidX(frame: Uint8Array): number {
  let weightedX = 0;
  let weight = 0;
  for (let y = 0; y < detailedRequest.height; y += 1) for (let x = 0; x < detailedRequest.width; x += 1) {
    const value = frame[(y * detailedRequest.width + x) * 4]!;
    weightedX += x * value;
    weight += value;
  }
  return weightedX / weight;
}

describe("effect tool frame compositor", () => {
  it("composites transparent text effect frames over the uploaded source image", () => {
    const source = Uint8Array.from([10, 20, 30, 255]);
    expect([...composeEffectToolFrame(frame([250, 0, 0, 128]), request, "typewriter", source)])
      .toEqual([130, 10, 15, 255]);
    expect([...composeEffectToolFrame(frame([250, 0, 0, 128]), request, "film_grain", source)])
      .toEqual([250, 0, 0, 128]);
  });

  it.each([
    "blob_morph", "dash_flow", "electric_arc", "lightning_trace", "marker_stroke",
    "shape_boolean_animate", "volumetric_ray", "wave_path", "neon_trace", "paint_on",
    "particle_dissolve", "particle_logo_assemble", "particle_snow_rain", "particle_spark",
    "particle_trail", "particle_emitter", "particle_flow_field", "particle_orbit_field",
    "sim_boids", "sim_cloth", "sim_collision_shatter", "sim_fluid_lite",
    "sim_rigid_body_2d", "sim_rope", "sim_soft_body", "sim_spring",
    "dolly", "dolly_zoom", "handheld", "object_match_cut", "orbit", "page_turn",
    "pan_tilt", "parallax_layers", "portal", "zoom_tunnel", "unpolished_example"
  ])(
    "does not add the generic moving scanline to %s",
    (toolName) => {
      const source = solidSource();
      expect(composeEffectToolFrame(undefined, detailedRequest, toolName, source)).toEqual(source);
    }
  );

  it.each([
    ["blob_morph", {
      points: [{ x: 20, y: 12 }, { x: 66, y: 8 }, { x: 82, y: 34 }, { x: 58, y: 55 }, { x: 18, y: 48 }],
      center: { x: 49, y: 31 }, closed: true
    }],
    ["dash_flow", {
      segments: [
        { points: [{ x: 10, y: 38 }, { x: 28, y: 13 }, { x: 48, y: 30 }] },
        { points: [{ x: 56, y: 34 }, { x: 72, y: 52 }, { x: 88, y: 24 }] }
      ], lineCap: "round"
    }],
    ["electric_arc", {
      arcs: [{ points: [{ x: 8, y: 46 }, { x: 24, y: 16 }, { x: 43, y: 42 }, { x: 68, y: 12 }, { x: 90, y: 38 }] }],
      branches: [{ points: [{ x: 43, y: 42 }, { x: 52, y: 51 }, { x: 61, y: 47 }], intensity: 0.7 }],
      glowRadius: 12, intensity: 1.5
    }],
    ["lightning_trace", {
      main: [{ x: 8, y: 42 }, { x: 22, y: 18 }, { x: 39, y: 40 }, { x: 58, y: 14 }, { x: 86, y: 32 }],
      branches: [{ points: [{ x: 39, y: 40 }, { x: 49, y: 54 }, { x: 60, y: 49 }], intensity: 0.65 }],
      glowRadius: 10, revealProgress: 0.6
    }],
    ["marker_stroke", {
      dabs: [
        { center: { x: 18, y: 43 }, width: 20, height: 16, opacity: 0.82, angle: -0.3 },
        { center: { x: 34, y: 35 }, width: 22, height: 17, opacity: 0.8, angle: -0.2 },
        { center: { x: 51, y: 31 }, width: 23, height: 18, opacity: 0.84, angle: 0.08 },
        { center: { x: 69, y: 36 }, width: 21, height: 17, opacity: 0.81, angle: 0.28 }
      ], bleed: 0.2, edgeRoughness: 0.12, revealProgress: 1
    }]
  ] as const)("renders a substantial specialized visual for %s", (toolName, value) => {
    const source = solidSource();
    const output = composeEffectToolFrame(metadata(value), detailedRequest, toolName, source);
    expect(changedPixelCount(source, output)).toBeGreaterThan(80);
  });

  it.each([
    ["shape_boolean_animate", {
      width: 4, height: 3,
      alpha: [0, 0.3, 0.8, 0, 0.2, 1, 1, 0.25, 0, 0.45, 0.7, 0],
      shapeA: [{ x: 12, y: 12 }, { x: 54, y: 10 }, { x: 48, y: 48 }, { x: 15, y: 50 }],
      shapeB: [{ x: 38, y: 8 }, { x: 84, y: 22 }, { x: 70, y: 56 }, { x: 34, y: 43 }],
      operation: "xor", progress: 0.65
    }],
    ["volumetric_ray", {
      width: 4, height: 3,
      radiance: [0.05, 0.4, 1.2, 0.3, 0.02, 0.28, 0.92, 0.2, 0, 0.12, 0.5, 0.08],
      lightX: 0.72, lightY: 0.08
    }],
    ["wave_path", {
      sourcePoints: [{ x: 8, y: 34 }, { x: 30, y: 30 }, { x: 55, y: 35 }, { x: 88, y: 28 }],
      points: [{ x: 8, y: 34 }, { x: 30, y: 14 }, { x: 55, y: 51 }, { x: 88, y: 28 }],
      amplitude: 28
    }],
    ["neon_trace", {
      points: [{ x: 10, y: 42 }, { x: 26, y: 15 }, { x: 51, y: 48 }, { x: 78, y: 18 }, { x: 90, y: 32 }],
      coreWidth: 3, coreIntensity: 2.4, hue: 310,
      glowLayers: [{ radius: 24, intensity: 0.4 }, { radius: 12, intensity: 0.9 }, { radius: 5, intensity: 1.7 }]
    }],
    ["paint_on", {
      dabs: [
        { x: 18, y: 22, width: 34, height: 34, angle: 0.15 },
        { x: 45, y: 31, width: 34, height: 34, angle: -0.1 },
        { x: 73, y: 42, width: 34, height: 34, angle: 0.2 }
      ], brushShape: "round", hardness: 0.72, feather: 4, coverage: 0.6
    }]
  ] as const)("renders the reported %s output as a full visual rather than generic geometry", (toolName, value) => {
    const source = solidSource();
    const output = composeEffectToolFrame(metadata(value), detailedRequest, toolName, source);
    expect(changedPixelCount(source, output)).toBeGreaterThan(160);
  });

  it.each([
    ["electric_arc", { arcs: [{ points: [{ x: 8, y: 8 }, { x: 88, y: 56 }] }], intensity: 0, glowRadius: 20 }],
    ["marker_stroke", {
      dabs: [{ center: { x: 48, y: 32 }, width: 40, height: 30, opacity: 0, angle: 0 }],
      bleed: 0.3, edgeRoughness: 0.2, revealProgress: 1
    }]
  ] as const)("keeps %s visually neutral when its opacity control is zero", (toolName, value) => {
    const source = solidSource();
    expect(composeEffectToolFrame(metadata(value), detailedRequest, toolName, source)).toEqual(source);
  });

  it("composites particle masks, source overlays, glow discs, and velocity streaks", () => {
    const source = solidSource();
    const mask = new Uint8Array(detailedRequest.width * detailedRequest.height).fill(255);
    mask.fill(0, 0, Math.floor(mask.length / 2));
    const particleOutput = {
      format: "codemotion-particle-buffer/v1",
      width: detailedRequest.width,
      height: detailedRequest.height,
      time: detailedRequest.time,
      primitive: "streak",
      count: 2,
      positions: new Float32Array([32, 24, 66, 40]),
      velocities: new Float32Array([260, -80, -180, 120]),
      sizes: new Float32Array([3, 4]),
      opacities: new Float32Array([0.9, 0.75]),
      colors: new Uint8ClampedArray([255, 186, 60, 255, 90, 210, 255, 255]),
      sourceComposite: { slot: "target_image", opacity: 1, mask },
      glow: 1.8
    };
    const output = composeEffectToolFrame(metadata(particleOutput), detailedRequest,
      "particle_dissolve", source);
    expect([...output.slice(0, 4)]).toEqual([0, 0, 0, 0]);
    expect([...output.slice(output.length - 4)]).toEqual([...source.slice(source.length - 4)]);
    expect(changedPixelCount(source, output)).toBeGreaterThan(mask.length / 2);
  });

  it("starts logo particles on a blank canvas without the generic logo wipe", () => {
    const source = solidSource();
    const output = composeEffectToolFrame(metadata({
      format: "codemotion-particle-buffer/v1",
      width: detailedRequest.width,
      height: detailedRequest.height,
      time: 0,
      primitive: "disc",
      count: 0,
      positions: new Float32Array(),
      velocities: new Float32Array(),
      sizes: new Float32Array(),
      opacities: new Float32Array(),
      colors: new Uint8ClampedArray(),
      glow: 0.5
    }), detailedRequest, "particle_logo_assemble", source);
    expect([...output.slice(0, 4)]).toEqual([5, 8, 14, 255]);
    expect(new Set(Array.from({ length: output.length / 4 }, (_, index) =>
      output.slice(index * 4, index * 4 + 4).join(",")))).toEqual(new Set(["5,8,14,255"]));
  });

  it.each([
    ["particle_flow_field", { particles: [
      { x: -0.4, y: -0.2, vx: 1.2, vy: 0.4 }, { x: 0.2, y: 0.1, vx: -0.5, vy: 1.1 }
    ] }],
    ["particle_orbit_field", { particles: [
      { x: -0.35, y: 0, vx: 0, vy: -1.3 }, { x: 0.35, y: 0, vx: 0, vy: 1.3 }
    ] }],
    ["sim_boids", { boids: [
      { x: -0.2, y: -0.1, vx: 0.8, vy: 0.3 }, { x: 0.3, y: 0.2, vx: -0.6, vy: 0.4 }
    ] }],
    ["sim_cloth", { vertices: [
      { x: -0.7, y: -0.7 }, { x: 0.7, y: -0.65 }, { x: -0.6, y: 0.55 }, { x: 0.62, y: 0.62 }
    ] }],
    ["sim_collision_shatter", { fragments: [
      { x: -0.5, y: -0.35, rotation: -0.2 }, { x: 0.45, y: -0.28, rotation: 0.25 },
      { x: -0.35, y: 0.45, rotation: 0.15 }, { x: 0.5, y: 0.4, rotation: -0.32 }
    ] }],
    ["sim_fluid_lite", { gridSize: 2, cells: [
      { density: 0.2, vx: 0.1, vy: -0.2 }, { density: 1, vx: -0.4, vy: -0.6 },
      { density: 0.5, vx: 0.3, vy: -0.1 }, { density: 0.1, vx: 0, vy: 0 }
    ] }],
    ["sim_rigid_body_2d", { bodies: [
      { x: -0.35, y: 0.25, radius: 0.16 }, { x: 0.4, y: 0.45, radius: 0.13 }
    ] }],
    ["sim_rope", { points: [
      { x: -0.6, y: -0.6 }, { x: -0.3, y: -0.1 }, { x: 0.1, y: 0.25 }, { x: 0.55, y: 0.5 }
    ] }],
    ["sim_soft_body", { nodes: [
      { x: -0.45, y: 0.1 }, { x: 0, y: -0.3 }, { x: 0.48, y: 0.12 }, { x: 0.28, y: 0.58 }, { x: -0.3, y: 0.55 }
    ] }],
    ["sim_spring", { nodes: [
      { x: -0.65, y: -0.45 }, { x: -0.3, y: -0.1 }, { x: 0.05, y: 0.12 }, { x: 0.42, y: 0.48 }
    ] }]
  ] as const)("renders a dedicated material visual for %s", (toolName, state) => {
    const source = solidSource();
    const output = composeEffectToolFrame(metadata({ state }), detailedRequest, toolName, source);
    expect(changedPixelCount(source, output)).toBeGreaterThan(300);
  });

  it("maps positive simulation gravity toward the bottom of the frame", () => {
    const source = solidSource();
    const output = composeEffectToolFrame(metadata({ state: { nodes: [
      { x: -0.35, y: 0.35 }, { x: 0, y: 0.18 }, { x: 0.35, y: 0.35 },
      { x: 0.22, y: 0.72 }, { x: -0.24, y: 0.7 }
    ] } }), detailedRequest, "sim_soft_body", source);
    const brightnessAt = (x: number, y: number): number => {
      const offset = (y * detailedRequest.width + x) * 4;
      return output[offset]! + output[offset + 1]! + output[offset + 2]!;
    };
    expect(brightnessAt(48, 46)).toBeGreaterThan(brightnessAt(48, 12));
  });

  it("renders forward and backward dolly movement in opposite visual directions", () => {
    const source = gradientSource();
    const forward = composeEffectToolFrame(metadata({
      operation: "camera_linear_dolly", position: { x: 0, y: 0, z: -6 },
      rotationDegrees: { x: 0, y: 0, z: 0 }, progress: 0.8
    }), detailedRequest, "dolly", source, { source_video: source });
    const backward = composeEffectToolFrame(metadata({
      operation: "camera_linear_dolly", position: { x: 0, y: 0, z: 6 },
      rotationDegrees: { x: 0, y: 0, z: 0 }, progress: 0.8
    }), detailedRequest, "dolly", source, { source_video: source });
    expect(forward).not.toEqual(backward);
    expect(changedPixelCount(source, forward)).toBeGreaterThan(500);
    expect(changedPixelCount(source, backward)).toBeGreaterThan(500);
  });

  it("maps dolly zoom forward outward and backward inward", () => {
    const source = rightMarkerSource();
    const render = (positionZ: number) => composeEffectToolFrame(metadata({
      operation: "camera_dolly_zoom",
      position: { x: 0, y: 0, z: positionZ },
      rotationDegrees: { x: 0, y: 0, z: 0 },
      progress: 0.75,
      verticalFovDegrees: positionZ < 0 ? 65 : 35
    }), detailedRequest, "dolly_zoom", source, { source_video: source });
    const forward = render(-6);
    const backward = render(6);
    expect(redCentroidX(forward)).toBeGreaterThan(redCentroidX(source));
    expect(redCentroidX(backward)).toBeLessThan(redCentroidX(source));
  });

  it.each([
    ["dolly_zoom", {
      operation: "camera_dolly_zoom", position: { x: 0, y: 0, z: 6 },
      rotationDegrees: { x: 0, y: 0, z: 0 }, progress: 0.75, verticalFovDegrees: 28
    }],
    ["handheld", {
      operation: "deterministic_handheld_camera", position: { x: 0.08, y: -0.05, z: 0.02 },
      rotationDegrees: { x: 1.2, y: -0.8, z: 1.7 }, progress: 1
    }],
    ["pan_tilt", {
      operation: "camera_pan_tilt", position: { x: 0, y: 0, z: 0 },
      rotationDegrees: { x: 24, y: -42, z: 0 }, progress: 0.7
    }],
    ["orbit", {
      operation: "camera_target_orbit", position: { x: 5, y: 1.2, z: -4 },
      rotationDegrees: { x: -12, y: 85, z: 0 }, progress: 0.8
    }]
  ] as const)("renders a dedicated camera treatment for %s", (toolName, value) => {
    const source = gradientSource();
    const output = composeEffectToolFrame(metadata(value), detailedRequest, toolName, source, {
      source_video: source
    });
    expect(changedPixelCount(source, output)).toBeGreaterThan(500);
  });

  it("uses the derived depth map to produce layered parallax from one source image", () => {
    const source = gradientSource();
    const depth = new Uint8Array(detailedRequest.width * detailedRequest.height);
    for (let y = 0; y < detailedRequest.height; y += 1) {
      for (let x = 0; x < detailedRequest.width; x += 1) {
        depth[y * detailedRequest.width + x] = Math.round(x / (detailedRequest.width - 1) * 255);
      }
    }
    const output = composeEffectToolFrame(metadata({
      operation: "depth_map_parallax_layers", position: { x: 5, y: -2, z: 7 },
      rotationDegrees: { x: 0, y: 0, z: 0 }, progress: 0.8
    }), detailedRequest, "parallax_layers", source, { source_video: source, depth_map: depth });
    expect(changedPixelCount(source, output)).toBeGreaterThan(500);
  });

  it.each([
    ["page_turn", {
      operation: "page_turn_mesh", progress: 0.52,
      sheet: { rotationYDegrees: -94, shadowOpacity: 0.45 }
    }],
    ["portal", {
      operation: "radial_portal_wipe", progress: 0.55,
      aperture: { radius: 0.52, featherWidth: 0.08, rotationDegrees: 160, glowStrength: 0.8 }
    }],
    ["zoom_tunnel", {
      operation: "perspective_zoom_tunnel", progress: 0.5,
      outgoing: { scale: 2.1, opacity: 0.5 }, incoming: { scale: 0.55, opacity: 0.5 },
      twistDegrees: 50, motionBlur: 0.7
    }],
    ["object_match_cut", {
      operation: "masked_object_match_cut", progress: 0.5, blend: 0.5,
      outgoing: { scaleCorrection: 1.1, rotationCorrectionDegrees: 4 },
      incoming: { scaleCorrection: 0.9, rotationCorrectionDegrees: -4 }
    }]
  ] as const)("composites both authorized images for %s", (toolName, value) => {
    const outgoing = gradientSource(80, 0);
    const incoming = gradientSource(0, 120);
    const mask = new Uint8Array(detailedRequest.width * detailedRequest.height);
    for (let index = 0; index < mask.length; index += 1) mask[index] = index % detailedRequest.width * 2;
    const output = composeEffectToolFrame(metadata(value), detailedRequest, toolName, outgoing, {
      from_video: outgoing,
      to_video: incoming,
      from_match_mask: mask,
      to_match_mask: Uint8Array.from(mask, (entry) => 255 - entry)
    });
    let red = 0;
    let blue = 0;
    for (let offset = 0; offset < output.length; offset += 4) {
      red += output[offset]!;
      blue += output[offset + 2]!;
    }
    expect(red).toBeGreaterThan(output.length * 3);
    expect(blue).toBeGreaterThan(output.length * 3);
    expect(output).not.toEqual(outgoing);
    expect(output).not.toEqual(incoming);
  });
});
