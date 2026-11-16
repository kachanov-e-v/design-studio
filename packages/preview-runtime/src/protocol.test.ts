import { describe, it, expect } from "vitest";
import { isRuntimeMessage, isElementPayload, isValidClassListValue, PROTOCOL_VERSION } from "./protocol";

describe("isRuntimeMessage", () => {
  it("accepts valid runtime-ready", () => {
    expect(isRuntimeMessage({ type: "ds:runtime-ready", version: PROTOCOL_VERSION })).toBe(true);
  });
  it("accepts ping and pong", () => {
    expect(isRuntimeMessage({ type: "ds:ping", version: PROTOCOL_VERSION, nonce: "abc" })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:pong", version: PROTOCOL_VERSION, nonce: "abc" })).toBe(true);
  });
  it("rejects wrong version", () => {
    expect(isRuntimeMessage({ type: "ds:runtime-ready", version: "3" })).toBe(false);
  });
  it("rejects malformed", () => {
    expect(isRuntimeMessage(null)).toBe(false);
    expect(isRuntimeMessage({ type: "ds:hover", version: PROTOCOL_VERSION })).toBe(false);
    expect(isRuntimeMessage({ type: "foo", version: PROTOCOL_VERSION })).toBe(false);
  });
  it("validates apply-style payload", () => {
    expect(isRuntimeMessage({ type: "ds:apply-style", version: PROTOCOL_VERSION, property: "color", value: "red" })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:apply-style", version: PROTOCOL_VERSION, property: "color" })).toBe(false);
  });
  it("rejects invalid element payload", () => {
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { selector: "x", tag: "div", rect: { top: NaN, left: 0, width: 1, height: 1 }, styles: {} } })).toBe(false);
  });
  it("accepts element payload with optional text", () => {
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { selector: "h1", tag: "h1", rect: { top: 0, left: 0, width: 1, height: 1 }, styles: {}, text: "Hello" } })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { selector: "h1", tag: "h1", rect: { top: 0, left: 0, width: 1, height: 1 }, styles: {}, text: 123 } })).toBe(false);
  });
  it("validates apply-op messages", () => {
    expect(isRuntimeMessage({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "delete" })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "set-text", value: "New" })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "explode" })).toBe(false);
    expect(isRuntimeMessage({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "duplicate", value: null })).toBe(false);
  });
  it("validates navigate-blocked messages", () => {
    expect(isRuntimeMessage({ type: "ds:navigate-blocked", version: PROTOCOL_VERSION, url: "https://example.com/page" })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:navigate-blocked", version: PROTOCOL_VERSION, url: "https://example.com/p?q=1#h", sessionId: "abc" })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:navigate-blocked", version: PROTOCOL_VERSION })).toBe(false);
    expect(isRuntimeMessage({ type: "ds:navigate-blocked", version: PROTOCOL_VERSION, url: "" })).toBe(false);
    expect(isRuntimeMessage({ type: "ds:navigate-blocked", version: PROTOCOL_VERSION, url: "x".repeat(2049) })).toBe(false);
  });
  it("validates op-applied messages", () => {
    expect(isRuntimeMessage({ type: "ds:op-applied", version: PROTOCOL_VERSION, op: "duplicate", success: true, payload: null })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:op-applied", version: PROTOCOL_VERSION, op: "move-up", success: false, reason: "No previous sibling" })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:op-applied", version: PROTOCOL_VERSION, op: "move-up" })).toBe(false);
  });
  it("validates set-attribute messages", () => {
    const base = { type: "ds:apply-op" as const, version: PROTOCOL_VERSION };
    expect(isRuntimeMessage({ ...base, op: "set-attribute", attribute: "alt", value: "Logo" })).toBe(true);
    expect(isRuntimeMessage({ ...base, op: "set-attribute", attribute: "aria-label", value: "" })).toBe(true);
    expect(isRuntimeMessage({ ...base, op: "set-attribute", attribute: "required", value: "true" })).toBe(true);
    expect(isRuntimeMessage({ ...base, op: "set-attribute", attribute: "checked", value: "" })).toBe(true);
    expect(isRuntimeMessage({ ...base, op: "set-attribute", attribute: "href", value: "x".repeat(2001) })).toBe(false);
    expect(isRuntimeMessage({ ...base, op: "set-attribute", attribute: "onclick", value: "x()" })).toBe(false);
    expect(isRuntimeMessage({ ...base, op: "set-attribute" })).toBe(false);
    expect(isRuntimeMessage({ ...base, op: "set-attribute", value: "Logo" })).toBe(false);
    expect(isRuntimeMessage({ ...base, op: "delete", attribute: "href" })).toBe(false);
    expect(isRuntimeMessage({ type: "ds:op-applied", version: PROTOCOL_VERSION, op: "set-attribute", attribute: "title", value: "Tip", success: true, payload: null })).toBe(true);
  });
  it("validates element payload classes and tailwind flag", () => {
    const base = { selector: "h1", tag: "h1", rect: { top: 0, left: 0, width: 1, height: 1 }, styles: {} };
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, classes: ["p-4", "bg-white"], tailwind: true } })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, classes: [] } })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, classes: ["bad class"] } })).toBe(false);
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, tailwind: "yes" } })).toBe(false);
  });
  it("validates element payload attributes", () => {
    const base = { selector: "h1", tag: "h1", rect: { top: 0, left: 0, width: 1, height: 1 }, styles: {} };
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, attributes: { placeholder: "Email", href: "https://example.com" } } })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, attributes: { href: "x".repeat(2001) } } })).toBe(false);
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, attributes: { onclick: "x()" } } })).toBe(false);
  });
  it("validates set-classes op values", () => {
    expect(isRuntimeMessage({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "set-classes", value: "p-4 bg-white" })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:apply-op", version: PROTOCOL_VERSION, op: "set-classes" })).toBe(true);
    expect(isValidClassListValue("p-4 bg-white")).toBe(true);
    expect(isValidClassListValue("")).toBe(true);
    expect(isValidClassListValue("a b<c")).toBe(false);
    expect(isValidClassListValue(Array(31).fill("x").join(" "))).toBe(false);
  });
  it("validates element payload component chain", () => {
    const base = { selector: "h1", tag: "h1", rect: { top: 0, left: 0, width: 1, height: 1 }, styles: {} };
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, component: [{ name: "LoginForm", file: "./src/LoginForm.tsx", line: 42 }, { name: "LoginPage" }] } })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, component: [{ file: "./src/LoginForm.tsx" }] } })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, component: [{}] } })).toBe(false);
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, component: [{ name: "LoginForm" }, {}] } })).toBe(false);
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, component: [{ name: "LoginForm", line: -1 }] } })).toBe(false);
    expect(isRuntimeMessage({ type: "ds:select", version: PROTOCOL_VERSION, payload: { ...base, component: Array(7).fill({ name: "X" }) } })).toBe(false);
  });
});

