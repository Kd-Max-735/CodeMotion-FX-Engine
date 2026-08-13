import type {
  Animatable,
  EffectInstance,
  JsonObject,
  JsonValue,
  LayerDefinition,
  MotionProject,
  Vector3
} from "@codemotion/core";
import { contractsSchema } from "@codemotion/schema";
import { evaluateAnimatable } from "@codemotion/timeline";
import { LAB_PIPELINE_EFFECT_ID } from "./lab-effect.js";

export type WorkspaceView = "workbench" | "editor" | "lab" | "render-center" | "ai-planner";

export interface EditorDocument {
  project: MotionProject;
  selectedLayerId: string | null;
}

export interface LocatedError {
  message: string;
  path: string;
  layerId?: string;
  effectId?: string;
  parameter?: string;
}

const constant = <T extends JsonValue>(value: T): Animatable<T> => ({ mode: "constant", value });
const vector = (x: number, y: number, z = 0): Animatable<Vector3> => constant({ x, y, z });

function baseLayer(id: string, name: string, zIndex: number, color: string): LayerDefinition {
  return {
    id,
    type: "shape",
    name,
    visible: true,
    locked: false,
    solo: false,
    startTime: 0,
    endTime: 8,
    inPoint: 0,
    outPoint: 8,
    zIndex,
    transform: {
      anchorPoint: vector(0, 0),
      position: vector(960, 540),
      scale: vector(100, 100, 100),
      rotation: vector(0, 0)
    },
    opacity: constant(1),
    blendMode: "normal",
    masks: [],
    effects: [],
    properties: { shapes: [], fill: color }
  };
}

export function createStarterProject(
  name = "未命名项目",
  width = 1920,
  height = 1080,
  fps = 30
): MotionProject {
  const backdrop = baseLayer("layer.backdrop", "背景", 0, "#14181c");
  const accent = baseLayer("layer.accent", "强调图形", 1, "#ff5a3c");
  backdrop.transform.position = vector(0, 0);
  backdrop.properties = {
    shapes: [{ path: `M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`, fill: "#14181c" }],
    fill: "#14181c"
  };
  accent.properties = {
    shapes: [{
      path: `M ${width * 0.32} ${height * 0.32} L ${width * 0.68} ${height * 0.32} L ${width * 0.68} ${height * 0.68} L ${width * 0.32} ${height * 0.68} Z`,
      fill: "#ff5a3c"
    }],
    fill: "#ff5a3c"
  };
  accent.blendMode = "add";
  accent.opacity = { mode: "keyframes", keyframes: [
    { time: 0, value: 0.25, interpolation: "linear" },
    { time: 1, value: 0.7, easing: { type: "easeOut" } }
  ] };
  accent.transform.position = {
    mode: "keyframes",
    keyframes: [
      { time: 0, value: { x: -width * 0.08, y: 0, z: 0 }, interpolation: "linear" },
      { time: 2, value: { x: width * 0.08, y: 0, z: 0 }, easing: { type: "easeInOut" } }
    ]
  };
  const title = baseLayer("layer.title", "CodeMotion FX", 2, "#f2f4f5");
  title.type = "text";
  title.properties = { text: "CodeMotion FX", fontFamily: "sans-serif", fontSize: 92, color: "#f2f4f5" };
  title.transform.position = vector(0, 0);
  title.opacity = constant(0.82);
  return {
    schemaVersion: "1.2.0",
    engineVersion: "0.3.0",
    id: `project.${Date.now().toString(36)}`,
    name,
    width,
    height,
    fps,
    duration: 8,
    background: { type: "color", color: "#14181c" },
    colorSpace: "srgb",
    seed: 20260728,
    assets: [],
    compositions: [{
      id: "composition.main",
      name: "主合成",
      width,
      height,
      duration: 8,
      fps,
      layers: [backdrop, accent, title],
      markers: [{ id: "marker.intro", time: 1, name: "入场", color: "#f7c843" }],
      effects: []
    }],
    fonts: [],
    audioTracks: [],
    renderPresets: [],
    metadata: { createdBy: "editor-s5r", timeContractVersion: "1.1.0" }
  };
}

export function mainLayers(project: MotionProject): LayerDefinition[] {
  return project.compositions[0]?.layers ?? [];
}

export function findLayer(project: MotionProject, layerId: string | null): LayerDefinition | undefined {
  if (layerId === null) return undefined;
  return mainLayers(project).find((layer) => layer.id === layerId);
}

