import { describe, it, expect } from "vitest";
import { injectIntoHtml } from "../../../src/infrastructure/preview/proxy-html";

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