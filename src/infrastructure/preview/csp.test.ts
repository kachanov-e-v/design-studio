import { describe, expect, it } from "vitest";
import {
  adaptCsp,
  cspRequiresFallback,
  generateNonce,
  htmlMetaCspRequiresFallback,
  rewriteMetaCsp,
} from "./csp";

const NONCE = "testnonce123";

describe("generateNonce", () => {
  it("produces unique url-safe nonces", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,}$/);
  });
});

describe("cspRequiresFallback", () => {
  it("detects sandbox directives", () => {
    expect(cspRequiresFallback("sandbox allow-forms")).toBe(true);
    expect(cspRequiresFallback("default-src 'self'; sandbox")).toBe(true);
    expect(cspRequiresFallback("default-src 'self';sandbox allow-scripts;")).toBe(true);
  });

  it("does not flag normal policies or lookalike tokens", () => {
    expect(cspRequiresFallback("default-src 'self'")).toBe(false);
    expect(cspRequiresFallback("script-src 'self' https://sandbox.example")).toBe(false);
    expect(cspRequiresFallback("")).toBe(false);
  });
});

describe("adaptCsp", () => {
  it("adds self and the nonce to a plain script-src", () => {
    const out = adaptCsp("script-src https://cdn.example", NONCE);
    expect(out).toBe(`script-src https://cdn.example 'self' 'nonce-${NONCE}'`);
  });

  it("keeps an existing 'self' without duplicating it", () => {
    const out = adaptCsp("script-src 'self'", NONCE);
    expect(out).toBe(`script-src 'self' 'nonce-${NONCE}'`);
  });

  it("replaces a lone 'none' with preview sources", () => {
    const out = adaptCsp("script-src 'none'; style-src 'none'", NONCE);
    expect(out).toBe(`script-src 'self' 'nonce-${NONCE}'; style-src 'self'`);
  });

  it("does not add a nonce when the app relies on unsafe-inline", () => {
    const out = adaptCsp("script-src 'self' 'unsafe-inline'", NONCE);
    expect(out).toBe("script-src 'self' 'unsafe-inline'");
    expect(out).not.toContain("nonce-");
  });

  it("adds the nonce alongside the app's own nonce", () => {
    const out = adaptCsp("script-src 'nonce-appNonce' 'strict-dynamic'", NONCE);
    expect(out).toContain("'nonce-appNonce'");
    expect(out).toContain(`'nonce-${NONCE}'`);
    expect(out).toContain("'strict-dynamic'");
  });

  it("adds the nonce when hashes are present (unsafe-inline already ignored)", () => {
    const out = adaptCsp("script-src 'sha256-abc123' 'unsafe-inline'", NONCE);
    expect(out).toContain(`'nonce-${NONCE}'`);
    expect(out).toContain("'sha256-abc123'");
  });

  it("adds the nonce with strict-dynamic even alongside unsafe-inline", () => {
    const out = adaptCsp("script-src 'unsafe-inline' 'strict-dynamic' https:", NONCE);
    expect(out).toContain(`'nonce-${NONCE}'`);
  });

  it("materializes script-src from default-src when absent", () => {
    const out = adaptCsp("default-src 'self' https://cdn.example", NONCE);
    expect(out).toContain(`default-src 'self' https://cdn.example`);
    expect(out).toContain(`script-src 'self' https://cdn.example 'nonce-${NONCE}'`);
  });

  it("does not materialize script-src when script-src-elem exists", () => {
    const out = adaptCsp("default-src 'self'; script-src-elem 'self'", NONCE);
    expect(out).toContain(`script-src-elem 'self' 'nonce-${NONCE}'`);
    expect(out).not.toMatch(/script-src /);
  });

  it("does not add a nonce to a materialized unsafe-inline script policy", () => {
    const out = adaptCsp("default-src 'self' 'unsafe-inline'", NONCE);
    expect(out).toContain("script-src 'self' 'unsafe-inline'");
    expect(out).not.toContain("nonce-");
  });

  it("adds self to fetch directives, base-uri and form-action", () => {
    const out = adaptCsp(
      "img-src https://img.example; connect-src wss://ws.example; base-uri https://base.example; form-action https://form.example",
      NONCE
    );
    expect(out).toContain("img-src https://img.example 'self'");
    expect(out).toContain("connect-src wss://ws.example 'self'");
    expect(out).toContain("base-uri https://base.example 'self'");
    expect(out).toContain("form-action https://form.example 'self'");
  });

  it("drops frame-ancestors and upgrade-insecure-requests", () => {
    const out = adaptCsp("default-src 'self'; frame-ancestors 'none'; upgrade-insecure-requests", NONCE);
    expect(out).not.toContain("frame-ancestors");
    expect(out).not.toContain("upgrade-insecure-requests");
    expect(out).toContain("default-src 'self'");
  });

  it("leaves non-source directives untouched", () => {
    const out = adaptCsp("default-src 'self'; report-uri /csp-report; require-trusted-types-for 'script'", NONCE);
    expect(out).toContain("report-uri /csp-report");
    expect(out).toContain("require-trusted-types-for 'script'");
  });

  it("returns sandbox policies unchanged (caller must fall back)", () => {
    const policy = "default-src 'self'; sandbox allow-forms";
    expect(adaptCsp(policy, NONCE)).toBe(policy);
  });

  it("handles empty and whitespace policies", () => {
    expect(adaptCsp("", NONCE)).toBe("");
    expect(adaptCsp("   ", NONCE)).toBe("");
  });

  it("is case-insensitive on directive names and keyword sources", () => {
    const out = adaptCsp("SCRIPT-SRC 'SELF' 'UNSAFE-INLINE'", NONCE);
    expect(out).toBe("script-src 'SELF' 'UNSAFE-INLINE'");
  });
});

