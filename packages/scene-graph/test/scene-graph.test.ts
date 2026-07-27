import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  ERROR_CODES,
  PROJECT_SCHEMA_VERSION,
  type CompositionDefinition,
  type LayerDefinition,
  type MotionProject,
  type NullLayer,
  type TransformDefinition
} from "@codemotion/core";
import { SceneGraph, evaluateTransform, transformPoint } from "../src/index.js";

function transform(x = 0, y = 0): TransformDefinition {
  return {
    anchorPoint: { mode: "constant", value: { x: 0, y: 0, z: 0 } },
    position: { mode: "constant", value: { x, y, z: 0 } },
    scale: { mode: "constant", value: { x: 100, y: 100, z: 100 } },
    rotation: { mode: "constant", value: { x: 0, y: 0, z: 0 } }
  };
}

function layer(id: string, overrides: Partial<NullLayer> = {}): NullLayer {
  return {
    id,
    type: "null",
    name: id,
    visible: true,
    locked: false,
    solo: false,
    startTime: 0,
    endTime: 5,
    inPoint: 0,
    outPoint: 5,
    zIndex: 0,
    transform: transform(),
    opacity: { mode: "constant", value: 1 },
    blendMode: "normal",
    masks: [],
    effects: [],
    properties: {},
    ...overrides
  };
}

function project(compositions: CompositionDefinition[]): MotionProject {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    id: "project.scene",
    name: "Scene",
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
    background: { type: "transparent" },
    colorSpace: "srgb",
    seed: 1,
    assets: [],
    compositions,
    fonts: [],
    audioTracks: [],
    renderPresets: [],
    metadata: {}
  };
}

function composition(id: string, layers: LayerDefinition[], duration = 5): CompositionDefinition {
  return { id, name: id, width: 1920, height: 1080, duration, fps: 30, layers };
}

describe("transform evaluation", () => {
  it("composes anchor, percentage scale, rotation, and translation deterministically", () => {
    const definition: TransformDefinition = {
      anchorPoint: { mode: "constant", value: { x: 1, y: 0, z: 0 } },
      position: { mode: "constant", value: { x: 10, y: 0, z: 0 } },
      scale: { mode: "constant", value: { x: 200, y: 100, z: 100 } },
      rotation: { mode: "constant", value: { x: 0, y: 0, z: 90 } }
    };
    const first = evaluateTransform(definition, 0);
    const second = evaluateTransform(definition, 0);
    expect(transformPoint(first.matrix, { x: 1, y: 0, z: 0 })).toEqual({ x: 10, y: 0, z: 0 });
    expect(first).toEqual(second);
  });
});

