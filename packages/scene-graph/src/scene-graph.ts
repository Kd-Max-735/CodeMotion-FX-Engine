import {
  EngineError,
  ERROR_CODES,
  type CompositionDefinition,
  type CompositionLayer,
  type LayerDefinition,
  type MotionProject
} from "@codemotion/core";
import { evaluateNumber, frameToSeconds, resolveLayerTime, resolveNestedTime } from "@codemotion/timeline";
import {
  evaluateTransform,
  IDENTITY_MATRIX,
  multiplyMatrices,
  type EvaluatedTransform,
  type Matrix4
} from "./matrix.js";

export interface SceneNode {
  readonly layer: LayerDefinition;
  readonly parentId?: string;
  readonly childIds: readonly string[];
}

export interface EvaluatedSceneLayer {
  readonly compositionId: string;
  readonly layerId: string;
  readonly path: readonly string[];
  readonly parentTime: number;
  readonly sourceTime: number;
  readonly localTransform: EvaluatedTransform;
  readonly worldMatrix: Matrix4;
  readonly worldOpacity: number;
}

interface CompositionGraph {
  readonly composition: CompositionDefinition;
  readonly nodes: ReadonlyMap<string, SceneNode>;
  readonly rootIds: readonly string[];
}

function graphError(message: string, details: Record<string, string>): EngineError {
  return new EngineError(ERROR_CODES.SCENE_GRAPH_INVALID, message, { details });
}

function orderedLayers(composition: CompositionDefinition): LayerDefinition[] {
  return composition.layers.map((layer, order) => ({ layer, order })).sort((left, right) =>
    left.layer.zIndex - right.layer.zIndex || left.order - right.order
  ).map(({ layer }) => layer);
}

export class SceneGraph {
  private readonly compositions = new Map<string, CompositionGraph>();

  constructor(readonly project: MotionProject) {
    this.build();
  }

  getComposition(compositionId: string): CompositionDefinition {
    return this.requireComposition(compositionId).composition;
  }

  getNode(compositionId: string, layerId: string): SceneNode {
    const node = this.requireComposition(compositionId).nodes.get(layerId);
    if (node === undefined) {
      throw graphError("Layer does not exist in composition.", { compositionId, layerId });
    }
    return node;
  }

  evaluate(compositionId: string, time: number): EvaluatedSceneLayer[] {
    const result: EvaluatedSceneLayer[] = [];
    this.evaluateComposition(compositionId, time, IDENTITY_MATRIX, 1, [], result);
    return result;
  }

  evaluateFrame(compositionId: string, frame: number): EvaluatedSceneLayer[] {
    const composition = this.requireComposition(compositionId).composition;
    return this.evaluate(compositionId, frameToSeconds(frame, composition.fps ?? this.project.fps));
  }

  private build(): void {
    for (const composition of this.project.compositions) {
      if (this.compositions.has(composition.id)) {
        throw graphError("Composition IDs must be unique.", { compositionId: composition.id });
      }
      const ordered = orderedLayers(composition);
      const mutable = new Map<string, { layer: LayerDefinition; childIds: string[] }>();
      for (const layer of ordered) {
        if (mutable.has(layer.id)) {
          throw graphError("Layer IDs must be unique within a composition.", {
            compositionId: composition.id,
            layerId: layer.id
          });
        }
        mutable.set(layer.id, { layer, childIds: [] });
      }
      for (const layer of ordered) {
        if (layer.parentId === undefined) continue;
        const parent = mutable.get(layer.parentId);
        if (parent === undefined) {
          throw graphError("Layer parent does not exist in the same composition.", {
            compositionId: composition.id,
            layerId: layer.id,
            parentId: layer.parentId
          });
        }
        parent.childIds.push(layer.id);
      }
      const nodes = new Map<string, SceneNode>();
      for (const [id, value] of mutable) {
        const parentId = value.layer.parentId;
        nodes.set(id, parentId === undefined
          ? { layer: value.layer, childIds: Object.freeze([...value.childIds]) }
          : { layer: value.layer, parentId, childIds: Object.freeze([...value.childIds]) });
      }
      const rootIds = ordered.filter((layer) => layer.parentId === undefined).map((layer) => layer.id);
      this.compositions.set(composition.id, { composition, nodes, rootIds });
      this.assertNoParentCycle(composition.id, nodes);
    }
    for (const graph of this.compositions.values()) {
      for (const node of graph.nodes.values()) {
        if (node.layer.type === "composition" && !this.compositions.has(node.layer.properties.compositionId)) {
          throw graphError("Composition layer references a missing composition.", {
            compositionId: graph.composition.id,
            layerId: node.layer.id,
            targetCompositionId: node.layer.properties.compositionId
          });
        }
      }
    }
    this.assertNoCompositionCycle();
  }

