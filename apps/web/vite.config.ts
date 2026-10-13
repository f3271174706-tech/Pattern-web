import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  cacheDir:
    process.env.VITE_CACHE_DIR ??
    fileURLToPath(new URL("../../node_modules/.vite", import.meta.url)),
  server: {
    port: 5173,
    strictPort: true,
    proxy: { "/api": process.env.API_TARGET ?? "http://127.0.0.1:3001" },
  },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
