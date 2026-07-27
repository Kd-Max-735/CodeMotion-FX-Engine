import {
  EngineError,
  ERROR_CODES,
  type EffectGraphDefinition,
  type EffectGraphNodeDefinition,
  type EffectGraphPortContract,
  type EffectInstance,
  type JsonObject
} from "@codemotion/core";

export interface EffectGraphValidationOptions {
  readonly maxIntermediateTextures?: number;
}

export interface ValidatedEffectGraph {
  readonly graph: EffectGraphDefinition;
  readonly topologicalOrder: readonly string[];
  readonly intermediateTextureCount: number;
}

function graphError(message: string, details: JsonObject = {}): EngineError {
  return new EngineError(ERROR_CODES.EFFECT_GRAPH_INVALID, message, { details });
}

function portsCompatible(source: EffectGraphPortContract, target: EffectGraphPortContract): string | undefined {
  if (source.valueType !== target.valueType) return "valueType";
  if (target.width !== undefined && source.width !== target.width) return "width";
  if (target.height !== undefined && source.height !== target.height) return "height";
  if (target.alphaMode !== undefined && source.alphaMode !== target.alphaMode) return "alphaMode";
  if (target.colorSpace !== undefined && source.colorSpace !== target.colorSpace) return "colorSpace";
  return undefined;
}

export function validateEffectGraph(
  graph: EffectGraphDefinition,
  options: EffectGraphValidationOptions = {}
): ValidatedEffectGraph {
  if (graph.version !== "1.0.0") throw graphError("Unsupported Effect Graph contract version.", { version: graph.version });
  const maxIntermediateTextures = options.maxIntermediateTextures ?? 32;
  if (!Number.isInteger(maxIntermediateTextures) || maxIntermediateTextures < 0) {
    throw new RangeError("maxIntermediateTextures must be a non-negative integer.");
  }

  const nodes = new Map<string, EffectGraphNodeDefinition>();
  const orderIndex = new Map<string, number>();
  graph.nodes.forEach((node, index) => {
    if (node.id.length === 0 || nodes.has(node.id)) {
      throw graphError("Effect Graph node IDs must be non-empty and unique.", { nodeId: node.id });
    }
    nodes.set(node.id, node);
    orderIndex.set(node.id, index);
  });
  const output = nodes.get(graph.outputNodeId);
  if (output === undefined || output.kind !== "output") {
    throw graphError("Effect Graph outputNodeId must reference an output node.", { outputNodeId: graph.outputNodeId });
  }

  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  const connectedInputs = new Map<string, Set<string>>();
  for (const nodeId of nodes.keys()) {
    outgoing.set(nodeId, []);
    incoming.set(nodeId, []);
  }
  for (const edge of graph.edges) {
    const sourceNode = nodes.get(edge.fromNode);
    const targetNode = nodes.get(edge.toNode);
    if (sourceNode === undefined || targetNode === undefined) {
      throw graphError("Effect Graph edge references a missing node.", {
        fromNode: edge.fromNode,
        toNode: edge.toNode
      });
    }
    const sourcePort = sourceNode.outputs[edge.fromPort];
    const targetPort = targetNode.inputs[edge.toPort];
    if (sourcePort === undefined || targetPort === undefined) {
      throw graphError("Effect Graph edge references a missing port.", {
        fromNode: edge.fromNode,
        fromPort: edge.fromPort,
        toNode: edge.toNode,
        toPort: edge.toPort
      });
    }
    const nodeInputs = connectedInputs.get(edge.toNode) ?? new Set<string>();
    if (nodeInputs.has(edge.toPort)) {
      throw graphError("Effect Graph input ports accept only one edge.", { nodeId: edge.toNode, port: edge.toPort });
    }
    nodeInputs.add(edge.toPort);
    connectedInputs.set(edge.toNode, nodeInputs);
    const mismatch = portsCompatible(sourcePort, targetPort);
    if (mismatch !== undefined) {
      throw graphError("Effect Graph port contracts are incompatible.", {
        field: mismatch,
        fromNode: edge.fromNode,
        fromPort: edge.fromPort,
        toNode: edge.toNode,
        toPort: edge.toPort
      });
    }
    outgoing.get(edge.fromNode)?.push(edge.toNode);
    incoming.get(edge.toNode)?.push(edge.fromNode);
  }
  for (const node of graph.nodes) {
    for (const port of Object.keys(node.inputs)) {
      if (!connectedInputs.get(node.id)?.has(port)) {
        throw graphError("Effect Graph input port is not connected.", { nodeId: node.id, port });
      }
    }
  }

  const indegree = new Map([...incoming].map(([nodeId, parents]) => [nodeId, parents.length]));
  const ready = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const topologicalOrder: string[] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => (orderIndex.get(left) ?? 0) - (orderIndex.get(right) ?? 0));
    const nodeId = ready.shift();
    if (nodeId === undefined) break;
    topologicalOrder.push(nodeId);
    for (const childId of outgoing.get(nodeId) ?? []) {
      const next = (indegree.get(childId) ?? 0) - 1;
      indegree.set(childId, next);
      if (next === 0) ready.push(childId);
    }
  }
  if (topologicalOrder.length !== graph.nodes.length) {
    throw graphError("Effect Graph must be a directed acyclic graph.");
  }

  if ((incoming.get(graph.outputNodeId)?.length ?? 0) === 0) {
    throw graphError("Effect Graph output is unreachable from a source node.", { outputNodeId: graph.outputNodeId });
  }

  const sourceReachable = new Set<string>();
  for (const nodeId of topologicalOrder) {
    const node = nodes.get(nodeId);
    if (node === undefined) continue;
    if (node.kind === "input" || node.kind === "texture" || node.kind === "color" || (incoming.get(nodeId)?.length ?? 0) === 0) {
      sourceReachable.add(nodeId);
    }
    if (sourceReachable.has(nodeId)) {
      for (const childId of outgoing.get(nodeId) ?? []) sourceReachable.add(childId);
    }
  }
  if (!sourceReachable.has(graph.outputNodeId)) {
    throw graphError("Effect Graph output is unreachable from a source node.", { outputNodeId: graph.outputNodeId });
  }

  const reachesOutput = new Set<string>([graph.outputNodeId]);
  const reverseOrder = [...topologicalOrder].reverse();
  for (const nodeId of reverseOrder) {
    if (!reachesOutput.has(nodeId)) continue;
    for (const parentId of incoming.get(nodeId) ?? []) reachesOutput.add(parentId);
  }
  const unreachable = graph.nodes.filter((node) => !reachesOutput.has(node.id)).map((node) => node.id);
  if (unreachable.length > 0) {
    throw graphError("Effect Graph contains nodes that cannot reach the output.", { nodeIds: unreachable });
  }

  const intermediateTextureCount = graph.nodes
    .filter((node) => node.kind !== "input" && node.kind !== "output")
    .reduce((count, node) => count + Object.values(node.outputs).filter((port) => port.valueType === "texture").length, 0);
  if (intermediateTextureCount > maxIntermediateTextures) {
    throw graphError("Effect Graph exceeds the intermediate texture limit.", {
      intermediateTextureCount,
      maxIntermediateTextures
    });
  }
  return { graph, topologicalOrder: Object.freeze(topologicalOrder), intermediateTextureCount };
}

