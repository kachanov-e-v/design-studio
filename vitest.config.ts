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
    coverage: {
      provider: "v8",
      include: [
        "src/shared/**",
        "src/infrastructure/persistence/**",
        "src/infrastructure/preview/**",
        "packages/preview-runtime/src/**",
        "webview/**/*.ts",
        "webview/**/*.tsx",
      ],
      reporter: ["text", "lcov"],
      // P3-6: per-area line thresholds (≥80% lines for shared, persistence,
      // preview host and preview runtime).
      thresholds: {
        "src/shared/**": { lines: 80 },
        "src/infrastructure/persistence/**": { lines: 80 },
        "src/infrastructure/preview/**": { lines: 80 },
        "packages/preview-runtime/src/**": { lines: 80 },
        // ENG-02: the webview UI area is under a threshold as well. The bar
        // starts at the measured baseline (App/Toolbar/Inspector are only
        // partially covered by the message-flow and component tests) and must
        // be raised to 80 as more component tests land.
        "webview/**": { lines: 54 },
      },
    },
  },
});
