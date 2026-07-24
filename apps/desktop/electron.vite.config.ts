import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve("src/main/index.ts") } },
  },
  preload: {
    build: {
      lib: {
        entry: resolve("src/preload/index.ts"),
        formats: ["cjs"],
        fileName: () => "index.cjs",
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    plugins: [react(), tailwindcss()],
  },
});