describe("ds:rect validation (P2-6)", () => {
  it("accepts a finite rect", () => {
    expect(isRuntimeMessage({ type: "ds:rect", version: PROTOCOL_VERSION, rect: { top: 1, left: 2, width: 3, height: 4 } })).toBe(true);
  });

  it("rejects missing or non-finite rect", () => {
    expect(isRuntimeMessage({ type: "ds:rect", version: PROTOCOL_VERSION })).toBe(false);
    expect(isRuntimeMessage({ type: "ds:rect", version: PROTOCOL_VERSION, rect: { top: NaN, left: 2, width: 3, height: 4 } })).toBe(false);
    expect(isRuntimeMessage({ type: "ds:rect", version: PROTOCOL_VERSION, rect: { top: 1, left: 2, width: 3 } })).toBe(false);
  });
});

describe("message validator edge cases (P3-6 coverage)", () => {
  const base = { version: PROTOCOL_VERSION } as Record<string, unknown>;
  const longSession = "s".repeat(129);

  it("set-mode / mode-changed require a boolean enabled and reject bad sessionId", () => {
    expect(isRuntimeMessage({ ...base, type: "ds:set-mode", enabled: true })).toBe(true);
    expect(isRuntimeMessage({ ...base, type: "ds:set-mode", enabled: "yes" })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:mode-changed", enabled: false, sessionId: longSession })).toBe(false);
  });

  it("runtime-ready / runtime-error session and message bounds", () => {
    expect(isRuntimeMessage({ ...base, type: "ds:runtime-ready", sessionId: longSession })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:runtime-error", message: "boom" })).toBe(true);
    expect(isRuntimeMessage({ ...base, type: "ds:runtime-error" })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:runtime-error", message: "x".repeat(501) })).toBe(false);
  });

  it("ping / pong bound nonce and sessionId lengths", () => {
    expect(isRuntimeMessage({ ...base, type: "ds:ping", nonce: "" })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:ping", nonce: "n".repeat(129) })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:ping", nonce: "n", sessionId: longSession })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:pong", nonce: "n", sessionId: 42 })).toBe(false);
  });

  it("style-applied validates property/value/success/reason/payload", () => {
    expect(isRuntimeMessage({ ...base, type: "ds:style-applied", property: "color", value: "red", success: true })).toBe(true);
    expect(isRuntimeMessage({ ...base, type: "ds:style-applied", property: 1, value: "red", success: true })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:style-applied", property: "color", value: "red", success: "yes" })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:style-applied", property: "color", value: "red", success: true, reason: "x".repeat(501) })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:style-applied", property: "color", value: "red", success: true, requestId: longSession })).toBe(false);
  });

  it("apply-style rejects bad selectors", () => {
    expect(isRuntimeMessage({ ...base, type: "ds:apply-style", property: "color", value: "red", selectors: [".a"] })).toBe(true);
    expect(isRuntimeMessage({ ...base, type: "ds:apply-style", property: "color", value: "red", selectors: [".a", ""] })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:apply-style", property: "color", value: "red", selectors: Array(21).fill(".a") })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:apply-style", property: "color", value: "red", requestId: "" })).toBe(false);
  });

  it("apply-op validates selectors and attribute pairing in both directions", () => {
    expect(isRuntimeMessage({ ...base, type: "ds:apply-op", op: "set-attribute", attribute: "href", value: "/x" })).toBe(true);
    expect(isRuntimeMessage({ ...base, type: "ds:apply-op", op: "set-attribute", value: "/x" })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:apply-op", op: "set-text", value: "t", attribute: "href" })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:apply-op", op: "delete", selectors: [".a"] })).toBe(true);
    expect(isRuntimeMessage({ ...base, type: "ds:apply-op", op: "delete", value: "x".repeat(5001) })).toBe(false);
  });

  it("op-applied validates op/success/payload", () => {
    expect(isRuntimeMessage({ ...base, type: "ds:op-applied", op: "duplicate", success: true, payload: null })).toBe(true);
    expect(isRuntimeMessage({ ...base, type: "ds:op-applied", op: "explode", success: true })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:op-applied", op: "delete", success: true, payload: { nope: true } })).toBe(false);
  });

  it("navigate / navigate-history / reload bounds", () => {
    expect(isRuntimeMessage({ ...base, type: "ds:navigate", path: "/page" })).toBe(true);
    expect(isRuntimeMessage({ ...base, type: "ds:navigate", path: "http://x/y" })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:navigate", path: `/${"x".repeat(4000)}` })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:navigate-history", direction: "back" })).toBe(true);
    expect(isRuntimeMessage({ ...base, type: "ds:navigate-history", direction: "sideways" })).toBe(false);
    expect(isRuntimeMessage({ ...base, type: "ds:reload", sessionId: "s" })).toBe(true);
  });
});

