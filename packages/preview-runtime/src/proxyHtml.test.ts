import { describe, it, expect } from "vitest";
import { injectIntoHtml, rewriteProxiedHtml } from "../../../src/infrastructure/preview/proxy-html";

const RUNTIME = "http://127.0.0.1:1/__ds-runtime.js";
const BASE = "http://127.0.0.1:1/proxy/http://x/";

describe("injectIntoHtml: meta CSP stripping", () => {
  it("removes enforce and report-only meta CSP so the runtime is not blocked", () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'">' +
      "<meta http-equiv='Content-Security-Policy-Report-Only' content=\"default-src 'none'\">" +
      "<meta http-equiv=Content-Security-Policy content=\"script-src 'none'\">" +
      '<meta charset="utf-8"><title>t</title></head><body></body></html>';
    const out = injectIntoHtml(html, RUNTIME, BASE);
    expect(out.toLowerCase()).not.toContain("content-security-policy");
    expect(out).toContain('<meta charset="utf-8">');
    expect(out).toContain(`<script src="${RUNTIME}"`);
    expect(out.indexOf("<base")).toBeLessThan(out.indexOf("<title>"));
  });
});

describe("injectIntoHtml: robust injection point", () => {
  it("does not inject into a <head> inside an inline script string", () => {
    const html = '<html><head><script>const tpl = "<head><meta></head>";</script><title>t</title></head><body>x</body></html>';
    const out = injectIntoHtml(html, RUNTIME, BASE);
    expect(out).toContain(`<head><base href="${BASE}">`);
    expect(out).toContain('const tpl = "<head><meta></head>";');
    expect(out.indexOf("<base")).toBeLessThan(out.indexOf("<script"));
  });

  it("does not inject into a <head> inside an HTML comment", () => {
    const html = "<!-- <head> --><html><head><title>t</title></head><body></body></html>";
    const out = injectIntoHtml(html, RUNTIME, BASE);
    expect(out.indexOf("<base")).toBeGreaterThan(out.indexOf("-->"));
    expect(out.indexOf("<base")).toBeLessThan(out.indexOf("<title>"));
  });

  it("skips <body> lookalikes inside style blocks", () => {
    const html = '<html><head><style>/* "<body>" */</style></head><body>x</body></html>';
    const out = injectIntoHtml(html, RUNTIME, BASE);
    expect(out.indexOf("<base")).toBeLessThan(out.indexOf("<style>"));
  });

  it("falls back to after <html> when neither head nor body exists", () => {
    const out = injectIntoHtml('<html lang="en"><div>x</div></html>', RUNTIME, BASE);
    expect(out).toContain(`<html lang="en"><base href="${BASE}">`);
  });
});

describe("IMP-B: nonce-aware injection and meta CSP adaptation", () => {
  const NONCE = "dGVzdC1ub25jZQ";
  const PLAIN_HTML = "<html><head><title>t</title></head><body>x</body></html>";
  const TARGET = "http://localhost:3000/app";
  const PROXY_ORIGIN = "http://127.0.0.1:1";

  function runtimeTag(html: string): string {
    return /<script[^>]*src="[^"]*__ds-runtime\.js"[^>]*>/.exec(html)?.[0] ?? "";
  }

  it("stamps the nonce on the runtime script tag", () => {
    const out = injectIntoHtml(PLAIN_HTML, RUNTIME, BASE, { nonce: NONCE });
    expect(runtimeTag(out)).toContain(`nonce="${NONCE}"`);
  });

  it("rewriteProxiedHtml nonces both the runtime tag and the SW snippet", () => {
    const out = rewriteProxiedHtml(PLAIN_HTML, TARGET, `${PROXY_ORIGIN}/__ds-runtime.js`, PROXY_ORIGIN, NONCE);
    expect(runtimeTag(out)).toContain(`nonce="${NONCE}"`);
    expect(out).toContain(`<script nonce="${NONCE}">if('serviceWorker' in navigator)`);
  });

  it("without a nonce no injected script carries a nonce attribute (legacy)", () => {
    const injected = injectIntoHtml(PLAIN_HTML, RUNTIME, BASE);
    expect(injected).not.toContain("nonce=");
    const proxied = rewriteProxiedHtml(PLAIN_HTML, TARGET, `${PROXY_ORIGIN}/__ds-runtime.js`, PROXY_ORIGIN);
    expect(proxied).not.toContain("nonce=");
    expect(proxied).toContain("<script>if('serviceWorker' in navigator)");
  });

  it("adapts meta CSP with the nonce instead of removing it", () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'">' +
      "<title>t</title></head><body></body></html>";
    const out = injectIntoHtml(html, RUNTIME, BASE, { nonce: NONCE });
    expect(out).toContain('http-equiv="Content-Security-Policy"');
    const content = /content="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(content).toContain(`'nonce-${NONCE}'`);
    expect(content).toContain("'self'");
    expect(content).not.toContain("'none'");
  });

  it("keeps 'unsafe-inline' meta policies working without adding a nonce", () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'">' +
      "</head><body></body></html>";
    const out = injectIntoHtml(html, RUNTIME, BASE, { nonce: NONCE });
    const content = /content="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(content).toContain("'unsafe-inline'");
    expect(content).not.toContain("nonce-");
  });

  it("removes sandbox meta CSP even when a nonce is set", () => {
    const html =
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; sandbox allow-forms">' +
      '<meta charset="utf-8"><title>t</title></head><body></body></html>';
    const out = injectIntoHtml(html, RUNTIME, BASE, { nonce: NONCE });
    expect(out.toLowerCase()).not.toContain("content-security-policy");
    expect(out).toContain('<meta charset="utf-8">');
  });
});