describe("SceneGraph", () => {
  it("evaluates parent/child and precomposition world transforms", () => {
    const parent = layer("parent", { transform: transform(10), opacity: { mode: "constant", value: 0.5 } });
    const child = layer("child", { parentId: "parent", transform: transform(2), opacity: { mode: "constant", value: 0.5 } });
    const nestedLayer = layer("nested", { transform: transform(5) });
    const precomp: LayerDefinition = {
      ...layer("precomp", { transform: transform(100), zIndex: 1 }),
      type: "composition",
      properties: { compositionId: "child-composition" }
    };
    const graph = new SceneGraph(project([
      composition("main", [parent, child, precomp]),
      composition("child-composition", [nestedLayer])
    ]));

    const evaluated = graph.evaluate("main", 1);
    expect(evaluated.map((item) => item.layerId)).toEqual(["parent", "child", "precomp", "nested"]);
    const childResult = evaluated.find((item) => item.layerId === "child");
    const nestedResult = evaluated.find((item) => item.layerId === "nested");
    expect(childResult?.worldOpacity).toBe(0.25);
    expect(transformPoint(childResult!.worldMatrix, { x: 0, y: 0, z: 0 }).x).toBe(12);
    expect(transformPoint(nestedResult!.worldMatrix, { x: 0, y: 0, z: 0 }).x).toBe(105);
  });

  it("applies layer boundaries and nested offset/remap time", () => {
    const nested = layer("nested", {
      transform: {
        ...transform(),
        position: {
          mode: "keyframes",
          keyframes: [
            { time: 0, value: { x: 0, y: 0, z: 0 } },
            { time: 4, value: { x: 40, y: 0, z: 0 } }
          ]
        }
      }
    });
    const precomp: LayerDefinition = {
      ...layer("precomp", { startTime: 1, endTime: 4, inPoint: 0, outPoint: 3 }),
      type: "composition",
      properties: {
        compositionId: "child",
        timeRemap: { mode: "constant", value: 2 },
        timeOffset: 1
      }
    };
    const graph = new SceneGraph(project([composition("main", [precomp]), composition("child", [nested])]));
    expect(graph.evaluate("main", 0.999)).toEqual([]);
    const inside = graph.evaluate("main", 1);
    const nestedResult = inside.find((item) => item.layerId === "nested");
    expect(nestedResult?.parentTime).toBe(3);
    expect(transformPoint(nestedResult!.worldMatrix, { x: 0, y: 0, z: 0 }).x).toBe(30);
    expect(graph.evaluate("main", 4)).toEqual([]);
  });

  it("returns deterministic results for repeated fixed-time evaluation", () => {
    const graph = new SceneGraph(project([composition("main", [layer("a", { transform: transform(3) })])]));
    const first = graph.evaluate("main", 1 / 30);
    expect(graph.evaluate("main", 1 / 30)).toEqual(first);
    expect(graph.evaluate("main", 1 / 30)).toEqual(first);
    expect(graph.evaluateFrame("main", 1)).toEqual(first);
  });

  it("keeps nested ping-pong folds visible at fixed-frame boundaries", () => {
    const nested = layer("nested", {
      transform: {
        ...transform(),
        position: {
          mode: "keyframes",
          keyframes: [
            { time: 0, value: { x: 0, y: 0, z: 0 } },
            { time: 1, value: { x: 10, y: 0, z: 0 } }
          ]
        }
      }
    });
    const precomp: LayerDefinition = {
      ...layer("precomp"),
      type: "composition",
      properties: { compositionId: "child", timeLoop: "ping-pong" }
    };
    const graph = new SceneGraph(project([
      composition("main", [precomp]),
      composition("child", [nested], 1)
    ]));

    const aroundFirstFold = [29, 30, 31].map((frame) => graph.evaluateFrame("main", frame));
    const aroundLaterFold = [89, 90, 91].map((frame) => graph.evaluateFrame("main", frame));
    const foldFrames = [29, 30, 31, 89, 90, 91];
    for (const [index, result] of [...aroundFirstFold, ...aroundLaterFold].entries()) {
      expect(result.some((item) => item.layerId === "nested"), `frame ${foldFrames[index]}`).toBe(true);
    }

    const sourceTimes = aroundFirstFold.map((result) =>
      result.find((item) => item.layerId === "nested")!.sourceTime
    );
    expect(sourceTimes[1]).toBeGreaterThan(sourceTimes[0]!);
    expect(sourceTimes[1]).toBeGreaterThan(sourceTimes[2]!);
    expect(sourceTimes[0]).toBe(sourceTimes[2]);

    const folded = graph.evaluateFrame("main", 30);
    expect(graph.evaluateFrame("main", 30)).toEqual(folded);
    expect(graph.evaluateFrame("main", 30)).toEqual(folded);
  });

  it("rejects duplicate, missing-parent, and parent-cycle graphs", () => {
    expect(() => new SceneGraph(project([composition("main", [layer("a"), layer("a")])]))).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.SCENE_GRAPH_INVALID })
    );
    expect(() => new SceneGraph(project([composition("main", [layer("a", { parentId: "missing" })])]))).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.SCENE_GRAPH_INVALID })
    );
    expect(() => new SceneGraph(project([composition("main", [
      layer("a", { parentId: "b" }),
      layer("b", { parentId: "a" })
    ])]))).toThrowError(expect.objectContaining({ code: ERROR_CODES.SCENE_GRAPH_INVALID }));
  });

  it("rejects missing and cyclic precomposition references", () => {
    const missing: LayerDefinition = {
      ...layer("precomp"),
      type: "composition",
      properties: { compositionId: "missing" }
    };
    expect(() => new SceneGraph(project([composition("main", [missing])]))).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.SCENE_GRAPH_INVALID })
    );

    const toB: LayerDefinition = { ...layer("to-b"), type: "composition", properties: { compositionId: "b" } };
    const toA: LayerDefinition = { ...layer("to-a"), type: "composition", properties: { compositionId: "a" } };
    expect(() => new SceneGraph(project([composition("a", [toB]), composition("b", [toA])]))).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.SCENE_GRAPH_INVALID })
    );
  });
});
