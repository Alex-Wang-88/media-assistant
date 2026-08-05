import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const workspacePackages = [
  "@yoom/desktop-contracts",
  "@yoom/markdown-schemas",
];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: {
        exclude: workspacePackages,
      },
      lib: {
        entry: resolve("src/main/index.ts"),
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: {
        exclude: workspacePackages,
      },
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