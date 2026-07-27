# Stage 1 example

`minimal-project.json` is a renderer-independent project fixture. It demonstrates a composition, a text layer, constant transforms, keyframed opacity, the project seed, and the current version contracts.

```ts
import { readFile } from "node:fs/promises";
import { loadProject, saveProject } from "@codemotion/schema";

const source = await readFile("examples/minimal-project.json", "utf8");
const project = loadProject(source);
const canonicalJson = saveProject(project);
```
