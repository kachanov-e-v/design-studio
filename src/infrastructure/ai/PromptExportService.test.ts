import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const mocks = vi.hoisted(() => ({
  writeText: vi.fn(async () => {}),
  findDefinition: vi.fn(),
}));

vi.mock("vscode", () => ({
  env: { clipboard: { writeText: mocks.writeText } },
}));

vi.mock("../source-analysis/ComponentResolver", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../source-analysis/ComponentResolver")>();
  mocks.findDefinition.mockImplementation(actual.findComponentDefinition);
  return { ...actual, findComponentDefinition: mocks.findDefinition };
});

import { PromptExportService } from "./PromptExportService";

const tempDirs: string[] = [];

function makeProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-prompt-"));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

beforeEach(() => {
  mocks.writeText.mockClear();
  mocks.findDefinition.mockClear();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function lastPrompt(): string {
  return (mocks.writeText.mock.calls as unknown as [string][])[0][0];
}

describe("PromptExportService.copyComponent definition fallback", () => {
  it("uses the found definition's line for name-only components, not the fiber line", async () => {
    const root = makeProject({ "src/Board.tsx": "export function Board() {\n  return null;\n}\n" });
    const service = new PromptExportService(root);
    const res = await service.copyComponent({ name: "Board", line: 42 }, "en");
    expect(res.success).toBe(true);
    expect(lastPrompt()).toContain("src/Board.tsx:1");
    expect(lastPrompt()).not.toContain(":42");
  });

  it("reuses a single definition scan when the bundler file is unresolvable (FIX-07)", async () => {
    const root = makeProject({ "src/Board.tsx": "export function Board() {}\n" });
    const service = new PromptExportService(root);
    const res = await service.copyComponent(
      { name: "Board", file: "webpack-internal:///./chunks/missing.js", line: 999 },
      "en"
    );
    expect(res.success).toBe(true);
    expect(mocks.findDefinition).toHaveBeenCalledTimes(1);
    expect(lastPrompt()).toContain("src/Board.tsx:1");
    expect(lastPrompt()).not.toContain(":999");
  });

  it("keeps the fiber line when the component file resolves directly", async () => {
    const root = makeProject({ "src/Board.tsx": "export function Board() {}\n" });
    const service = new PromptExportService(root);
    const res = await service.copyComponent({ name: "Board", file: "src/Board.tsx", line: 7 }, "en");
    expect(res.success).toBe(true);
    expect(mocks.findDefinition).not.toHaveBeenCalled();
    expect(lastPrompt()).toContain("src/Board.tsx:7");
  });
});