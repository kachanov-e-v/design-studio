import { describe, it, expect } from "vitest";
import { isAllowedUrl, isLocalhostUrl } from "./url";

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

describe("isLocalhostUrl", () => {
  it("accepts localhost dev servers", () => {
    expect(isLocalhostUrl("http://localhost:5173")).toBe(true);
    expect(isLocalhostUrl("http://127.0.0.1:3000/app")).toBe(true);
    expect(isLocalhostUrl("http://app.localhost:8000")).toBe(true);
  });
  it("rejects external URLs — the plugin binds to the project", () => {
    expect(isLocalhostUrl("https://example.com")).toBe(false);
    expect(isLocalhostUrl("http://192.168.1.10:5173")).toBe(false);
    expect(isLocalhostUrl("file:///etc/passwd")).toBe(false);
  });
});