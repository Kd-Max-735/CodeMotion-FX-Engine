import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createExportApi, ExportTaskService } from "./src/export-task-service.js";

const workspaceRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const exportApi = () => createExportApi(new ExportTaskService(
  resolve(workspaceRoot, "tmp/stage-6-media"),
  resolve(workspaceRoot, "tmp/stage-6-render")
));

export default defineConfig({
  plugins: [
    react(),
    {
      name: "codemotion-export-api",
      configureServer(server) { server.middlewares.use(exportApi()); },
      configurePreviewServer(server) { server.middlewares.use(exportApi()); }
    }
  ],
  build: { outDir: "dist-app", emptyOutDir: true },
  server: { port: 4174 },
  preview: { port: 4174 }
});
