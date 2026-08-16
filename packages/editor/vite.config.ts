import { defineConfig, loadEnv, type Plugin, type PluginOption, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createAeAgentServerRuntime } from "./src/ae-agent-server-runtime.js";

const workspaceRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

type RuntimeLifecycle = Pick<Awaited<ReturnType<typeof createAeAgentServerRuntime>>, "handle" | "close">;
type RuntimeFactory = (options: Parameters<typeof createAeAgentServerRuntime>[0]) => Promise<RuntimeLifecycle>;

const defaultRuntimeFactory: RuntimeFactory = (options) => createAeAgentServerRuntime(options);
const RUNTIME_CLOSE_TIMEOUT_MS = 30_000;

function settledClose(callback: () => Promise<void>): Promise<void> {
  try {
    return Promise.resolve(callback());
  } catch (error) {
    return Promise.reject(error);
  }
}

async function boundedRuntimeClose(callback: () => Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(
      `Server runtime did not close within ${RUNTIME_CLOSE_TIMEOUT_MS} ms.`
    )), RUNTIME_CLOSE_TIMEOUT_MS);
    timer.unref();
  });
  try {
    await Promise.race([settledClose(callback), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createServerRuntimePlugin(
  createRuntime: RuntimeFactory = defaultRuntimeFactory
): Plugin {
  return {
    name: "ae-agent-server-runtime",
    async configureServer(server: ViteDevServer) {
      const host = "127.0.0.1";
      const port = 4174;
      let runtime: RuntimeLifecycle;
      try {
        const env = { ...process.env, ...loadEnv("development", workspaceRoot, "") };
        runtime = await createRuntime({
          mode: "development",
          configureServer: true,
          listenHost: host,
          publicOrigin: `http://${host}:${port}`,
          mediaRoot: resolve(workspaceRoot, "tmp/stage-6-media"),
          uploadTempRoot: resolve(workspaceRoot, "tmp/browser-upload"),
          env
        });
      } catch (error) {
        throw error;
      }
      const closeViteServer = server.close.bind(server);
      let closePromise: Promise<void> | undefined;

      server.close = () => {
        if (!closePromise) {
          closePromise = (async () => {
            const [runtimeResult, viteResult] = await Promise.allSettled([
              boundedRuntimeClose(() => runtime.close()),
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
    createServerRuntimePlugin()
  ],
  build: { outDir: "dist-app", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 4174, strictPort: true },
  preview: { port: 4174 }
});