export interface CanvasLayerRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function canvasLayerBaseSize(project: MotionProject, layer: LayerDefinition): { readonly width: number; readonly height: number } {
  if (layer.type !== "text") return { width: project.width * 0.36, height: project.height * 0.36 };
  const glyphs = [...layer.properties.text];
  const fontSize = layer.properties.fontSize;
  const textWidth = glyphs.reduce((sum, glyph) => sum + fontSize * (/^[\u0000-\u00ff]$/.test(glyph) ? 0.62 : 1), 0);
  return {
    width: Math.max(fontSize * 0.8, Math.min(project.width, textWidth + fontSize * 0.35)),
    height: Math.max(fontSize * 1.35, 24)
  };
}

export function canvasLayerRect(project: MotionProject, layer: LayerDefinition, time: number): CanvasLayerRect {
  const position = evaluateAnimatable(layer.transform.position, time);
  const anchor = evaluateAnimatable(layer.transform.anchorPoint, time);
  const scale = evaluateAnimatable(layer.transform.scale, time);
  const base = canvasLayerBaseSize(project, layer);
  const width = Math.max(project.width * 0.02, base.width * Math.abs(scale.x) / 100);
  const height = Math.max(project.height * 0.02, base.height * Math.abs(scale.y) / 100);
  const centerX = (project.width / 2 - anchor.x) * scale.x / 100 + position.x;
  const centerY = (project.height / 2 - anchor.y) * scale.y / 100 + position.y;
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    width,
    height
  };
}

export function canvasLayerPositionForCenter(
  project: MotionProject,
  layer: LayerDefinition,
  time: number,
  center: { readonly x: number; readonly y: number },
  scale: { readonly x: number; readonly y: number }
): Vector3 {
  const anchor = evaluateAnimatable(layer.transform.anchorPoint, time);
  const current = evaluateAnimatable(layer.transform.position, time);
  return {
    x: center.x - (project.width / 2 - anchor.x) * scale.x / 100,
    y: center.y - (project.height / 2 - anchor.y) * scale.y / 100,
    z: current.z
  };
}

export function topLayerInCanvasRect(
  project: MotionProject,
  time: number,
  area: CanvasLayerRect
): LayerDefinition | undefined {
  const right = area.left + area.width;
  const bottom = area.top + area.height;
  return [...mainLayers(project)]
    .filter((layer) => layer.visible && !layer.locked)
    .sort((left, rightLayer) => rightLayer.zIndex - left.zIndex)
    .find((layer) => {
      const candidate = canvasLayerRect(project, layer, time);
      return candidate.left < right && candidate.left + candidate.width > area.left
        && candidate.top < bottom && candidate.top + candidate.height > area.top;
    });
}

export function pipelineEffect(): EffectInstance {
  return {
    id: `effect.pipeline.${Date.now().toString(36)}`,
    effectId: LAB_PIPELINE_EFFECT_ID,
    version: "0.1.0",
    enabled: true,
    mix: constant(1),
    params: { strength: constant(1) },
    renderQuality: "preview",
    cachePolicy: "frame"
  };
}

function getIssuePath(error: unknown): { message: string; path: string } {
  if (typeof error !== "object" || error === null) return { message: String(error), path: "" };
  const value = error as { message?: unknown; details?: { issues?: unknown } };
  const issues = value.details?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    const issue = [...issues]
      .map((item) => item as { instancePath?: unknown; message?: unknown })
      .sort((left, right) => String(right.instancePath ?? "").length - String(left.instancePath ?? "").length)[0]!;
    return {
      message: typeof issue.message === "string" ? issue.message : String(value.message ?? "校验失败"),
      path: typeof issue.instancePath === "string" ? issue.instancePath : ""
    };
  }
  return { message: typeof value.message === "string" ? value.message : "未知错误", path: "" };
}

export function locateProjectError(error: unknown, project: MotionProject): LocatedError {
  const issue = getIssuePath(error);
  const parts = issue.path.split("/").filter(Boolean);
  const compositionIndex = parts[0] === "compositions" ? Number(parts[1]) : -1;
  const layerPart = parts.indexOf("layers");
  const effectPart = parts.indexOf("effects");
  const paramPart = parts.indexOf("params");
  const layer = layerPart >= 0 ? project.compositions[compositionIndex]?.layers[Number(parts[layerPart + 1])] : undefined;
  const effect = layer && effectPart >= 0 ? layer.effects[Number(parts[effectPart + 1])] : undefined;
  return {
    message: issue.message,
    path: issue.path || "/",
    ...(layer ? { layerId: layer.id } : {}),
    ...(effect ? { effectId: effect.id } : {}),
    ...(paramPart >= 0 && parts[paramPart + 1] ? { parameter: parts[paramPart + 1] } : {})
  };
}

export interface PropertyFieldSchema extends JsonObject {
  label: string;
  kind: "text" | "number" | "checkbox" | "select";
  path: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  animatablePath?: string;
  component?: "x" | "y" | "z";
  options?: JsonValue[];
}

