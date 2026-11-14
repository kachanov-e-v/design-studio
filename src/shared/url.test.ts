import { describe, it, expect } from "vitest";
import { isAllowedUrl } from "./url";

describe("isAllowedUrl", () => {
  it("accepts http/https", () => {
    expect(isAllowedUrl("http://localhost:5173")).toBe(true);
    expect(isAllowedUrl("https://example.com")).toBe(true);
  });
  it("rejects other schemes", () => {
    expect(isAllowedUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedUrl("not a url")).toBe(false);
  });
});