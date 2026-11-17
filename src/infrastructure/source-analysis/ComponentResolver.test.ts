import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findComponentDefinition, pickRevealTarget, resolveComponentPaths, stripBundlerPrefix } from "./ComponentResolver";

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

describe("pickRevealTarget", () => {
  it("skips node_modules entries and any existing files before a workspace file", () => {
    const root = makeProject({
      "node_modules/@mui/material/CardContent.js": "module.exports = {};",
      "src/components/Card.tsx": "export default 1;\n",
    });
    const target = pickRevealTarget(root, [
      { name: "MuiCardContentRoot", file: "webpack-internal:///./node_modules/@mui/material/CardContent.js", line: 10 },
      { name: "Card", file: "webpack-internal:///./src/components/Card.tsx", line: 7 },
    ]);
    expect(target?.name).toBe("Card");
    expect(target?.file?.replace(/\\/g, "/")).toContain("src/components/Card.tsx");
    expect(target?.line).toBe(7);
  });

  it("resolves bundler prefixes and returns an absolute file path", () => {
    const root = makeProject({ "app/login/page.tsx": "export default 1;\n" });
    const target = pickRevealTarget(root, [
      { name: "Page", file: "(app-pages-browser)/./app/login/page.tsx", line: 3 },
    ]);
    expect(path.resolve(target?.file ?? "")).toBe(path.resolve(root, "app/login/page.tsx"));
    expect(target?.line).toBe(3);
  });

  it("returns undefined when no candidate exists or input is empty", () => {
    const root = makeProject({});
    expect(pickRevealTarget(root, [{ name: "Missing", file: "./src/NotFound.tsx" }])).toBeUndefined();
    expect(pickRevealTarget(root, undefined)).toBeUndefined();
    expect(pickRevealTarget(root, [{ name: "NoFile" }])).toBeUndefined();
  });
});

/**
 * RT-02: React 19 dev builds dropped `_debugSource` and Turbopack dev stacks
 * only surface `chunks/` frames, so selections often arrive with component
 * NAMES but no file. "Перейти"/"Копировать компонент" used to die with
 * status.sourceMissing. findComponentDefinition falls back to a workspace
 * scan for the Definition of the component by its name.
 */
describe("findComponentDefinition (RT-02: name-only component fibers)", () => {
  it("locates the component definition by name when the fiber carries no file", async () => {
    const root = makeProject({
      "src/components/Board.tsx": "export function Board() {\n  return null;\n}\n",
      "src/app/page.tsx": "import { Board } from \"../components/Board\";\nexport default function Page() {\n  return <Board />;\n}\n",
      "node_modules/left-pad/left-pad.jsx": "function Board() {}\n",
    });
    const found = await findComponentDefinition(root, "Board");
    expect(found?.file.replace(/\\/g, "/")).toBe("src/components/Board.tsx");
    expect(found?.line).toBe(1);
    expect(await findComponentDefinition(root, "Nonexistent")).toBeUndefined();
  });

  it("supports const/let arrow and class definitions", async () => {
    const root = makeProject({
      "src/Arrow.tsx": "const Arrow = (props) => <i {...props} />;\n",
      "src/Class.tsx": "class Class extends React.Component {}\n",
      "src/Var.tsx": "let Var = function Var() { return null; };\n",
    });
    const expectPosix = async (name: string): Promise<string | undefined> =>
      (await findComponentDefinition(root, name))?.file.replace(/\\/g, "/");
    expect(await expectPosix("Arrow")).toBe("src/Arrow.tsx");
    expect(await expectPosix("Class")).toBe("src/Class.tsx");
    expect(await expectPosix("Var")).toBe("src/Var.tsx");
  });

  it("returns nothing for empty or non-identifier names", async () => {
    const root = makeProject({ "src/A.tsx": "const A = 1;\n" });
    expect(await findComponentDefinition(root, "")).toBeUndefined();
    expect(await findComponentDefinition(root, "not an identifier")).toBeUndefined();
  });

  it("honours the shared read budget", async () => {
    const root = makeProject({ "src/Late.tsx": "export function Late() {}\n" });
    expect(await findComponentDefinition(root, "Late", { maxTotalBytes: 0 })).toBeUndefined();
    expect(await findComponentDefinition(root, "Late")).toBeDefined();
  });

  it("prefers non-test definitions over *.test.* / *.spec.* / *.stories.* / __tests__ / __mocks__", async () => {
    const root = makeProject({
      "src/__tests__/Widget.test.tsx": "export function Widget() {}\n",
      "src/Widget.spec.tsx": "export function Widget() {}\n",
      "src/Widget.stories.tsx": "export function Widget() {}\n",
      "src/__mocks__/Widget.tsx": "export function Widget() {}\n",
      "src/components/Widget.tsx": "export function Widget() {\n  return null;\n}\n",
    });
    const found = await findComponentDefinition(root, "Widget");
    expect(found?.file.replace(/\\/g, "/")).toBe("src/components/Widget.tsx");
    expect(found?.line).toBe(1);
  });

  it("falls back to a test-file definition when it is the only one", async () => {
    const root = makeProject({ "src/Only.test.tsx": "export function Only() {}\n" });
    const found = await findComponentDefinition(root, "Only");
    expect(found?.file.replace(/\\/g, "/")).toBe("src/Only.test.tsx");
  });

  it("caches scans per root+name and rescans after the TTL", async () => {
    const root = makeProject({ "src/Cached.tsx": "export function Cached() {}\n" });
    const readdirSpy = vi.spyOn(fs.promises, "readdir");
    try {
      const first = await findComponentDefinition(root, "Cached");
      expect(first?.file.replace(/\\/g, "/")).toBe("src/Cached.tsx");
      const callsAfterFirst = readdirSpy.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0);
      const second = await findComponentDefinition(root, "Cached");
      expect(second).toEqual(first);
      expect(readdirSpy.mock.calls.length).toBe(callsAfterFirst);
      // Negative results are cached too.
      expect(await findComponentDefinition(root, "Absent")).toBeUndefined();
      const callsAfterMiss = readdirSpy.mock.calls.length;
      expect(await findComponentDefinition(root, "Absent")).toBeUndefined();
      expect(readdirSpy.mock.calls.length).toBe(callsAfterMiss);
      // Past the TTL the workspace is scanned again.
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
      try {
        await findComponentDefinition(root, "Cached");
        expect(readdirSpy.mock.calls.length).toBeGreaterThan(callsAfterMiss);
      } finally {
        nowSpy.mockRestore();
      }
    } finally {
      readdirSpy.mockRestore();
    }
  });
});
