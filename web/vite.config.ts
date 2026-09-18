import { writeFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const outDir = "../internal/web/dist";

// Relative base: the panel is served under a random secret path.
export default defineConfig({
  plugins: [
    react(),
    {
      // go:embed needs dist/ to exist in a fresh clone; the marker is tracked.
      name: "keep-marker",
      closeBundle: () => writeFileSync(`${outDir}/.keep`, ""),
    },
  ],
  base: "./",
  build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 800 },
  server: {
    // Dev: run `make run`, then `npm run dev` and open http://127.0.0.1:5173/
    proxy: { "/api": { target: "http://127.0.0.1:18080", rewrite: (p) => "/p" + p } },
  },
});
