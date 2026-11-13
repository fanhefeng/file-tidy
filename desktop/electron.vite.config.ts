import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          worker: resolve("src/main/worker.ts"),
        },
        output: { entryFileNames: "[name].js" },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve("src/preload/index.ts"),
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    plugins: [
      {
        name: "development-csp",
        apply: "serve",
        transformIndexHtml(html) {
          // Vite's React refresh preamble and style HMR run only in development.
          return html
            .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
            .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");
        },
      },
      react(),
    ],
  },
});
