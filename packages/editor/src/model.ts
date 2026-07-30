import type {
  Animatable,
  EffectInstance,
  JsonObject,
  JsonValue,
  LayerDefinition,
  MotionProject,
  Vector3
} from "@codemotion/core";
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
  kind: "text" | "number" | "color" | "select";
  path: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  animatablePath?: string;
  component?: "x" | "y" | "z";
  options?: JsonValue[];
}

export const LAYER_PROPERTY_SCHEMA: Readonly<{ sections: readonly { title: string; fields: readonly PropertyFieldSchema[] }[] }> = {
  sections: [
    { title: "基础属性", fields: [
      { label: "名称", kind: "text", path: "name" },
      { label: "混合模式", kind: "select", path: "blendMode", options: ["normal", "multiply", "screen", "add"] }
    ] },
    { title: "变换", fields: [
      { label: "位置 X", kind: "number", path: "transform.position", component: "x", animatablePath: "transform.position", step: 1 },
      { label: "位置 Y", kind: "number", path: "transform.position", component: "y", animatablePath: "transform.position", step: 1 },
      { label: "缩放 X", kind: "number", path: "transform.scale", component: "x", animatablePath: "transform.scale", step: 1 },
      { label: "旋转", kind: "number", path: "transform.rotation", component: "z", animatablePath: "transform.rotation", step: 1 },
      { label: "不透明度", kind: "number", path: "opacity", animatablePath: "opacity", minimum: 0, maximum: 1, step: 0.01 }
    ] },
    { title: "外观", fields: [
      { label: "填充", kind: "color", path: "properties.fill" },
      { label: "文字", kind: "text", path: "properties.text" }
    ] }
  ]
};