describe("rewriteMetaCsp", () => {
  const meta = (content: string, extra = "") =>
    `<meta http-equiv="Content-Security-Policy" content="${content}"${extra}>`;

  it("rewrites the meta content with the adapted policy", () => {
    const html = `<head>${meta("script-src 'self'")}</head>`;
    const { html: out, fallback } = rewriteMetaCsp(html, NONCE);
    expect(fallback).toBe(false);
    expect(out).toContain(`content="script-src 'self' 'nonce-${NONCE}'"`);
    expect(out).toContain('http-equiv="Content-Security-Policy"');
  });

  it("removes sandbox meta policies and reports fallback", () => {
    const html = `<head>${meta("default-src 'self'; sandbox allow-forms")}</head>`;
    const { html: out, fallback } = rewriteMetaCsp(html, NONCE);
    expect(fallback).toBe(true);
    expect(out).toBe("<head></head>");
  });

  it("handles report-only meta and single-quoted attributes", () => {
    const html = `<meta http-equiv='Content-Security-Policy-Report-Only' content='script-src https://cdn.example'>`;
    const { html: out, fallback } = rewriteMetaCsp(html, NONCE);
    expect(fallback).toBe(false);
    expect(out).toContain(`'nonce-${NONCE}'`);
  });

  it("decodes HTML entities in the content before adapting", () => {
    const html = meta("script-src &#39;self&#39; &amp; more");
    const { html: out } = rewriteMetaCsp(html, NONCE);
    expect(out).toContain(`'nonce-${NONCE}'`);
    expect(out).not.toContain("&#39;");
  });

  it("escapes the adapted value back into the attribute", () => {
    const html = `<meta http-equiv="Content-Security-Policy" content='script-src "quoted"'>`;
    const { html: out } = rewriteMetaCsp(html, NONCE);
    expect(out).toContain("&quot;quoted&quot;");
  });

  it("keeps meta tags without a content attribute", () => {
    const html = `<meta http-equiv="Content-Security-Policy">`;
    const { html: out, fallback } = rewriteMetaCsp(html, NONCE);
    expect(out).toBe(html);
    expect(fallback).toBe(false);
  });

  it("without a nonce removes all meta CSP (legacy behavior, no fallback flag)", () => {
    const html = `<head>${meta("script-src 'self'")}${meta("sandbox")}</head>`;
    const { html: out, fallback } = rewriteMetaCsp(html);
    expect(out).toBe("<head></head>");
    expect(fallback).toBe(false);
  });
});

describe("htmlMetaCspRequiresFallback", () => {
  it("detects sandbox meta policies only", () => {
    expect(htmlMetaCspRequiresFallback(`<meta http-equiv="Content-Security-Policy" content="sandbox">`)).toBe(true);
    expect(htmlMetaCspRequiresFallback(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'">`)).toBe(false);
    expect(htmlMetaCspRequiresFallback("<head></head>")).toBe(false);
  });
});