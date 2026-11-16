import { describe, it, expect } from "vitest";
import { isLocalhostUrl, isLoopbackHostname } from "./url";

describe("isLoopbackHostname", () => {
  it("accepts loopback names, addresses and subdomains", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("LOCALHOST")).toBe(true);
    expect(isLoopbackHostname("app.localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("127.5.4.3")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("0.0.0.0")).toBe(true);
  });
  it("rejects private, link-local, metadata and external hosts", () => {
    expect(isLoopbackHostname("169.254.169.254")).toBe(false);
    expect(isLoopbackHostname("10.0.0.1")).toBe(false);
    expect(isLoopbackHostname("172.16.0.5")).toBe(false);
    expect(isLoopbackHostname("192.168.1.10")).toBe(false);
    expect(isLoopbackHostname("224.0.0.1")).toBe(false);
    expect(isLoopbackHostname("example.com")).toBe(false);
    expect(isLoopbackHostname("localtest.me")).toBe(false);
    expect(isLoopbackHostname("app.evil.localhost.com")).toBe(false);
  });
  it("rejects malformed addresses", () => {
    expect(isLoopbackHostname("127.0.0.999")).toBe(false);
    expect(isLoopbackHostname("1.2.3.4.5")).toBe(false);
    expect(isLoopbackHostname("")).toBe(false);
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
    expect(isLocalhostUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });
  it("rejects userinfo credentials in the URL", () => {
    expect(isLocalhostUrl("http://user:pw@localhost:3000/")).toBe(false);
    expect(isLocalhostUrl("http://localhost@[::1]/")).toBe(false);
  });
});