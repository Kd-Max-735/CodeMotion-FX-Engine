# Stage 1 example

`minimal-project.json` is a renderer-independent project fixture. It demonstrates a composition, a text layer, constant transforms, keyframed opacity, the project seed, and the current version contracts.

```ts
import { readFile } from "node:fs/promises";
import { loadProject, saveProject } from "@codemotion/schema";

const source = await readFile("examples/minimal-project.json", "utf8");
const project = loadProject(source);
const canonicalJson = saveProject(project);
```

After building the workspaces, `node examples/stage-2-playback.mjs` evaluates frames 0, 15, and 30 through the UI-independent Stage 2 scene graph.

`node examples/stage-3-core.mjs` exercises the safe expression, Effect Graph, resource lifecycle, and deterministic cache-key contracts without a renderer or UI.

After `npm run build`, serve the repository root and open `examples/stage-3-vertical-preview.html` to run the 270x480 WebGL mask, effect-stack, Alpha-composite, readback, and display path.
