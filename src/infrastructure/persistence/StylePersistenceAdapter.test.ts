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
        isDirty: uri.fsPath.includes("dirty"),
        save: async () => {
          (globalThis as any).__saved.push(uri.fsPath);
          return true;
        },
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

  it("P2-21: matches legacy single-colon pseudo-elements against double-colon rules", () => {
    const authored = ".card:before { color: red; }";
    expect(findCssRules(authored, ".card::before").length).toBe(1);
    const modern = ".card::before { color: red; }";
    expect(findCssRules(modern, ".card:before").length).toBe(1);
  });

  it("P2-21: tolerates whitespace differences in selector comparison", () => {
    const text = ".a,\n  .b { color: red; }";
    expect(findCssRules(text, [".a", ".b"]).length).toBe(1);
    expect(findCssRules(text, [".a ,.b"]).length).toBe(1);
  });
});

describe("StylePersistenceAdapter.apply", () => {
  beforeEach(() => {
    store.clear();
    (globalThis as any).__replacements = [];
    (globalThis as any).__saved = [];
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

  it("P2-7: does not edit a declaration inside a nested rule", async () => {
    store.set("/tmp/nest.css", ".card {\n  &:hover {\n    color: blue;\n  }\n  color: red;\n}");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".card", property: "color", value: "green" });
    expect(res.success).toBe(true);
    const newText = (globalThis as any).__replacements[0].newText as string;
    expect(newText).toContain("&:hover {\n    color: blue;\n  }");
    expect(newText).toContain("color: green;");
    expect(newText).not.toContain("color: red;");
  });

  it("P2-7: ignores property mentions inside comments", async () => {
    store.set("/tmp/com.css", ".card { /* ; color: red; */ padding: 4px; }");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".card", property: "color", value: "green" });
    expect(res.success).toBe(true);
    const newText = (globalThis as any).__replacements[0].newText as string;
    expect(newText).toContain("/* ; color: red; */ padding: 4px; color: green;");
    expect(newText).not.toContain("color: green; */");
  });

  it("P2-7: does not save a dirty document (user keeps their unsaved changes)", async () => {
    store.set("/tmp/dirty.css", ".a { color: red; }");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".a", property: "color", value: "green" });
    expect(res.success).toBe(true);
    expect((globalThis as any).__saved).not.toContain("/tmp/dirty.css");
  });

  it("P2-7: saves a clean document", async () => {
    store.set("/tmp/clean.css", ".a { color: red; }");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".a", property: "color", value: "green" });
    expect(res.success).toBe(true);
    expect((globalThis as any).__saved).toContain("/tmp/clean.css");
  });
});
