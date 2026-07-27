import { describe, expect, it } from "vitest";
import { ERROR_CODES, type EffectGraphDefinition, type EffectGraphPortContract, type EffectInstance } from "@codemotion/core";
import {
  executeEffectStack,
  migrateEffectInstance,
  reorderEffectStack,
  validateEffectGraph
} from "../src/index.js";

const texture: EffectGraphPortContract = {
  valueType: "texture", width: 1920, height: 1080, alphaMode: "premultiplied", colorSpace: "srgb"
};

function validGraph(): EffectGraphDefinition {
  return {
    version: "1.0.0",
    outputNodeId: "output",
    nodes: [
      { id: "input", kind: "input", inputs: {}, outputs: { image: texture }, config: {} },
      { id: "effect", kind: "effect", inputs: { source: texture }, outputs: { image: texture }, config: {} },
      { id: "output", kind: "output", inputs: { source: texture }, outputs: {}, config: {} }
    ],
    edges: [
      { fromNode: "input", fromPort: "image", toNode: "effect", toPort: "source" },
      { fromNode: "effect", fromPort: "image", toNode: "output", toPort: "source" }
    ]
  };
}

function effect(id: string, version = "1.0.0"): EffectInstance {
  return { id, effectId: "fx.motion.test", version, enabled: true, mix: { mode: "constant", value: 1 }, params: {} };
}

describe("Effect Graph validation", () => {
  it("returns a stable deterministic topological order", () => {
    const graph = validGraph();
    const runs = [1, 2, 3].map(() => validateEffectGraph(graph).topologicalOrder);
    expect(runs).toEqual([
      ["input", "effect", "output"],
      ["input", "effect", "output"],
      ["input", "effect", "output"]
    ]);
  });

  it.each([
    ["valueType", { valueType: "mask" }],
    ["width", { width: 1280 }],
    ["height", { height: 720 }],
    ["alphaMode", { alphaMode: "straight" }],
    ["colorSpace", { colorSpace: "linear-srgb" }]
  ] as const)("rejects %s port mismatches", (field, override) => {
    const graph = validGraph();
    graph.nodes[1]!.inputs.source = { ...texture, ...override } as EffectGraphPortContract;
    expect(() => validateEffectGraph(graph)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EFFECT_GRAPH_INVALID, details: expect.objectContaining({ field }) })
    );
  });

  it("rejects cycles, unreachable outputs, unused nodes, and texture overuse", () => {
    expect(() => validateEffectGraph({ ...validGraph(), version: "0.9.0" as "1.0.0" })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EFFECT_GRAPH_INVALID })
    );
    const cyclic = validGraph();
    cyclic.nodes[1]!.inputs.feedback = texture;
    cyclic.edges.push({ fromNode: "effect", fromPort: "image", toNode: "effect", toPort: "feedback" });
    expect(() => validateEffectGraph(cyclic)).toThrowError(expect.objectContaining({ code: ERROR_CODES.EFFECT_GRAPH_INVALID }));

    const unreachable = validGraph();
    unreachable.nodes[2]!.inputs = {};
    unreachable.edges.pop();
    expect(() => validateEffectGraph(unreachable)).toThrowError(expect.objectContaining({ code: ERROR_CODES.EFFECT_GRAPH_INVALID }));

    const unused = validGraph();
    unused.nodes.push({ id: "unused", kind: "color", inputs: {}, outputs: { color: { valueType: "color" } }, config: {} });
    expect(() => validateEffectGraph(unused)).toThrowError(expect.objectContaining({ code: ERROR_CODES.EFFECT_GRAPH_INVALID }));
    expect(() => validateEffectGraph(validGraph(), { maxIntermediateTextures: 0 })).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.EFFECT_GRAPH_INVALID })
    );
  });
});

describe("effect stack and migration", () => {
  it("reorders explicitly and isolates failed effects without changing prior output", async () => {
    const effects = [effect("a"), effect("b"), effect("c")];
    const ordered = reorderEffectStack(effects, ["c", "a", "b"]);
    expect(ordered.map((item) => item.id)).toEqual(["c", "a", "b"]);
    const result = await executeEffectStack("source", ordered, (input, item) => {
      if (item.id === "a") throw new Error("isolated");
      return `${input}:${item.id}`;
    });
    expect(result.output).toBe("source:c:b");
    expect(result.failures).toMatchObject([{ instanceId: "a", error: { code: ERROR_CODES.EFFECT_EXECUTION_FAILED } }]);
  });

  it("migrates parameters in order and normalizes failures", () => {
    const migrated = migrateEffectInstance(effect("m", "1.0.0"), "1.2.0", [
      { fromVersion: "1.0.0", toVersion: "1.1.0", migrate: () => ({ amount: 1 }) },
      { fromVersion: "1.1.0", toVersion: "1.2.0", migrate: (params) => ({ ...params, enabled: true }) }
    ]);
    expect(migrated).toMatchObject({ version: "1.2.0", params: { amount: 1, enabled: true } });
    expect(() => migrateEffectInstance(effect("m"), "1.1.0", [
      { fromVersion: "1.0.0", toVersion: "1.1.0", migrate() { throw new Error("sensitive"); } }
    ])).toThrowError(expect.objectContaining({ code: ERROR_CODES.EFFECT_MIGRATION_FAILED }));
    expect(() => migrateEffectInstance(effect("m"), "1.1.0", [
      { fromVersion: "1.0.0", toVersion: "1.1.0", migrate: () => null as never }
    ])).toThrowError(expect.objectContaining({ code: ERROR_CODES.EFFECT_MIGRATION_FAILED }));
  });
});
