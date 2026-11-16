import { describe, it, expect } from "vitest";
import { isRuntimeMessage, isValidClassListValue, PROTOCOL_VERSION } from "./protocol";

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
