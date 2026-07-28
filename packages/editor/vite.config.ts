import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist-app", emptyOutDir: true },
  server: { port: 4174 },
  preview: { port: 4174 }
});
