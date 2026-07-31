import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Dev-only: the quill CLI server that serves /api. */
const API_TARGET = process.env.QUILL_API ?? "http://127.0.0.1:7823";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    port: 5273,
    proxy: { "/api": { target: API_TARGET, changeOrigin: true } },
  },
});
