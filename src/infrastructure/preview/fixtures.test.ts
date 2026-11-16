import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import { PreviewHostServer } from "./PreviewHostServer";
import { findProjectEntries } from "./projectEntryScanner";

/**
 * EPIC H5 (automatable part): a vanilla multi-page static fixture served by
 * the preview host. DOM-level behavior (click policy, hover outlines) needs a
 * real browser harness and stays in the manual matrix (H6); this suite covers
 * everything observable over HTTP: entry discovery, runtime/base injection,
 * CSS URL rewriting, and same-origin navigation targets.
 */
function get(url: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers as Record<string, string> }));
    }).on("error", reject);
  });
}

describe("static-site integration fixture", () => {
  const fixtureRoot = path.join(import.meta.dirname, "..", "..", "..", "fixtures", "static-site");
  let server: PreviewHostServer;
  let webviewRoot: string;

  beforeAll(async () => {
    webviewRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ds-fixture-webview-"));
    server = new PreviewHostServer({ webviewRoot, projectRoot: fixtureRoot });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("discovers html and htm entries with index priority", async () => {
    const entries = await findProjectEntries(fixtureRoot);
    expect(entries).toContain("index.html");
    expect(entries).toContain("about.html");
    expect(entries).toContain("orphan.htm");
    expect(entries[0]).toBe("index.html");
  });

  it("serves the index for /project/ with runtime and base injection", async () => {
    const res = await get(`${server.origin}/project/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("Static fixture home");
    expect(res.body).toContain('<script src="/__ds-runtime.js" data-design-studio="1" defer></script>');
    expect(res.body).toContain("<base");
  });

  it("serves the about page for same-origin navigation targets", async () => {
    const page = await get(`${server.origin}/project/`);
    expect(page.body).toContain('href="about.html"');
    const about = await get(`${server.origin}/project/about.html`);
    expect(about.status).toBe(200);
    expect(about.body).toContain("About this fixture");
    expect(about.body).toContain('<script src="/__ds-runtime.js" data-design-studio="1" defer></script>');
  });

  it("rewrites root-absolute css urls to the /project/ prefix", async () => {
    const css = await get(`${server.origin}/project/styles.css`);
    expect(css.status).toBe(200);
    expect(css.headers["content-type"]).toContain("text/css");
    expect(css.body).toContain('url("/project/images/logo.png")');
    expect(css.body).not.toContain('url("/images/logo.png")');
  });

  it("serves project assets referenced by the fixture", async () => {
    const svg = await get(`${server.origin}/project/images/logo.svg`);
    expect(svg.status).toBe(200);
    expect(svg.headers["content-type"]).toContain("svg");
  });

  // P0-1: the injected <base> must point into /project/ (and the page's
  // directory) so relative href/src resolve like a real browser would.
  it("injects a /project/ base href so relative URLs resolve", async () => {
    const home = await get(`${server.origin}/project/`);
    const base = /<base\s[^>]*href="([^"]*)"/.exec(home.body)?.[1] ?? "";
    expect(base).toBe(`${server.origin}/project/`);
    // Resolve relative references exactly as the browser would.
    expect((await get(`${base}styles.css`)).status).toBe(200);
    expect((await get(`${base}images/logo.svg`)).status).toBe(200);
    expect((await get(`${base}about.html`)).status).toBe(200);

    const about = await get(`${server.origin}/project/about.html`);
    const aboutBase = /<base\s[^>]*href="([^"]*)"/.exec(about.body)?.[1] ?? "";
    expect(aboutBase).toBe(`${server.origin}/project/`);
  });

  it("respects an authored <base> and never overrides it", async () => {
    const res = await get(`${server.origin}/project/authored-base.html`);
    expect(res.status).toBe(200);
    const bases = res.body.match(/<base\s[^>]*href=/g) ?? [];
    expect(bases).toHaveLength(1);
    expect(res.body).toContain('href="https://example.com/assets/"');
    expect(res.body).toContain("/__ds-runtime.js");
  });

  // P0-2: exactly one runtime script per served project page — two tags mean
  // two runtime instances (duplicated listeners/overlays/history patches).
  it("injects exactly one runtime script tag into project pages", async () => {
    for (const page of ["/", "/about.html", "/authored-base.html"]) {
      const res = await get(`${server.origin}/project${page}`);
      const tags = res.body.match(/<script[^>]*src="\/__ds-runtime\.js"[^>]*><\/script>/g) ?? [];
      expect(tags, `page ${page}`).toHaveLength(1);
    }
  });
});
