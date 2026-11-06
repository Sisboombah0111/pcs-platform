import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// The version shown in the app (Guide panel, start card): package.json, and the day it was built.
const VERSION = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;
const BUILD_DATE = process.env.PCS_BUILD_DATE ?? new Date().toISOString().slice(0, 10);

// `npm run build` → dist/ for GitHub Pages (relative paths, works under /<repo>/).
// `npm run build:preview` → dist-preview/index.html, one self-contained file for quick review.
export default defineConfig(({ mode }) => ({
  base: "./",
  // The preview file is a single page; Excalidraw's font files (public/) are left out of it.
  publicDir: mode === "singlefile" ? false : "public",
  plugins: [react(), ...(mode === "singlefile" ? [viteSingleFile()] : [])],
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
    __APP_VERSION__: JSON.stringify(VERSION),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
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
