import type {
  EffectTimeSample,
  EffectDefinition,
  JsonObject,
  RenderQuality
} from "@codemotion/core";
import type {
  CoverageBuffer,
  DualInputTextures,
  LayerRasterizationInput,
  RegisteredTemporalEffectDefinition
} from "@codemotion/renderer-api";

export type P0SourceId =
  | "M01" | "M02" | "M03" | "M04" | "M05" | "M06" | "M07" | "M08"
  | "T01" | "T02" | "T03" | "T04" | "T05" | "T06" | "T07"
  | "V01" | "V02" | "V03" | "V04"
  | "D01" | "D02" | "D03" | "D04"
  | "L01" | "L02" | "L03" | "L04"
  | "P01" | "P02" | "P03" | "P04"
  | "C01" | "C02" | "C03" | "C04"
  | "H01" | "H02" | "H03" | "H04";

export type P0Category =
  | "motion"
  | "text"
  | "vector"
  | "draw"
  | "light"
  | "post"
  | "transition"
  | "composite";

export interface PixelSurface {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly colorSpace: "srgb" | "display-p3" | "linear-srgb";
  readonly alphaMode: "none" | "straight" | "premultiplied";
}

export interface EffectRuntimeOptions {
  readonly time: EffectTimeSample;
  /** @deprecated Compatibility input only; P0 1.1 runtimes require `time`. */
  readonly progress?: number;
  readonly seed: number;
  readonly quality: RenderQuality;
  readonly rasterInput: LayerRasterizationInput;
  readonly secondaryRasterInput?: LayerRasterizationInput;
  readonly dualInputTextures?: DualInputTextures;
  readonly brushCoverage?: CoverageBuffer;
  readonly brushAssetId?: string;
  readonly secondary?: PixelSurface;
  readonly mask?: PixelSurface;
}

export interface EffectPreset {
  readonly presetId: string;
  readonly effectId: string;
  readonly version: "1.1.0";
  readonly name: string;
  readonly tags: readonly string[];
  readonly params: JsonObject;
  readonly previewAsset: string;
}

export interface PreviewDescriptor {
  readonly asset: string;
  readonly width: 160;
  readonly height: 90;
  readonly frameProgress: number;
  readonly alt: string;
}

export interface P0EffectDefinition extends RegisteredTemporalEffectDefinition {
  readonly sourceId: P0SourceId;
  readonly implementationOwner: "Group 2";
  readonly presets: readonly [EffectPreset, EffectPreset, EffectPreset];
  readonly preview: PreviewDescriptor;
  readonly alphaBehavior: string;
  readonly maskBehavior: string;
  readonly fallbackBehavior: string;
  readonly benchmarkBudgetMs: number;
  readonly documentation: {
    readonly readme: string;
    readonly changelog: string;
  };
  renderPixels(
    source: PixelSurface,
    params?: Readonly<Record<string, unknown>>,
    options?: Partial<EffectRuntimeOptions>
  ): PixelSurface;
}

export interface EffectBlueprint {
  readonly sourceId: P0SourceId;
  readonly effectId: string;
  readonly displayName: string;
  readonly category: P0Category;
  readonly description: string;
  readonly parameters: readonly ParameterSpec[];
  readonly performanceClass: EffectDefinition["performanceClass"];
  readonly benchmarkBudgetMs: number;
}

export type ParameterSpec =
  | NumberParameterSpec
  | EnumParameterSpec
  | TextParameterSpec
  | BooleanParameterSpec
  | VectorParameterSpec;

interface ParameterBase {
  readonly name: string;
  readonly label: string;
  readonly unit: string;
  readonly keyframeable: boolean;
  readonly expression: boolean;
  readonly randomizable: boolean;
  readonly performanceImpact: "none" | "low" | "medium" | "high";
  readonly conflicts: readonly string[];
  readonly nullBehavior: "use-default";
}

export interface NumberParameterSpec extends ParameterBase {
  readonly kind: "number";
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export interface EnumParameterSpec extends ParameterBase {
  readonly kind: "enum";
  readonly default: string;
  readonly options: readonly string[];
}

export interface TextParameterSpec extends ParameterBase {
  readonly kind: "text";
  readonly default: string;
  readonly minLength: number;
  readonly maxLength: number;
}

export interface BooleanParameterSpec extends ParameterBase {
  readonly kind: "boolean";
  readonly default: boolean;
}

export interface VectorParameterSpec extends ParameterBase {
  readonly kind: "vector2";
  readonly default: readonly [number, number];
  readonly min: number;
  readonly max: number;
  readonly step: number;
}
