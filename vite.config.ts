import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: "webview",
  plugins: [react()],
  resolve: {
    alias: {
      "@design-studio/preview-runtime": path.resolve(__dirname, "packages/preview-runtime/src"),
      "@design-studio/shared": path.resolve(__dirname, "src/shared"),
    },
  },
  build: {
    outDir: "../dist/webview",
    emptyOutDir: true,
  },
});