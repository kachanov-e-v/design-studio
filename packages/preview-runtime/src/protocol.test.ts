import { describe, it, expect } from "vitest";
import { isRuntimeMessage, PROTOCOL_VERSION } from "./protocol";

describe("isRuntimeMessage", () => {
  it("accepts valid runtime-ready", () => {
    expect(isRuntimeMessage({ type: "ds:runtime-ready", version: PROTOCOL_VERSION })).toBe(true);
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
});
