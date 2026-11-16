/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const store = new Map<string, string>();

vi.mock("vscode", () => {
  class Range {
    constructor(public start: any, public end: any) {}
  }
  class Position {
    constructor(public line: number, public character: number) {}
  }
  const workspace = {
    findFiles: async () => Array.from(store.keys()).map((p) => ({ fsPath: p, toString: () => p })),
    openTextDocument: async (uri: any) => {
      const text = store.get(uri.fsPath) ?? "";
      return {
        getText: () => text,
        positionAt: (offset: number) => new Position(0, offset),
        save: async () => true,
      };
    },
    applyEdit: async (edit: any) => {
      // edit is WorkspaceEdit; we capture via global
      (globalThis as any).__lastEdit = edit;
      return true;
    },
  };
  class WorkspaceEdit {
    replacements: any[] = [];
    replace(uri: any, range: any, newText: string) {
      this.replacements.push({ uri, range, newText });
      // apply immediately to store for test visibility
      // replace whole doc body region not trivial; store full new text by reconstructing from replacements is complex.
      // Instead, we store a marker by recomputing in test separately; here just record.
      (globalThis as any).__replacements = this.replacements;
    }
  }
  return {
    workspace,
    WorkspaceEdit,
    Range,
    Uri: { file: (p: string) => ({ fsPath: p }) },
  };
});

import { StylePersistenceAdapter, findCssRules, isValidCssProperty, isValidCssValue } from "./StylePersistenceAdapter";

describe("persistence utils", () => {
  it("validates property", () => {
    expect(isValidCssProperty("color")).toBe(true);
    expect(isValidCssProperty("font-size")).toBe(true);
    expect(isValidCssProperty("bad value")).toBe(false);
    expect(isValidCssProperty("")).toBe(false);
  });
  it("validates value", () => {
    expect(isValidCssValue("#f00")).toBe(true);
    expect(isValidCssValue("")).toBe(true);
    expect(isValidCssValue("a;b")).toBe(false);
    expect(isValidCssValue("a}b")).toBe(false);
  });
  it("finds rules", () => {
    const text = ".a { color: red; } .b { color: blue; }";
    const rules = findCssRules(text, ".a");
    expect(rules.length).toBe(1);
  });
  it("detects ambiguous", () => {
    const text = ".a { color: red; } .a { color: blue; }";
    const rules = findCssRules(text, ".a");
    expect(rules.length).toBe(2);
  });
});

describe("StylePersistenceAdapter.apply", () => {
  beforeEach(() => {
    store.clear();
    (globalThis as any).__replacements = [];
  });

  it("returns no match for missing rule", async () => {
    store.set("/tmp/a.css", ".x { color: red; }");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".missing", property: "color", value: "blue" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("No matching");
  });

  it("rejects invalid property", async () => {
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".a", property: "bad value", value: "blue" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("Invalid CSS property");
  });

  it("rejects ambiguous match", async () => {
    store.set("/tmp/a.css", ".a { color: red; } .a { color: blue; }");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".a", property: "color", value: "green" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("Ambiguous");
  });

  it("A10: preserves !important when replacing the value", async () => {
    store.set("/tmp/a.css", ".a {\n  color: red !important;\n  margin: 0;\n}");
    const adapter = new StylePersistenceAdapter();
    await adapter.apply({ selector: ".a", property: "color", value: "blue" });
    const newText = (globalThis as any).__replacements[0].newText as string;
    expect(newText).toContain("color: blue !important;");
  });

  it("A10: does not duplicate !important when the new value has one", async () => {
    store.set("/tmp/a.css", ".a { color: red !important; }");
    const adapter = new StylePersistenceAdapter();
    await adapter.apply({ selector: ".a", property: "color", value: "blue !important" });
    const newText = (globalThis as any).__replacements[0].newText as string;
    expect(newText.match(/!important/g)?.length).toBe(1);
  });

  it("A10: keeps url(data:...;base64,...) values intact when editing another property", async () => {
    store.set("/tmp/a.css", ".a {\n  background: url(data:image/svg+xml;base64,AAAA+BB==) no-repeat;\n  color: red;\n}");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".a", property: "color", value: "blue" });
    expect(res.success).toBe(true);
    const newText = (globalThis as any).__replacements[0].newText as string;
    expect(newText).toContain("base64,AAAA+BB==");
    expect(newText).toContain("color: blue;");
  });
});







