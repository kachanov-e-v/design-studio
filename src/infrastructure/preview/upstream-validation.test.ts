import { afterEach, describe, expect, it, vi } from "vitest";
import * as dns from "node:dns";
import { validateUpstreamResolved, validateUpstreamTarget } from "./upstream-validation";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockLookup(addresses: { address: string; family: number }[]): void {
  vi.spyOn(dns.promises, "lookup").mockResolvedValue(addresses as never);
}

describe("validateUpstreamResolved (DNS-aware SSRF gate)", () => {
  it("rejects a *.localhost name that resolves to a non-loopback address", async () => {
    mockLookup([{ address: "93.184.216.34", family: 4 }]);
    // The lexical gate alone accepts the name — the resolved gate must not.
    expect(validateUpstreamTarget("http://evil.localhost:3000/").ok).toBe(true);
    const result = await validateUpstreamResolved("http://evil.localhost:3000/");
    expect(result).toEqual({ ok: false, reason: "non-loopback" });
  });

  it("rejects when any resolved address is non-loopback", async () => {
    mockLookup([
      { address: "127.0.0.1", family: 4 },
      { address: "10.0.0.5", family: 4 },
    ]);
    expect((await validateUpstreamResolved("http://app.localhost:3000/")).ok).toBe(false);
  });

  it("accepts names whose every address is loopback", async () => {
    mockLookup([
      { address: "::1", family: 6 },
      { address: "127.0.0.1", family: 4 },
    ]);
    expect((await validateUpstreamResolved("http://app.localhost:3000/")).ok).toBe(true);
  });

  it("rejects names that fail to resolve", async () => {
    vi.spyOn(dns.promises, "lookup").mockRejectedValue(new Error("ENOTFOUND") as never);
    expect((await validateUpstreamResolved("http://missing.localhost:3000/")).ok).toBe(false);
  });

  it("skips DNS for explicit IP literals", async () => {
    const spy = vi.spyOn(dns.promises, "lookup");
    expect((await validateUpstreamResolved("http://127.0.0.1:3000/")).ok).toBe(true);
    expect((await validateUpstreamResolved("http://[::1]:3000/")).ok).toBe(true);
    expect((await validateUpstreamResolved("http://192.168.1.5:3000/")).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the scheme/credentials rejections ahead of DNS", async () => {
    const spy = vi.spyOn(dns.promises, "lookup");
    expect((await validateUpstreamResolved("ftp://localhost/")).reason).toBe("scheme");
    expect((await validateUpstreamResolved("http://user:pw@localhost/")).reason).toBe("credentials");
    expect(spy).not.toHaveBeenCalled();
  });
});