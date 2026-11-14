import { describe, it, expect } from "vitest";
import { isRuntimeMessage, PROTOCOL_VERSION } from "./protocol";

describe("isRuntimeMessage", () => {
  it("accepts valid runtime-ready", () => {
    expect(isRuntimeMessage({ type: "ds:runtime-ready", version: PROTOCOL_VERSION })).toBe(true);
  });
  it("accepts ping and pong", () => {
    expect(isRuntimeMessage({ type: "ds:ping", version: PROTOCOL_VERSION, nonce: "abc" })).toBe(true);
    expect(isRuntimeMessage({ type: "ds:pong", version: PROTOCOL_VERSION, nonce: "abc" })).toBe(true);
  });
  it("rejects wrong version", () => {
    expect(isRuntimeMessage({ type: "ds:runtime-ready", version: "2" })).toBe(false);
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
});
