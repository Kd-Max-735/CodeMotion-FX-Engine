import type { BlendMode, ColorSpace } from "@codemotion/core";

export const COLOR_PIPELINE_CONTRACT_VERSION = "1.0.0" as const;

export interface ColorConformanceFixture {
  readonly id: string;
  readonly sourceColorSpace: ColorSpace;
  readonly sourceAlphaMode: "straight" | "premultiplied";
  readonly sourceRgba8: readonly [number, number, number, number];
  readonly targetColorSpace: ColorSpace;
  readonly targetAlphaMode: "straight" | "premultiplied";
  readonly expectedRgba8: readonly [number, number, number, number];
}

export interface BlendConformanceFixture {
  readonly id: string;
  readonly blendMode: BlendMode;
  readonly backdropRgba8: readonly [number, number, number, number];
  readonly sourceRgba8: readonly [number, number, number, number];
  readonly opacity: number;
  readonly expectedRgba8: readonly [number, number, number, number];
}

export const BACKEND_CONFORMANCE_CONTRACT = Object.freeze({
  contractVersion: COLOR_PIPELINE_CONTRACT_VERSION,
  workingColorSpace: "linear-srgb",
  rgba8ChannelTolerance: 1,
  floatChannelTolerance: 1e-5,
  conversionOrder: Object.freeze([
    "unassociate-source-alpha",
    "decode-transfer-function",
    "convert-primaries-to-linear-srgb",
    "blend-in-linear-srgb",
    "convert-primaries-from-linear-srgb",
    "encode-transfer-function",
    "associate-output-alpha"
  ]),
  unsupportedBehavior: "report-capability-or-fail-never-silent-approximation"
} as const);

export const COLOR_CONFORMANCE_FIXTURES: readonly ColorConformanceFixture[] = Object.freeze([
  Object.freeze({
    id: "srgb-straight-to-linear-premultiplied",
    sourceColorSpace: "srgb",
    sourceAlphaMode: "straight",
    sourceRgba8: Object.freeze([188, 137, 99, 128] as const),
    targetColorSpace: "linear-srgb",
    targetAlphaMode: "premultiplied",
    expectedRgba8: Object.freeze([64, 32, 16, 128] as const)
  }),
  Object.freeze({
    id: "display-p3-to-srgb",
    sourceColorSpace: "display-p3",
    sourceAlphaMode: "straight",
    sourceRgba8: Object.freeze([204, 51, 26, 255] as const),
    targetColorSpace: "srgb",
    targetAlphaMode: "straight",
    expectedRgba8: Object.freeze([222, 24, 0, 255] as const)
  })
]);

export const BLEND_CONFORMANCE_FIXTURES: readonly BlendConformanceFixture[] = Object.freeze([
  Object.freeze({
    id: "linear-screen-with-alpha",
    blendMode: "screen",
    backdropRgba8: Object.freeze([64, 128, 192, 255] as const),
    sourceRgba8: Object.freeze([192, 96, 32, 160] as const),
    opacity: 0.75,
    expectedRgba8: Object.freeze([146, 139, 193, 255] as const)
  })
]);
