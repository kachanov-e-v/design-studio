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

  it("never throws and stops after the guard", () => {
    const a: Record<string, unknown> = { type: "div" };
    const b: Record<string, unknown> = { type: "div" };
    a._debugOwner = b;
    b._debugOwner = a;
    expect(collectReactComponents(fiberEl(a))).toEqual([]);
  });
});