describe("isElementPayload edge cases (P3-6 coverage)", () => {
  const validPayload = {
    selector: "h1",
    tag: "h1",
    rect: { top: 0, left: 0, width: 1, height: 1 },
    styles: { color: "red" },
  };
  const payload = (extra: Record<string, unknown>) => ({ ...validPayload, ...extra });
  const elementPayload = (v: unknown) => (isElementPayload as unknown as (x: unknown) => boolean)(v);

  it("rejects structurally broken payloads", () => {
    expect(elementPayload(null)).toBe(false);
    expect(elementPayload([validPayload])).toBe(false);
    expect(elementPayload({ ...validPayload, selector: "" })).toBe(false);
    expect(elementPayload({ ...validPayload, tag: "x".repeat(65) })).toBe(false);
    expect(elementPayload({ ...validPayload, rect: { ...validPayload.rect, width: -1 } })).toBe(false);
    expect(elementPayload({ ...validPayload, styles: { color: 5 } })).toBe(false);
  });

  it("bounds selectors, text and classes", () => {
    expect(elementPayload(payload({ selectors: [".a", ".b"] }))).toBe(true);
    expect(elementPayload(payload({ selectors: [".a", ""] }))).toBe(false);
    expect(elementPayload(payload({ text: "x".repeat(2001) }))).toBe(false);
    expect(elementPayload(payload({ classes: ["a", "b c"] }))).toBe(false);
    expect(elementPayload(payload({ classes: ["a"] }))).toBe(true);
  });

  it("bounds attributes against EDITABLE_ATTRIBUTES", () => {
    expect(elementPayload(payload({ attributes: { href: "/x" } }))).toBe(true);
    expect(elementPayload(payload({ attributes: { script: "/x" } }))).toBe(false);
  });

  it("bounds tailwind flag and component chain entries", () => {
    expect(elementPayload(payload({ tailwind: true }))).toBe(true);
    expect(elementPayload(payload({ tailwind: "yes" }))).toBe(false);
    expect(elementPayload(payload({ component: [{ name: "A" }] }))).toBe(true);
    expect(elementPayload(payload({ component: [{ name: "" }] }))).toBe(false);
    expect(elementPayload(payload({ component: [{ file: "" }] }))).toBe(false);
    expect(elementPayload(payload({ component: [{ name: "A", line: -1 }] }))).toBe(false);
    expect(elementPayload(payload({ component: [{}] }))).toBe(false);
  });

  it("bounds sourceRules entries", () => {
    expect(elementPayload(payload({ rules: [{ href: "/a.css", selectorText: ".a" }] }))).toBe(true);
    expect(elementPayload(payload({ rules: [{ selectorText: ".a" }] }))).toBe(false);
    expect(elementPayload(payload({ rules: [{ href: "/a.css", selectorText: "" }] }))).toBe(false);
    expect(elementPayload(payload({ rules: [{ href: "/a.css", selectorText: ".a", cssText: "x".repeat(3001) }] }))).toBe(false);
  });
});
