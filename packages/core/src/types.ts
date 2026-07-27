import type {
  EFFECT_DEFINITION_SCHEMA_VERSION,
  ENGINE_VERSION,
  PROJECT_SCHEMA_VERSION
} from "./versions.js";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonSchema = boolean | JsonObject;

export type ColorSpace = "srgb" | "display-p3" | "linear-srgb";
export type RenderQuality = "draft" | "preview" | "final";
export type RenderBackend =
  | "dom"
  | "svg"
  | "canvas2d"
  | "webgl"
  | "webgpu"
  | "three"
  | "server";

export type BackgroundDefinition =
  | { type: "transparent" }
  | { type: "color"; color: string }
  | { type: "asset"; assetId: string; fit: "cover" | "contain" | "fill" };

export interface AssetReference {
  assetId: string;
}

export interface AssetDefinition {
  id: string;
  type: "image" | "video" | "audio" | "svg" | "model3d" | "font" | "data" | "other";
  uri: string;
  hash?: string;
  metadata: JsonObject;
}

export interface FontDefinition {
  id: string;
  family: string;
  assetId?: string;
  style?: string;
  weight?: number;
}

export interface AudioTrackDefinition {
  id: string;
  assetId: string;
  startTime: number;
  endTime: number;
  volume: Animatable<number>;
}

export interface RenderPreset {
  id: string;
  name: string;
  format: string;
  quality: RenderQuality;
  settings: JsonObject;
}

export interface ExpressionDefinition {
  language: "cmfx-expression";
  source: string;
  fallback?: JsonValue;
}

export interface DataBindingDefinition {
  source: "json" | "csv" | "form" | "audio" | "time" | "scene" | "variable";
  path: string;
  fallback?: JsonValue;
}

export type EasingName =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "cubicBezier"
  | "spring"
  | "bounce"
  | "elastic"
  | "back"
  | "steps"
  | "customCurve";

export interface EasingDefinition {
  type: EasingName;
  params?: number[];
}

export interface Keyframe<T extends JsonValue = JsonValue> {
  time: number;
  value: T;
  easing?: EasingDefinition;
  interpolation?: "linear" | "hold" | "bezier" | "spring" | "spline";
  inTangent?: number[];
  outTangent?: number[];
}

export type Animatable<T extends JsonValue = JsonValue> =
  | { mode: "constant"; value: T }
  | { mode: "keyframes"; keyframes: Keyframe<T>[] }
  | { mode: "expression"; expression: ExpressionDefinition }
  | { mode: "binding"; source: DataBindingDefinition };

export interface Vector2 extends JsonObject {
  x: number;
  y: number;
}

export interface Vector3 extends JsonObject {
  x: number;
  y: number;
  z: number;
}

export interface TransformDefinition {
  anchorPoint: Animatable<Vector3>;
  position: Animatable<Vector3>;
  scale: Animatable<Vector3>;
  rotation: Animatable<Vector3>;
  skew?: Animatable<Vector2>;
}

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity"
  | "add";

export interface MaskDefinition {
  id: string;
  name: string;
  enabled: boolean;
  mode: "add" | "subtract" | "intersect" | "none";
  inverted: boolean;
  path: Animatable<JsonValue>;
  opacity: Animatable<number>;
  feather: Animatable<Vector2>;
}

export interface EffectInstance {
  id: string;
  effectId: string;
  version: string;
  enabled: boolean;
  startTime?: number;
  endTime?: number;
  mix: Animatable<number>;
  maskId?: string;
  params: Record<string, Animatable | JsonValue>;
  renderQuality?: RenderQuality;
  cachePolicy?: "none" | "frame" | "range" | "static";
}

export type LayerType =
  | "text"
  | "shape"
  | "image"
  | "video"
  | "audio"
  | "svg"
  | "canvas"
  | "particle"
  | "model3d"
  | "camera"
  | "light"
  | "adjustment"
  | "null"
  | "data"
  | "composition"
  | "custom";

export interface LayerDefinitionBase<TType extends LayerType, TProperties extends JsonObject> {
  id: string;
  type: TType;
  name: string;
  visible: boolean;
  locked: boolean;
  solo: boolean;
  startTime: number;
  endTime: number;
  inPoint: number;
  outPoint: number;
  parentId?: string;
  zIndex: number;
  transform: TransformDefinition;
  opacity: Animatable<number>;
  blendMode: BlendMode;
  masks: MaskDefinition[];
  effects: EffectInstance[];
  source?: AssetReference;
  properties: TProperties;
}

