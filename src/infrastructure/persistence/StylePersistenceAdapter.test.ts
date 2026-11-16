/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import http from "node:http";

const store = new Map<string, string>();

vi.mock("vscode", () => {
  class Range {
    constructor(public start: any, public end: any) {}
  }
  class Position {
    constructor(public line: number, public character: number) {}
  }
  const workspace = {
    findFiles: async (pattern: string, _exclude: unknown, limit?: number) => {
      let keys = Array.from(store.keys());
      const exact = /^\*\*\/([\w.-]+)$/.exec(pattern);
      if (exact) keys = keys.filter((p) => p === exact[1] || p.endsWith(`/${exact[1]}`));
      return keys.slice(0, typeof limit === "number" ? limit : undefined).map((p) => ({ fsPath: p, toString: () => p }));
    },
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

  it("rejects invalid CSS value", async () => {
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".a", property: "color", value: "red;;<" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("Invalid CSS value");
  });

  it("uses the selectors array (not just the primary selector) to find the rule", async () => {
    store.set("/tmp/sel.css", ".card { color: red; }");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".unknown", selectors: [".unknown", ".card"], property: "color", value: "blue" });
    expect(res.success).toBe(true);
    expect((globalThis as any).__replacements[0].newText).toContain("color: blue;");
  });

  it("reports a truncated CSS file search instead of a confident 'no match'", async () => {
    for (let i = 0; i < 200; i++) store.set(`/tmp/dir${i}/filler.css`, `.filler${i} { width: ${i}px; }`);
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".nothing-here", property: "color", value: "blue" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("truncated");
  });

  it("removes a declaration when the new value is empty", async () => {
    store.set("/tmp/rem.css", ".a {\n  color: red;\n  margin: 0\n}\n");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".a", property: "color", value: "" });
    expect(res.success).toBe(true);
    const newText = (globalThis as any).__replacements[0].newText as string;
    expect(newText).not.toContain("color");
    expect(newText).toContain("margin: 0");
  });

  it("reports 'already absent' when removing a property that is not set", async () => {
    store.set("/tmp/abs.css", ".a { margin: 0; }");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".a", property: "color", value: "" });
    expect(res.success).toBe(true);
    expect(res.message).toContain("already absent");
  });

  it("rejects the edit when the property already has the requested value", async () => {
    store.set("/tmp/same.css", ".a { color: red; }");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({ selector: ".a", property: "color", value: "red" });
    expect(res.success).toBe(false);
    expect(res.message).toContain("already has this value");
  });
});

/**
 * Source mapping (applyViaSourceMapping): a hashed CSS Modules selector from a
 * dev server resolves to its source file via the compiled sheet served on the
 * preview host (real loopback HTTP: the resolver's fetch seam uses global fetch).
 */
describe("StylePersistenceAdapter source mapping", () => {
  const sheetServer = http.createServer((req, res) => {
    res.setHeader("content-type", "text/css");
    res.end(".Home_title__Xk3m { color: red; }\n");
  });
  let sheetPort = 0;
  beforeAll(async () => {
    await new Promise<void>((r) => sheetServer.listen(0, "127.0.0.1", r));
    sheetPort = (sheetServer.address() as { port: number }).port;
  });
  afterAll(() => new Promise<void>((r) => sheetServer.close(() => r())));

  it("maps a hashed CSS Modules selector to its source file (heuristic)", async () => {
    store.set("src/pages/Home.module.css", ".title { color: red; }");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({
      selector: ".Home_title__Xk3m",
      property: "color",
      value: "blue",
      sourceRules: [{ href: `http://127.0.0.1:${sheetPort}/sheets/home.css`, selectorText: ".Home_title__Xk3m" }],
    });
    expect(res.success).toBe(true);
    expect(res.file).toContain("Home.module.css");
    expect(res.message).toContain("via heuristic");
    expect((globalThis as any).__replacements[0].newText).toContain("color: blue;");
  });

  it("reports source-path ambiguity instead of editing the first hit", async () => {
    store.set("src/a/Home.module.css", ".title { color: red; }");
    store.set("src/b/Home.module.css", ".title { color: red; }");
    const adapter = new StylePersistenceAdapter();
    const res = await adapter.apply({
      selector: ".Home_title__Xk3m",
      property: "color",
      value: "blue",
      sourceRules: [{ href: `http://127.0.0.1:${sheetPort}/sheets/home.css`, selectorText: ".Home_title__Xk3m" }],
    });
    expect(res.success).toBe(false);
    expect(res.message).toContain("several paths");
  });
});
