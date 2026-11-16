import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@design-studio/preview-runtime": path.resolve(__dirname, "packages/preview-runtime/src"),
      "@design-studio/shared": path.resolve(__dirname, "src/shared"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "packages/**/*.test.ts", "packages/**/*.test.tsx", "webview/**/*.test.ts", "webview/**/*.test.tsx"],
  },
});