export function reorderEffectStack(
  effects: readonly EffectInstance[],
  orderedInstanceIds: readonly string[]
): EffectInstance[] {
  if (orderedInstanceIds.length !== effects.length || new Set(orderedInstanceIds).size !== effects.length) {
    throw graphError("Effect stack order must contain each instance exactly once.");
  }
  const byId = new Map(effects.map((effect) => [effect.id, effect]));
  const reordered = orderedInstanceIds.map((id) => byId.get(id));
  if (reordered.some((effect) => effect === undefined)) {
    throw graphError("Effect stack order references an unknown instance.");
  }
  return reordered as EffectInstance[];
}

export interface EffectStackFailure {
  readonly instanceId: string;
  readonly error: EngineError;
}

export interface EffectStackResult<T> {
  readonly output: T;
  readonly failures: readonly EffectStackFailure[];
}

export async function executeEffectStack<T>(
  input: T,
  effects: readonly EffectInstance[],
  execute: (input: T, effect: EffectInstance) => Promise<T> | T
): Promise<EffectStackResult<T>> {
  let output = input;
  const failures: EffectStackFailure[] = [];
  for (const effect of effects) {
    if (!effect.enabled) continue;
    try {
      output = await execute(output, effect);
    } catch (cause) {
      failures.push({
        instanceId: effect.id,
        error: new EngineError(ERROR_CODES.EFFECT_EXECUTION_FAILED, "Effect stack item failed.", {
          cause,
          details: { instanceId: effect.id, effectId: effect.effectId }
        })
      });
    }
  }
  return { output, failures };
}

export interface EffectParameterMigration {
  readonly fromVersion: string;
  readonly toVersion: string;
  migrate(params: JsonObject): JsonObject;
}

export function migrateEffectInstance(
  effect: EffectInstance,
  targetVersion: string,
  migrations: readonly EffectParameterMigration[]
): EffectInstance {
  let version = effect.version;
  let params = effect.params as unknown as JsonObject;
  const visited = new Set<string>();
  for (let step = 0; version !== targetVersion; step += 1) {
    if (step >= 32 || visited.has(version)) {
      throw new EngineError(ERROR_CODES.EFFECT_MIGRATION_FAILED, "Effect migration chain is cyclic or too long.", {
        details: { instanceId: effect.id, version, targetVersion }
      });
    }
    visited.add(version);
    const migration = migrations.find((candidate) => candidate.fromVersion === version);
    if (migration === undefined) {
      throw new EngineError(ERROR_CODES.EFFECT_MIGRATION_FAILED, "Effect migration route is unavailable.", {
        details: { instanceId: effect.id, version, targetVersion }
      });
    }
    let migrated: unknown;
    try {
      migrated = migration.migrate(params);
    } catch (cause) {
      throw new EngineError(ERROR_CODES.EFFECT_MIGRATION_FAILED, "Effect parameter migration failed.", {
        cause,
        details: { instanceId: effect.id, fromVersion: version, toVersion: migration.toVersion }
      });
    }
    if (typeof migrated !== "object" || migrated === null || Array.isArray(migrated)) {
      throw new EngineError(ERROR_CODES.EFFECT_MIGRATION_FAILED, "Effect migration must return a parameter object.", {
        details: { instanceId: effect.id, fromVersion: version, toVersion: migration.toVersion }
      });
    }
    params = migrated as JsonObject;
    version = migration.toVersion;
  }
  return { ...effect, version, params: params as EffectInstance["params"] };
}