export type TextLayerProperties = JsonObject & {
  text: string;
  fontFamily: string;
  fontSize: number;
};
export type ShapeLayerProperties = JsonObject & { shapes: JsonObject[] };
export type ImageLayerProperties = JsonObject & { fit: "cover" | "contain" | "fill" | "none" };
export type VideoLayerProperties = JsonObject & { loop: boolean; muted: boolean };
export type AudioLayerProperties = JsonObject & { volume: Animatable<number> };
export type SvgLayerProperties = JsonObject & { svg?: string };
export type CanvasLayerProperties = JsonObject & { commands: JsonObject[] };
export type ParticleLayerProperties = JsonObject & { emitter: JsonObject };
export type Model3DLayerProperties = JsonObject & { sceneNode?: string };
export type CameraLayerProperties = JsonObject & {
  projection: "perspective" | "orthographic";
  zoom: Animatable<number>;
};
export type LightLayerProperties = JsonObject & {
  lightType: "ambient" | "directional" | "point" | "spot";
  intensity: Animatable<number>;
  color: Animatable<string>;
};
export type AdjustmentLayerProperties = JsonObject;
export type NullLayerProperties = JsonObject;
export type DataLayerProperties = JsonObject & { data: JsonValue };
export type CompositionLayerProperties = JsonObject & { compositionId: string; timeOffset?: number };
export type CustomLayerProperties = JsonObject & { pluginId: string; data: JsonObject };

export interface TextLayer extends LayerDefinitionBase<"text", TextLayerProperties> {}
export interface ShapeLayer extends LayerDefinitionBase<"shape", ShapeLayerProperties> {}
export interface ImageLayer extends LayerDefinitionBase<"image", ImageLayerProperties> { source: AssetReference }
export interface VideoLayer extends LayerDefinitionBase<"video", VideoLayerProperties> { source: AssetReference }
export interface AudioLayer extends LayerDefinitionBase<"audio", AudioLayerProperties> { source: AssetReference }
export interface SvgLayer extends LayerDefinitionBase<"svg", SvgLayerProperties> {}
export interface CanvasLayer extends LayerDefinitionBase<"canvas", CanvasLayerProperties> {}
export interface ParticleLayer extends LayerDefinitionBase<"particle", ParticleLayerProperties> {}
export interface Model3DLayer extends LayerDefinitionBase<"model3d", Model3DLayerProperties> { source: AssetReference }
export interface CameraLayer extends LayerDefinitionBase<"camera", CameraLayerProperties> {}
export interface LightLayer extends LayerDefinitionBase<"light", LightLayerProperties> {}
export interface AdjustmentLayer extends LayerDefinitionBase<"adjustment", AdjustmentLayerProperties> {}
export interface NullLayer extends LayerDefinitionBase<"null", NullLayerProperties> {}
export interface DataLayer extends LayerDefinitionBase<"data", DataLayerProperties> {}
export interface CompositionLayer extends LayerDefinitionBase<"composition", CompositionLayerProperties> {}
export interface CustomLayer extends LayerDefinitionBase<"custom", CustomLayerProperties> {}

export type LayerDefinition =
  | TextLayer
  | ShapeLayer
  | ImageLayer
  | VideoLayer
  | AudioLayer
  | SvgLayer
  | CanvasLayer
  | ParticleLayer
  | Model3DLayer
  | CameraLayer
  | LightLayer
  | AdjustmentLayer
  | NullLayer
  | DataLayer
  | CompositionLayer
  | CustomLayer;

export type Layer = LayerDefinition;

export interface TimelineMarker {
  id: string;
  time: number;
  name: string;
  color?: string;
}

export interface CompositionDefinition {
  id: string;
  name: string;
  width: number;
  height: number;
  duration: number;
  fps?: number;
  layers: LayerDefinition[];
  markers?: TimelineMarker[];
  effects?: EffectInstance[];
}

export type Composition = CompositionDefinition;

export interface QualityLevelDefinition {
  quality: RenderQuality;
  settings: JsonObject;
}

export interface ValidationRule {
  ruleId: string;
  message: string;
  severity: "warning" | "error";
  config: JsonObject;
}

export interface EffectMigrationDescriptor {
  fromVersion: string;
  toVersion: string;
}

export interface EffectDefinition {
  schemaVersion: typeof EFFECT_DEFINITION_SCHEMA_VERSION;
  effectId: string;
  version: string;
  displayName: string;
  category: string;
  description: string;
  tags: string[];
  inputTypes: string[];
  outputType: string;
  parameterSchema: JsonSchema;
  uiSchema: JsonObject;
  defaultPreset: JsonObject;
  renderBackends: RenderBackend[];
  preferredBackend: RenderBackend;
  fallbackBackend?: RenderBackend;
  deterministic: boolean;
  supportsAlpha: boolean;
  supportsMask: boolean;
  supportsKeyframes: boolean;
  supportsExpressions: boolean;
  performanceClass: "light" | "medium" | "heavy" | "extreme";
  qualityLevels: QualityLevelDefinition[];
  validationRules: ValidationRule[];
  migrations: EffectMigrationDescriptor[];
}

export interface MotionProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  engineVersion: typeof ENGINE_VERSION | string;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  background: BackgroundDefinition;
  colorSpace: ColorSpace;
  seed: number;
  assets: AssetDefinition[];
  compositions: CompositionDefinition[];
  fonts: FontDefinition[];
  audioTracks: AudioTrackDefinition[];
  renderPresets: RenderPreset[];
  metadata: JsonObject;
}
