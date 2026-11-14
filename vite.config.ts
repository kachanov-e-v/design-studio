import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "webview",
  plugins: [react()],
  build: {
    outDir: "../dist/webview",
    emptyOutDir: true,
  },
});