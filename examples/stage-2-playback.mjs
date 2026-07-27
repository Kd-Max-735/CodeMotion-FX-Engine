import { readFile } from "node:fs/promises";
import { SceneGraph } from "@codemotion/scene-graph";
import { loadProject } from "@codemotion/schema";

const source = await readFile(new URL("./minimal-project.json", import.meta.url), "utf8");
const project = loadProject(source);
const graph = new SceneGraph(project);
const compositionId = project.compositions[0].id;
const frames = [0, 15, 30].map((frame) => ({
  frame,
  layers: graph.evaluateFrame(compositionId, frame).map((layer) => ({
    id: layer.layerId,
    opacity: layer.worldOpacity,
    sourceTime: layer.sourceTime
  }))
}));

console.log(JSON.stringify({ fps: project.fps, frames }));
