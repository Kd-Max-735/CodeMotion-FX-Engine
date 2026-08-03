import { defineConfig, type Plugin, type PluginOption, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createExportApi, ExportTaskService } from "./src/export-task-service.js";
import { createEditorPreviewApi, EditorPreviewService } from "./src/preview-task-service.js";
import { createServerRuntime } from "./src/server-runtime.js";

const workspaceRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const exportApi = () => createExportApi(new ExportTaskService(
  resolve(workspaceRoot, "tmp/stage-6-media"),
  resolve(workspaceRoot, "tmp/stage-6-render")
));
const previewApi = () => createEditorPreviewApi(new EditorPreviewService(resolve(workspaceRoot, "tmp/stage-6-media")));

type RuntimeLifecycle = Pick<Awaited<ReturnType<typeof createServerRuntime>>, "handle" | "close">;
type RuntimeFactory = (options: Parameters<typeof createServerRuntime>[0]) => Promise<RuntimeLifecycle>;

const defaultRuntimeFactory: RuntimeFactory = (options) => createServerRuntime(options);

function settledClose(callback: () => Promise<void>): Promise<void> {
  try {
    return Promise.resolve(callback());
  } catch (error) {
    return Promise.reject(error);
  }
}

export function createServerRuntimePlugin(
  createRuntime: RuntimeFactory = defaultRuntimeFactory
): Plugin {
  return {
    name: "codemotion-server-runtime",
    async configureServer(server: ViteDevServer) {
      const host = "127.0.0.1";
      const port = 4174;
      const runtime = await createRuntime({
        mode: "development",
        configureServer: true,
        listenHost: host,
        publicOrigin: `http://${host}:${port}`,
        mediaRoot: resolve(workspaceRoot, "tmp/stage-6-media"),
        uploadTempRoot: resolve(workspaceRoot, "tmp/browser-upload")
      });
      const closeViteServer = server.close.bind(server);
      let closePromise: Promise<void> | undefined;

      server.close = () => {
        if (!closePromise) {
          closePromise = (async () => {
            const [runtimeResult, viteResult] = await Promise.allSettled([
              settledClose(() => runtime.close()),
              settledClose(closeViteServer)
            ]);
            const failures = [runtimeResult, viteResult]
              .filter((result): result is PromiseRejectedResult => result.status === "rejected")
              .map((result) => result.reason);
            if (failures.length === 1) throw failures[0];
            if (failures.length > 1) throw new AggregateError(failures, "Vite and server runtime close failed.");
          })();
        }
        return closePromise;
      };

      server.middlewares.use(runtime.handle);
    }
  };
}

export default defineConfig({
  plugins: [
    react() as unknown as PluginOption,
    {
      name: "codemotion-export-api",
      configureServer(server) { server.middlewares.use(exportApi()); },
      configurePreviewServer(server) { server.middlewares.use(exportApi()); }
    },
    createServerRuntimePlugin(),
    {
      name: "codemotion-editor-preview-api",
      configureServer(server) { server.middlewares.use(previewApi()); },
      configurePreviewServer(server) { server.middlewares.use(previewApi()); }
    }
  ],
  build: { outDir: "dist-app", emptyOutDir: true },
  server: { port: 4174 },
  preview: { port: 4174 }
});
