import type { JsonObject, RenderQuality } from "@codemotion/core";
import type { RegisteredEffectDefinition } from "@codemotion/renderer-api";

export type TextMaterial = "matte" | "metal" | "glass";
export type TextLight = "studio" | "rim" | "top";

export interface PixelSurface {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly colorSpace: "srgb" | "display-p3" | "linear-srgb";
  readonly alphaMode: "none" | "straight" | "premultiplied";
}

export interface TextExtrude3DParams {
  readonly depth: number;
  readonly bevel: number;
  readonly material: TextMaterial;
  readonly light: TextLight;
  readonly rotationX: number;
  readonly rotationY: number;
  readonly perspective: number;
  readonly progress: number;
}

export interface TextExtrude3DRenderOptions {
  readonly progress: number;
  readonly seed: number;
  readonly quality: RenderQuality;
  readonly mask?: PixelSurface;
}

export interface TextExtrude3DPreset {
  readonly presetId: string;
  readonly effectId: "fx.text.textExtrude3D";
  readonly version: "1.0.0";
  readonly name: string;
  readonly tags: readonly string[];
  readonly params: JsonObject;
  readonly previewAsset: string;
}

export interface TextExtrusionGeometry {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly bevel: number;
  readonly occupiedCells: number;
  readonly frontTriangles: number;
  readonly sideTriangles: number;
  readonly boundary: Int32Array;
  readonly bounds: readonly [number, number, number, number, number, number];
}

export interface TextExtrude3DEffectDefinition extends RegisteredEffectDefinition {
  readonly sourceId: "T08";
  readonly implementationOwner: "Group 3";
  readonly presets: readonly [
    TextExtrude3DPreset,
    TextExtrude3DPreset,
    TextExtrude3DPreset
  ];
  readonly preview: {
    readonly asset: "./preview.html#T08";
    readonly width: 160;
    readonly height: 90;
    readonly frameProgress: 0.5;
    readonly alt: string;
  };
  readonly alphaBehavior: string;
  readonly maskBehavior: string;
  readonly fallbackBehavior: string;
  readonly benchmarkBudgetMs: number;
  renderPixels(
    source: PixelSurface,
    params?: Readonly<Record<string, unknown>>,
    options?: Partial<TextExtrude3DRenderOptions>
  ): PixelSurface;
}
