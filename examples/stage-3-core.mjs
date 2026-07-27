import { createCacheKey } from "@codemotion/cache";
import { validateEffectGraph } from "@codemotion/effect-graph";
import { ExpressionEngine } from "@codemotion/expression";
import { ResourceManager } from "@codemotion/resource-manager";

const expression = new ExpressionEngine({
  programs: [{
    id: "opacity",
    resultType: "number",
    fallback: 0,
    ast: {
      type: "call",
      name: "clamp",
      arguments: [{ type: "variable", name: "value" }, { type: "literal", value: 0 }, { type: "literal", value: 1 }]
    }
  }]
});

const port = { valueType: "texture", width: 1920, height: 1080, alphaMode: "premultiplied", colorSpace: "srgb" };
const graph = validateEffectGraph({
  version: "1.0.0",
  outputNodeId: "output",
  nodes: [
    { id: "input", kind: "input", inputs: {}, outputs: { image: port }, config: {} },
    { id: "output", kind: "output", inputs: { source: port }, outputs: {}, config: {} }
  ],
  edges: [{ fromNode: "input", fromPort: "image", toNode: "output", toPort: "source" }]
});

let releases = 0;
const resources = new ResourceManager();
resources.register("memory", { load: () => ({ bytes: 4 }), release: () => { releases += 1; } });
const lease = await resources.acquire({ id: "asset.memory", type: "memory", cacheKey: "sha256:memory", metadata: {} });
await lease.release();

const cacheKey = createCacheKey({
  resourceHash: "sha256:memory",
  effectVersion: "1.0.0",
  parameterHash: "sha256:none",
  timeRange: { start: 0, end: 1 },
  width: 1920,
  height: 1080,
  quality: "preview",
  colorSpace: "srgb",
  seed: 42,
  backend: "webgl"
});

console.log(JSON.stringify({
  expression: expression.evaluate("opacity", { variables: { value: 1.5 } }).value,
  topologicalOrder: graph.topologicalOrder,
  resourceBytes: lease.value.bytes,
  releases,
  cacheKey
}));
