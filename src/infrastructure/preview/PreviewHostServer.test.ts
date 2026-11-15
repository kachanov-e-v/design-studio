import { describe, it, expect, afterAll, beforeAll } from "vitest";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PreviewHostServer, resolveProjectPath } from "./PreviewHostServer";
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

  it("returns 400 before a project root is bound", async () => {
    const res = await get(`${server.origin}/project/index.html`);
    expect(res.status).toBe(400);
  });

  it("serves project files with runtime injection", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ds-project-"));
    fs.mkdirSync(path.join(projectRoot, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, "index.html"),
      "<!DOCTYPE html><html><head><title>P</title></head><body><main>Project page</main></body></html>"
    );
    fs.writeFileSync(path.join(projectRoot, "assets", "app.js"), "console.log('app')");
    const projectServer = new PreviewHostServer({ webviewRoot, projectRoot });
    await projectServer.start();
    try {
      const page = await get(`${projectServer.origin}/project/index.html`);
      expect(page.status).toBe(200);
      expect(page.body).toContain("Project page");
      expect(page.body).toContain('<script src="/__ds-runtime.js"></script>');
      expect(page.headers["content-type"]).toContain("text/html");

      const nested = await get(`${projectServer.origin}/project/assets/app.js`);
      expect(nested.status).toBe(200);
      expect(nested.headers["content-type"]).toContain("javascript");

      const dirIndex = await get(`${projectServer.origin}/project/`);
      expect(dirIndex.status).toBe(200);
      expect(dirIndex.body).toContain("Project page");

      const missing = await get(`${projectServer.origin}/project/nope.html`);
      expect(missing.status).toBe(404);
    } finally {
      await projectServer.stop();
    }
  });

  it("jails project requests inside the project root", async () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ds-project-"));
    fs.writeFileSync(path.join(projectRoot, "index.html"), "<html></html>");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ds-outside-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "no");
    const projectServer = new PreviewHostServer({ webviewRoot, projectRoot });
    await projectServer.start();
    try {
      const traversal = await get(`${projectServer.origin}/project/%2E%2E/%2E%2E/%2E%2E/etc/passwd`);
      expect([403, 404]).toContain(traversal.status);
    } finally {
      await projectServer.stop();
    }
  });

  it("resolveProjectPath rejects escaping paths and accepts project files", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ds-jail-"));
    fs.writeFileSync(path.join(projectRoot, "index.html"), "<html></html>");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ds-jail-out-"));
    const escape = path.relative(projectRoot, path.join(outside, "secret.txt"));
    const escapeEncoded = escape.split(path.sep).map((s) => encodeURIComponent(s)).join("/");

    expect(resolveProjectPath(projectRoot, "index.html")).toMatchObject({ ok: true });
    const indexResolution = resolveProjectPath(projectRoot, "");
    expect(indexResolution.ok).toBe(true);
    expect(indexResolution.ok && indexResolution.filePath).toContain("index.html");
    expect(resolveProjectPath(projectRoot, escapeEncoded)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(resolveProjectPath(projectRoot, "%2E%2E%2Fetc")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(resolveProjectPath(projectRoot, "a%ZZb")).toMatchObject({ ok: false, reason: "encoding" });
  });
});
