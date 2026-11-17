import { describe, it, expect } from "vitest";
import { collectReactComponents, parseOwnerStack } from "./fiber";

function fiberEl(fiber: unknown): Element {
  const el = {};
  Object.defineProperty(el, "__reactFiber$testkey", { value: fiber, enumerable: true });
  return el as unknown as Element;
}

describe("parseOwnerStack", () => {
  it("extracts workspace frames from a webpack-internal stack", () => {
    const stack = [
      "Error: boom",
      "  at EmailField (webpack-internal:///./src/components/LoginForm.tsx:42:15)",
      "  at renderWithHooks (webpack-internal:///./node_modules/react-dom/cjs/react-dom.development.js:15486:18)",
    ].join("\n");
    expect(parseOwnerStack(stack)).toEqual([{ file: "./src/components/LoginForm.tsx", line: 42 }]);
  });

  it("skips chunk and node_modules frames, keeps usable ones", () => {
    const stack = [
      "  at LoginForm (http://localhost:3000/_next/static/chunks/main-app.js:4621:88)",
      "  at Header (/(app-pages-browser)/./app/components/Header.tsx:10:5)",
    ].join("\n");
    expect(parseOwnerStack(stack)).toEqual([{ file: "./app/components/Header.tsx", line: 10 }]);
  });

  it("returns empty for non-string input and stacks without source frames", () => {
    expect(parseOwnerStack(undefined)).toEqual([]);
    expect(parseOwnerStack("at Object.<anonymous>")).toEqual([]);
  });
});

describe("collectReactComponents", () => {
  it("returns empty when the element has no React fiber", () => {
    expect(collectReactComponents({} as unknown as Element)).toEqual([]);
  });

  it("returns empty for a malformed fiber", () => {
    expect(collectReactComponents(fiberEl("not-a-fiber"))).toEqual([]);
  });

  it("walks the _debugOwner chain and uses the element's own _debugSource for the first entry", () => {
    const pageFiber = { type: { displayName: "LoginPage" }, return: null };
    const formFiber = {
      type: function LoginForm() {},
      _debugSource: { fileName: "webpack-internal:///./src/components/LoginForm.tsx", lineNumber: 8 },
      _debugOwner: pageFiber,
    };
    const elFiber = {
      type: "div",
      _debugSource: { fileName: "./src/components/LoginForm.tsx", lineNumber: 42 },
      _debugOwner: formFiber,
    };
    const comps = collectReactComponents(fiberEl(elFiber));
    expect(comps).toEqual([
      { name: "LoginForm", file: "./src/components/LoginForm.tsx", line: 42 },
      { name: "LoginPage" },
    ]);
  });

  it("reads through memo/forwardRef wrappers", () => {
    const inner = function EmailInput() {};
    const owner = { type: { $$typeof: Symbol.for("react.memo"), type: inner }, _debugOwner: null };
    const comps = collectReactComponents(fiberEl({ type: "div", _debugOwner: owner }));
    expect(comps).toEqual([{ name: "EmailInput" }]);
  });

  it("falls back to _debugStack when _debugSource is absent (React 19)", () => {
    const owner = {
      type: function EmailField() {},
      _debugStack: "Error\n  at EmailField (webpack-internal:///./src/ui/EmailField.tsx:12:3)",
      _debugOwner: null,
    };
    const comps = collectReactComponents(fiberEl({ type: "div", _debugOwner: owner }));
    expect(comps).toEqual([{ name: "EmailField", file: "./src/ui/EmailField.tsx", line: 12 }]);
  });

  it("walks fiber.return when _debugOwner is absent (React 19 owner-less fibers)", () => {
    const comps = collectReactComponents(
      fiberEl({
        type: "div",
        return: {
          type: function EmailField() {},
          return: {
            type: "form",
            return: { type: function LoginForm() {}, return: { type: null, return: null } },
          },
        },
      })
    );
    expect(comps).toEqual([{ name: "EmailField" }, { name: "LoginForm" }]);
  });

  it("skips host fibers and stops at the root in return-chain mode; names win over empty receivers", () => {
    const comps = collectReactComponents(
      fiberEl({
        type: "input",
        return: {
          type: "label",
          return: { type: Symbol.for("react.fragment"), return: { type: function Field() {}, return: { type: null } } },
        },
      })
    );
    expect(comps).toEqual([{ name: "Field" }]);
  });

  it("never throws and stops after the guard", () => {
    const a: Record<string, unknown> = { type: "div" };
    const b: Record<string, unknown> = { type: "div" };
    a._debugOwner = b;
    b._debugOwner = a;
    expect(collectReactComponents(fiberEl(a))).toEqual([]);
  });

  it("keeps same-named components from different files, dedups identical name+file", () => {
    const cardA = { type: function Card() {}, _debugSource: { fileName: "./src/a/Card.tsx", lineNumber: 1 }, _debugOwner: null };
    const cardB = { type: function Card() {}, _debugSource: { fileName: "./src/b/Card.tsx", lineNumber: 2 }, _debugOwner: cardA };
    expect(collectReactComponents(fiberEl({ type: "div", _debugOwner: cardB }))).toEqual([
      { name: "Card", file: "./src/b/Card.tsx", line: 2 },
      { name: "Card", file: "./src/a/Card.tsx", line: 1 },
    ]);
    const sameA = { type: function Card() {}, _debugSource: { fileName: "./src/Card.tsx", lineNumber: 1 }, _debugOwner: null };
    const sameB = { type: function Card() {}, _debugSource: { fileName: "./src/Card.tsx", lineNumber: 1 }, _debugOwner: sameA };
    expect(collectReactComponents(fiberEl({ type: "div", _debugOwner: sameB }))).toEqual([
      { name: "Card", file: "./src/Card.tsx", line: 1 },
    ]);
  });

  it("reads at most one _debugStack per element (React 19 lazy formatting is expensive)", () => {
    let reads = 0;
    const ownerA = {
      type: function A() {},
      _debugOwner: null,
      get _debugStack() {
        reads++;
        return "Error\n  at A (webpack-internal:///./src/A.tsx:1:2)";
      },
    };
    const ownerB = {
      type: function B() {},
      _debugOwner: ownerA,
      get _debugStack() {
        reads++;
        return "Error\n  at B (webpack-internal:///./src/B.tsx:3:4)";
      },
    };
    const comps = collectReactComponents(fiberEl({ type: "div", _debugOwner: ownerB }));
    expect(reads).toBe(1);
    expect(comps).toEqual([{ name: "B", file: "./src/B.tsx", line: 3 }, { name: "A" }]);
  });

  it("survives a throwing _debugStack getter", () => {
    const owner = {
      type: function A() {},
      _debugOwner: null,
      get _debugStack(): unknown {
        throw new Error("lazy stack formatting failed");
      },
    };
    expect(collectReactComponents(fiberEl({ type: "div", _debugOwner: owner }))).toEqual([{ name: "A" }]);
  });
});