  private assertNoParentCycle(compositionId: string, nodes: ReadonlyMap<string, SceneNode>): void {
    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (layerId: string): void => {
      if (active.has(layerId)) {
        throw graphError("Layer parent graph contains a cycle.", { compositionId, layerId });
      }
      if (visited.has(layerId)) return;
      active.add(layerId);
      const parentId = nodes.get(layerId)?.parentId;
      if (parentId !== undefined) visit(parentId);
      active.delete(layerId);
      visited.add(layerId);
    };
    for (const layerId of nodes.keys()) visit(layerId);
  }

  private assertNoCompositionCycle(): void {
    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (compositionId: string): void => {
      if (active.has(compositionId)) {
        throw graphError("Precomposition graph contains a cycle.", { compositionId });
      }
      if (visited.has(compositionId)) return;
      active.add(compositionId);
      const graph = this.requireComposition(compositionId);
      for (const node of graph.nodes.values()) {
        if (node.layer.type === "composition") visit(node.layer.properties.compositionId);
      }
      active.delete(compositionId);
      visited.add(compositionId);
    };
    for (const compositionId of this.compositions.keys()) visit(compositionId);
  }

  private evaluateComposition(
    compositionId: string,
    time: number,
    inheritedMatrix: Matrix4,
    inheritedOpacity: number,
    path: readonly string[],
    result: EvaluatedSceneLayer[]
  ): void {
    const graph = this.requireComposition(compositionId);
    if (time < 0 || time >= graph.composition.duration) return;
    for (const rootId of graph.rootIds) {
      this.evaluateNode(graph, rootId, time, inheritedMatrix, inheritedOpacity, path, result);
    }
  }

  private evaluateNode(
    graph: CompositionGraph,
    layerId: string,
    time: number,
    parentMatrix: Matrix4,
    parentOpacity: number,
    path: readonly string[],
    result: EvaluatedSceneLayer[]
  ): void {
    const node = graph.nodes.get(layerId);
    if (node === undefined) return;
    const layerTime = resolveLayerTime(node.layer, time);
    if (!layerTime.active) return;
    const localTransform = evaluateTransform(node.layer.transform, layerTime.sourceTime);
    const worldMatrix = multiplyMatrices(parentMatrix, localTransform.matrix);
    const worldOpacity = parentOpacity * evaluateNumber(node.layer.opacity, layerTime.sourceTime);
    const nextPath = [...path, graph.composition.id, node.layer.id];
    result.push({
      compositionId: graph.composition.id,
      layerId: node.layer.id,
      path: nextPath,
      parentTime: time,
      sourceTime: layerTime.sourceTime,
      localTransform,
      worldMatrix,
      worldOpacity
    });

    if (node.layer.type === "composition") {
      this.evaluateNested(node.layer, time, worldMatrix, worldOpacity, nextPath, result);
    }
    for (const childId of node.childIds) {
      this.evaluateNode(graph, childId, time, worldMatrix, worldOpacity, nextPath, result);
    }
  }

  private evaluateNested(
    layer: CompositionLayer,
    time: number,
    parentMatrix: Matrix4,
    parentOpacity: number,
    path: readonly string[],
    result: EvaluatedSceneLayer[]
  ): void {
    const target = this.requireComposition(layer.properties.compositionId).composition;
    const nested = resolveNestedTime(layer, time, target.duration);
    if (!nested.nestedActive) return;
    this.evaluateComposition(target.id, nested.nestedTime, parentMatrix, parentOpacity, path, result);
  }

  private requireComposition(compositionId: string): CompositionGraph {
    const graph = this.compositions.get(compositionId);
    if (graph === undefined) {
      throw graphError("Composition does not exist.", { compositionId });
    }
    return graph;
  }
}
