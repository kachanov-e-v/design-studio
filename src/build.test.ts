import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("build artifacts", () => {
  const root = path.resolve(__dirname, "..");
  const dir = path.join(root, "dist", "webview");

  it("contains required production files", () => {
    for (const file of ["index.html", "demo.html", "runtime.js", "protocol.js"]) {
      const full = path.join(dir, file);
      expect(fs.existsSync(full)).toBe(true);
      expect(fs.statSync(full).size).toBeGreaterThan(0);
    }
  });

  it("runtime references protocol", () => {
    const runtime = fs.readFileSync(path.join(dir, "runtime.js"), "utf8");
    expect(runtime).toContain("./protocol.js");
  });
});