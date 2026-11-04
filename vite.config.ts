import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` → dist/ for GitHub Pages (relative paths, works under /<repo>/).
// `npm run build:preview` → dist-preview/index.html, one self-contained file for quick review.
export default defineConfig(({ mode }) => ({
  base: "./",
  // The preview file is a single page; Excalidraw's font files (public/) are left out of it.
  publicDir: mode === "singlefile" ? false : "public",
  plugins: [react(), ...(mode === "singlefile" ? [viteSingleFile()] : [])],
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
  build: {
    outDir: mode === "singlefile" ? "dist-preview" : "dist",
    chunkSizeWarningLimit: 6000,
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
}));
