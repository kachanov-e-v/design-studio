import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveComponentPaths, stripBundlerPrefix } from "./ComponentResolver";

const tempDirs: string[] = [];

function makeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-comps-"));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("stripBundlerPrefix", () => {
  it("strips webpack-internal, turbopack groups and Vite query strings", () => {
    expect(stripBundlerPrefix("webpack-internal:///./src/components/LoginForm.tsx")).toBe("./src/components/LoginForm.tsx");
    expect(stripBundlerPrefix("(app-pages-browser)/./app/login/page.tsx")).toBe("./app/login/page.tsx");
    expect(stripBundlerPrefix("/src/components/Header.tsx?t=1712345678")).toBe("/src/components/Header.tsx");
  });
});

describe("resolveComponentPaths", () => {
  it("resolves relative bundler paths to workspace-relative files", () => {
    const root = makeProject({ "src/components/LoginForm.tsx": "export default 1;\n" });
    const out = resolveComponentPaths(root, [
      { name: "LoginForm", file: "webpack-internal:///./src/components/LoginForm.tsx", line: 42 },
      { name: "Unknown", file: "./src/components/Missing.tsx" },
      { name: "NoFile" },
    ]);
    expect(out).toEqual([
      { name: "LoginForm", file: "src/components/LoginForm.tsx", line: 42 },
      { name: "Unknown", file: "./src/components/Missing.tsx" },
      { name: "NoFile" },
    ]);
  });

  it("resolves absolute paths inside the workspace", () => {
    const root = makeProject({ "app/page.tsx": "export default 1;\n" });
    const out = resolveComponentPaths(root, [{ name: "Page", file: path.join(root, "app/page.tsx"), line: 3 }]);
    expect(out).toEqual([{ name: "Page", file: "app/page.tsx", line: 3 }]);
  });

  it("returns empty for undefined and empty input", () => {
    expect(resolveComponentPaths("/tmp", undefined)).toEqual([]);
    expect(resolveComponentPaths("/tmp", [])).toEqual([]);
  });
});
