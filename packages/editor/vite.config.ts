import { defineConfig, type Plugin, type PluginOption, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve } from "node:path";
import { createServerRuntime } from "./src/server-runtime.js";

const workspaceRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

type RuntimeLifecycle = Pick<Awaited<ReturnType<typeof createServerRuntime>>, "handle" | "close">;
type RuntimeFactory = (options: Parameters<typeof createServerRuntime>[0]) => Promise<RuntimeLifecycle>;

const defaultRuntimeFactory: RuntimeFactory = (options) => createServerRuntime(options);
const RUNTIME_CLOSE_TIMEOUT_MS = 30_000;

function developmentLoginCodeFile(): { write(code: string): void; clear(): void } | undefined {
  const configured = process.env.CODEMOTION_DEV_LOGIN_CODE_FILE?.trim();
  if (!configured) return undefined;
  const root = resolve(workspaceRoot, "tmp");
  const target = resolve(root, configured);
  const fromRoot = relative(root, target);
  if (!fromRoot || isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..\\`) || fromRoot.startsWith("../")) {
    throw new Error("CODEMOTION_DEV_LOGIN_CODE_FILE must resolve to one file inside the workspace tmp directory.");
  }
  const write = (value: string): void => writeFileSync(target, value, { encoding: "utf8", mode: 0o600 });
  return { write, clear: () => write("") };
}

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
    name: "codemotion-server-runtime",
    async configureServer(server: ViteDevServer) {
      const host = "127.0.0.1";
      const port = 4174;
      const loginCodeFile = developmentLoginCodeFile();
      let runtime: RuntimeLifecycle;
      try {
        runtime = await createRuntime({
          mode: "development",
          configureServer: true,
          listenHost: host,
          publicOrigin: `http://${host}:${port}`,
          mediaRoot: resolve(workspaceRoot, "tmp/stage-6-media"),
          uploadTempRoot: resolve(workspaceRoot, "tmp/browser-upload"),
          ...(loginCodeFile === undefined ? {} : { writeDevLoginCode: loginCodeFile.write })
        });
      } catch (error) {
        loginCodeFile?.clear();
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
            let loginCodeResult: PromiseSettledResult<void> = { status: "fulfilled", value: undefined };
            try { loginCodeFile?.clear(); }
            catch (reason) { loginCodeResult = { status: "rejected", reason }; }
            const failures = [runtimeResult, viteResult, loginCodeResult]
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
  server: { port: 4174 },
  preview: { port: 4174 }
});
