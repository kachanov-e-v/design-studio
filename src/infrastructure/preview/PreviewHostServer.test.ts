import { describe, it, expect, afterAll, beforeAll } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PreviewHostServer } from "./PreviewHostServer";
import {
  injectIntoHtml,
  rewriteProxiedCss,
  rewriteProxiedHtml,
  targetFromProxyPath,
  proxyPathFor,
  candidateLoopbackTargets,
} from "./proxy-html";

const stubHtml = `<!DOCTYPE html><html><head><title>App</title></head><body><h1>Hello</h1></body></html>`;
const stubCss = `body { background: url("/img/bg.png") no-repeat; }`;
const stubHtmlWithStyle = `<!DOCTYPE html><html><head><style>.x { background: url("/a.png"); }</style></head><body></body></html>`;

let stubServer: http.Server;
let stubOrigin = "";

beforeAll(async () => {
  stubServer = http.createServer((req, res) => {
    const p = (req.url ?? "/").split("?")[0];
    if (p === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(stubHtml);
    } else if (p === "/style.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(stubCss);
    } else if (p === "/with-style") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(stubHtmlWithStyle);
    } else {
      res.writeHead(404);
      res.end("nf");
    }
  });
  await new Promise<void>((r) => stubServer.listen(0, "127.0.0.1", r));
  const addr = stubServer.address();
  if (addr && typeof addr !== "string") stubOrigin = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => stubServer.close(() => r()));
});

function makeTempWebviewRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-webview-"));
  fs.writeFileSync(path.join(root, "demo.html"), "<!DOCTYPE html><html><body>demo</body></html>");
  fs.writeFileSync(path.join(root, "runtime.js"), "console.log('rt')");
  return root;
}

function get(url: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body,
            headers: res.headers as Record<string, string>,
          })
        );
      })
      .on("error", reject);
  });
}

describe("proxy-html helpers", () => {
  it("injects base+runtime after <head>", () => {
    const out = injectIntoHtml(stubHtml, "http://127.0.0.1:1/__ds-runtime.js", "http://127.0.0.1:1/proxy/http://x/");
    expect(out).toContain(`<base href="http://127.0.0.1:1/proxy/http://x/">`);
    expect(out).toContain(`<script src="http://127.0.0.1:1/__ds-runtime.js"`);
    expect(out.indexOf("<base")).toBeLessThan(out.indexOf("<title>"));
  });

  it("rewrites root-absolute css urls through the proxy", () => {
    const out = rewriteProxiedCss(stubCss, "http://localhost:3000/");
    expect(out).toContain(`url("/proxy/http://localhost:3000/img/bg.png")`);
    expect(out).not.toContain(`url("/img/bg.png")`);
  });

  it("rewrites style blocks inside html", () => {
    const out = rewriteProxiedHtml(stubHtmlWithStyle, "http://localhost:3000/app", "http://127.0.0.1:1/__ds-runtime.js", "http://127.0.0.1:1");
    expect(out).toContain(`url("/proxy/http://localhost:3000/a.png")`);
    expect(out).toContain("__ds-runtime.js");
  });

  it("parses proxy targets", () => {
    expect(targetFromProxyPath("/proxy/http://localhost:3000/a?b=1")).toBe("http://localhost:3000/a?b=1");
    expect(targetFromProxyPath("/proxy/ftp://x")).toBeNull();
    expect(targetFromProxyPath("/proxy/")).toBeNull();
    expect(proxyPathFor("http://localhost:3000/")).toBe("/proxy/http://localhost:3000/");
  });

  it("builds loopback fallback candidates", () => {
    expect(candidateLoopbackTargets("http://localhost:3000/app")).toEqual([
      "http://localhost:3000/app",
      "http://127.0.0.1:3000/app",
    ]);
    expect(candidateLoopbackTargets("http://127.0.0.1/api")).toEqual(["http://127.0.0.1/api", "http://localhost/api"]);
    expect(candidateLoopbackTargets("http://example.org/")).toHaveLength(1);
  });
});

describe("PreviewHostServer", () => {
  let server: PreviewHostServer;
  let webviewRoot: string;

  beforeAll(async () => {
    webviewRoot = makeTempWebviewRoot();
    server = new PreviewHostServer({ webviewRoot });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it("serves demo.html from the webview root", async () => {
    const res = await get(`${server.origin}/demo.html`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("demo");
  });

  it("serves the runtime script", async () => {
    const res = await get(`${server.origin}/__ds-runtime.js`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("javascript");
  });

  it("proxies html with injection and header stripping", async () => {
    const res = await get(`${server.origin}/proxy/${stubOrigin}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain("__ds-runtime.js");
    expect(res.body).toContain(`<base href="${server.origin}/proxy/${stubOrigin}/">`);
  });

  it("proxies css with rewritten urls", async () => {
    const res = await get(`${server.origin}/proxy/${stubOrigin}/style.css`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(`/proxy/${stubOrigin}/img/bg.png`);
  });

  it("rejects invalid proxy targets", async () => {
    const res = await get(`${server.origin}/proxy/ftp://nope`);
    expect(res.status).toBe(400);
  });

  it("returns 502 when the target is unreachable", async () => {
    const res = await get(`${server.origin}/proxy/http://127.0.0.1:9/`);
    expect(res.status).toBe(502);
  });
});