interface ContractNode {
  readonly $ref?: string;
  readonly type?: string;
  readonly const?: JsonValue;
  readonly enum?: readonly JsonValue[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly properties?: Readonly<Record<string, ContractNode>>;
  readonly allOf?: readonly ContractNode[];
}

interface ContractDocument { readonly $defs?: Readonly<Record<string, ContractNode>> }

export interface PropertySection { readonly title: string; readonly fields: readonly PropertyFieldSchema[] }

function words(path: string): string {
  const last = path.split(".").at(-1) ?? path;
  const labels: Readonly<Record<string, string>> = {
    name: "名称", visible: "显示", locked: "锁定", solo: "独奏", startTime: "开始时间",
    endTime: "结束时间", inPoint: "入点", outPoint: "出点", zIndex: "层级",
    opacity: "不透明度", blendMode: "混合模式", anchorPoint: "锚点", position: "位置",
    scale: "缩放", rotation: "旋转", skew: "倾斜", text: "文字", fontFamily: "字体",
    fontSize: "字号", color: "颜色", fit: "适配方式", loop: "循环", muted: "静音",
    svg: "矢量路径", fill: "填充", stroke: "描边", strokeWidth: "描边宽度"
  };
  return labels[last] ?? last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (value) => value.toUpperCase());
}

function referencedName(node: ContractNode): string | undefined {
  return node.$ref?.startsWith("#/$defs/") ? node.$ref.slice("#/$defs/".length) : undefined;
}

function primitiveField(path: string, node: ContractNode): PropertyFieldSchema | undefined {
  if (node.enum) return { label: words(path), kind: "select", path, options: [...node.enum] };
  if (node.type === "string") return { label: words(path), kind: "text", path };
  if (node.type === "boolean") return { label: words(path), kind: "checkbox", path };
  if (node.type === "number" || node.type === "integer") return {
    label: words(path), kind: "number", path,
    ...(node.minimum === undefined ? {} : { minimum: node.minimum }),
    ...(node.maximum === undefined ? {} : { maximum: node.maximum }),
    step: node.type === "integer" ? 1 : 0.01
  };
  return undefined;
}

function schemaFields(defs: Readonly<Record<string, ContractNode>>, path: string, node: ContractNode): PropertyFieldSchema[] {
  const direct = primitiveField(path, node);
  if (direct) return [direct];
  const reference = referencedName(node);
  if (reference?.startsWith("AnimatableVector")) {
    const vectorName = reference.endsWith("2") ? "Vector2" : "Vector3";
    const components = Object.keys(defs[vectorName]?.properties ?? {});
    return components.map((component) => ({
      label: `${words(path)} ${component.toUpperCase()}`,
      kind: "number",
      path,
      component: component as "x" | "y" | "z",
      animatablePath: path,
      step: 1
    }));
  }
  if (reference?.startsWith("Animatable")) {
    const scalarName = reference.slice("Animatable".length).toLowerCase();
    return [{
      label: words(path),
      kind: scalarName === "number" ? "number" : "text",
      path,
      animatablePath: path,
      ...(path === "opacity" ? { minimum: 0, maximum: 1, step: 0.01 } : { step: 0.01 })
    }];
  }
  const resolved = reference ? defs[reference] : node;
  if (!resolved?.properties) return [];
  return Object.entries(resolved.properties).flatMap(([key, child]) => schemaFields(defs, `${path}.${key}`, child));
}

function layerBranch(defs: Readonly<Record<string, ContractNode>>, type: string): ContractNode | undefined {
  return Object.values(defs).find((candidate) => candidate.allOf?.some((part) =>
    part.properties?.type?.const === type));
}

export function layerPropertySections(
  layer: LayerDefinition,
  schema: Readonly<JsonObject> = contractsSchema
): readonly PropertySection[] {
  const defs = (schema as unknown as ContractDocument).$defs ?? {};
  const common = defs.LayerCommon?.properties ?? {};
  const baseFields = Object.entries(common).flatMap(([key, node]) => {
    if (["id", "type", "transform", "masks", "effects", "source"].includes(key)) return [];
    return schemaFields(defs, key, node);
  });
  const transformFields = Object.entries(defs.TransformDefinition?.properties ?? {})
    .flatMap(([key, node]) => schemaFields(defs, `transform.${key}`, node));
  const branch = layerBranch(defs, layer.type);
  const branchProperties = branch?.allOf?.flatMap((part) => Object.entries(part.properties?.properties?.properties ?? {})) ?? [];
  const layerFields = branchProperties.flatMap(([key, node]) => schemaFields(defs, `properties.${key}`, node));
  return [
    { title: "图层", fields: baseFields },
    { title: "变换", fields: transformFields },
    ...(layerFields.length ? [{ title: "图层内容", fields: layerFields }] : [])
  ];
}
