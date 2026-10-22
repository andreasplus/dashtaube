import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `pnpm dev:web` startet nur das Dashboard und leitet API-Aufrufe an `wrangler dev` (Port 8787) weiter.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/v1": { target: "http://localhost:8787", ws: true },
      "/authorize": "http://localhost:8787",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
