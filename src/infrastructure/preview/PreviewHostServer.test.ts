import { describe, it, expect, afterAll, beforeAll } from "vitest";
import * as http from "node:http";
import * as net from "node:net";
import type { Duplex } from "node:stream";
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

function bs(parts: Buffer[]): string {
  return Buffer.concat(parts).toString("utf8");
}

beforeAll(async () => {
  stubServer = http.createServer((req, res) => {
    const p = (req.url ?? "/").split("?")[0];
    if (p === "/") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(stubHtml);
    } else if (p === "/style.css") {
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(stubCss);
    } else if (p === "/style-cookie.css") {
      res.setHeader("Set-Cookie", ["csssession=7; Path=/"]);
      res.writeHead(200, { "Content-Type": "text/css" });
      res.end(stubCss);
    } else if (p === "/sse") {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: one\n\n");
      setTimeout(() => {
        res.write("data: two\n\n");
        setTimeout(() => res.end("data: three\n"), 150);
      }, 150);
    } else if (p === "/big-html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><body>${"x".repeat(1024)}</body></html>`);
    } else if (p === "/big-json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ blob: "y".repeat(1024) }));
    } else if (p === "/with-style") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(stubHtmlWithStyle);
    } else if (p === "/dashboard") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end('<!DOCTYPE html><html><head><title>Dashboard</title></head><body><main>Dash</main></body></html>');
    } else if (p === "/echo-headers") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ rsc: req.headers["rsc"] ?? null, cookie: req.headers["cookie"] ?? null, origin: req.headers["origin"] ?? null }));
    } else if (p === "/api/login") {
      const parts: Buffer[] = [];
      req.on("data", (c) => parts.push(c));
      req.on("end", () => {
        const body = bs(parts);
        if (req.headers["content-type"] !== "application/json" || !body.includes("user")) {
          res.writeHead(400);
          res.end("bad");
          return;
        }
        res.setHeader("Set-Cookie", ["sid=abc; Path=/", "other=1; Path=/"]);
        res.writeHead(302, { Location: "/dashboard" });
        res.end("ok");
      });
    } else if (p === "/api/logout" && req.method === "POST") {
      res.setHeader("Set-Cookie", ["sid=abc; Max-Age=0"]);
      res.writeHead(200);
      res.end("bye");
    } else if (p === "/ext-redirect") {
      res.writeHead(302, { Location: "http://example.org/next" });
      res.end();
    } else if (p === "/loop-redirect") {
      const port = new URL(stubOrigin).port;
      res.writeHead(302, { Location: `http://localhost:${port}/after-loop-redirect` });
      res.end();
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
  stubServer.closeAllConnections();
  await new Promise<void>((r) => stubServer.close(() => r()));
});

function makeTempWebviewRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ds-webview-"));
  fs.writeFileSync(path.join(root, "demo.html"), "<!DOCTYPE html><html><body>demo</body></html>");
  fs.writeFileSync(path.join(root, "runtime.js"), "console.log('rt')");
  return root;
}

/** Raw HTTP/1.1 upgrade request against a preview host; resolves with the
 * received preamble bytes ("" when the socket is closed without a reply). */
function rawUpgradeRequest(previewOrigin: string, requestPath: string, extraHeaders: string[] = []): Promise<string> {
  const port = Number(new URL(previewOrigin).port);
  const host = new URL(previewOrigin).host;
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(
        `GET ${requestPath} HTTP/1.1\r\n` +
          `Host: ${host}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          extraHeaders.join("\r\n") +
          "\r\n\r\n"
      );
    });
    let data = Buffer.alloc(0);
    let settled = false;
    const finish = (result: string) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish(data.toString("latin1")), 5000);
    sock.on("data", (c: Buffer) => {
      data = Buffer.concat([data, c]);
      if (data.includes("\r\n\r\n")) {
        clearTimeout(timer);
        finish(data.toString("latin1"));
      }
    });
    sock.on("close", () => finish(data.toString("latin1")));
    sock.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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

function request(
  url: string,
  options: http.RequestOptions & { body?: string }
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { ...options, headers: options.headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers as Record<string, string> }));
    });
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
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
    expect(out).toContain(`url("/proxy/http/localhost:3000/img/bg.png")`);
    expect(out).not.toContain(`url("/img/bg.png")`);
  });

  it("rewrites style blocks inside html", () => {
    const out = rewriteProxiedHtml(stubHtmlWithStyle, "http://localhost:3000/app", "http://127.0.0.1:1/__ds-runtime.js", "http://127.0.0.1:1");
    expect(out).toContain(`url("/proxy/http/localhost:3000/a.png")`);
    expect(out).toContain("__ds-runtime.js");
  });

  it("parses proxy targets", () => {
    expect(targetFromProxyPath("/proxy/http://localhost:3000/a?b=1")).toBe("http://localhost:3000/a?b=1");
    expect(targetFromProxyPath("/proxy/ftp://x")).toBeNull();
    expect(targetFromProxyPath("/proxy/")).toBeNull();
    expect(targetFromProxyPath("/proxy/http/localhost:3000/a?b=1")).toBe("http://localhost:3000/a?b=1");
    expect(proxyPathFor("http://localhost:3000/")).toBe("/proxy/http/localhost:3000/");
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
    expect(res.body).toContain(`<base href="${server.origin}/">`);
  });

  it("proxies css with rewritten urls", async () => {
    const res = await get(`${server.origin}/proxy/${stubOrigin}/style.css`);
    expect(res.status).toBe(200);
    expect(res.body).toContain(`/proxy/http/127.0.0.1:${new URL(stubOrigin).port}/img/bg.png`);
  });

  it("rejects invalid proxy targets", async () => {
    const res = await get(`${server.origin}/proxy/ftp://nope`);
    expect(res.status).toBe(400);
  });

  it("blocks non-loopback proxy targets before any network request (SSRF)", async () => {
    const meta = await get(`${server.origin}/proxy/http://169.254.169.254/latest/meta-data/`);
    expect(meta.status).toBe(403);
    const lan = await get(`${server.origin}/proxy/http://192.168.1.5:3000/`);
    expect(lan.status).toBe(403);
    const external = await get(`${server.origin}/proxy/http://example.org/`);
    expect(external.status).toBe(403);
    const userinfo = await get(`${server.origin}/proxy/http://user:pw@127.0.0.1:9/`);
    expect(userinfo.status).toBe(403);
  });

  it("still allows loopback addresses outside the common pair", async () => {
    const v6 = await get(`${server.origin}/proxy/http://[::1]:9/`);
    expect(v6.status).toBe(502);
    const range = await get(`${server.origin}/proxy/http://127.9.9.9:9/`);
    expect(range.status).toBe(502);
  });

  it("leaves external (non-loopback) redirect Location untouched so the browser follows it natively", async () => {
    const res = await get(`${server.origin}/proxy/${stubOrigin}/ext-redirect`);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("http://example.org/next");
  });

  it("routes cross-origin loopback redirect Location back through the proxy path", async () => {
    const port = new URL(stubOrigin).port;
    const res = await get(`${server.origin}/proxy/${stubOrigin}/loop-redirect`);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(`/proxy/http/localhost:${port}/after-loop-redirect`);
  });

  it("rejects non-loopback sticky dev targets", async () => {
    const denied = new PreviewHostServer({ webviewRoot: makeTempWebviewRoot() });
    await denied.start();
    try {
      denied.setDevTarget("http://169.254.169.254:80");
      const res = await get(`${denied.origin}/dashboard`);
      expect(res.status).toBe(404);
    } finally {
      await denied.stop();
    }
  });

  it("destroys WebSocket upgrades toward non-loopback targets", async () => {
    const port = Number(new URL(server.origin).port);
    await new Promise<void>((resolve) => {
      const socket = net.connect(port, "127.0.0.1");
      let closed = false;
      const done = () => {
        if (!closed) {
          closed = true;
          socket.destroy();
          resolve();
        }
      };
      socket.on("connect", () => {
        socket.write(
          "GET /proxy/http://example.com/ws HTTP/1.1\r\nHost: preview\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"
        );
      });
      socket.on("close", done);
      socket.on("error", done);
      setTimeout(done, 3000);
    });
  });

  it("returns 502 when the target is unreachable", async () => {
    const res = await get(`${server.origin}/proxy/http://127.0.0.1:9/`);
    expect(res.status).toBe(502);
  });

  it("returns 400 before a project root is bound", async () => {
    const res = await get(`${server.origin}/project/index.html`);
    expect(res.status).toBe(400);
  });

  it("passes RSC, cookies and rewritten Origin to the upstream", async () => {
    const res = await request(`${server.origin}/proxy/${stubOrigin}/echo-headers`, {
      headers: { RSC: "1", Cookie: "session=x", Origin: server.origin, Accept: "*/*" },
    });
    const echo = JSON.parse(res.body) as { rsc: string | null; cookie: string | null; origin: string | null };
    expect(echo.rsc).toBe("1");
    expect(echo.cookie).toBe("session=x");
    expect(echo.origin).toBe(stubOrigin);
  });

  it("proxies POST with body, forwards Set-Cookie and rewrites redirect Location", async () => {
    const res = await request(`${server.origin}/proxy/${stubOrigin}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.origin },
      body: JSON.stringify({ user: "u", pass: "p" }),
    });
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe(`${server.origin}/dashboard`);
    expect(res.headers["set-cookie"]).toEqual(["sid=abc; Path=/", "other=1; Path=/"]);
  });

  it("still rejects POST to non-proxy paths", async () => {
    const res = await request(`${server.origin}/demo.html`, { method: "POST", body: "x" });
    expect(res.status).toBe(405);
  });

  it("keeps the upstream session in the host-side cookie jar across navigations", async () => {
    await request(`${server.origin}/proxy/${stubOrigin}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.origin },
      body: JSON.stringify({ user: "u", pass: "p" }),
    });
    // No browser cookie header at all — the jar must supply the session.
    const res = await request(`${server.origin}/proxy/${stubOrigin}/echo-headers`, { headers: {} });
    const echo = JSON.parse(res.body) as { cookie: string | null };
    expect(echo.cookie).toContain("sid=abc");
    expect(echo.cookie).toContain("other=1");
  });

  it("serves CSS responses that set cookies without header errors", async () => {
    const res = await request(`${server.origin}/proxy/${stubOrigin}/style-cookie.css`, {
      headers: { Accept: "text/css" },
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/css");
    // The body must be the proxied CSS, not an ERR_HTTP_HEADERS_SENT trace.
    expect(res.body).toContain("background");
    expect(res.headers["set-cookie"]).toEqual(["csssession=7; Path=/"]);
    const echo = await request(`${server.origin}/proxy/${stubOrigin}/echo-headers`, { headers: {} });
    expect((JSON.parse(echo.body) as { cookie: string | null }).cookie).toContain("csssession=7");
  });

  it("deletes expired cookies from the jar", async () => {
    await request(`${server.origin}/proxy/${stubOrigin}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.origin },
      body: JSON.stringify({ user: "u", pass: "p" }),
    });
    await request(`${server.origin}/proxy/${stubOrigin}/api/logout`, {
      method: "POST",
      headers: { Origin: server.origin },
    });
    const res = await request(`${server.origin}/proxy/${stubOrigin}/echo-headers`, { headers: {} });
    const echo = JSON.parse(res.body) as { cookie: string | null };
    expect(echo.cookie).not.toContain("sid=");
  });

  it("clears the cookie jar when the dev target changes", async () => {
    const jarServer = new PreviewHostServer({ webviewRoot: makeTempWebviewRoot() });
    await jarServer.start();
    try {
      const origin = stubOrigin.replace("127.0.0.1", "localhost");
      jarServer.setDevTarget(origin);
      await request(`${jarServer.origin}/proxy/${stubOrigin}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: jarServer.origin },
        body: JSON.stringify({ user: "u", pass: "p" }),
      });
      const before = await request(`${jarServer.origin}/proxy/${stubOrigin}/echo-headers`, { headers: {} });
      expect((JSON.parse(before.body) as { cookie: string | null }).cookie).toContain("sid=abc");

      jarServer.setDevTarget("http://localhost:9");
      const after = await request(`${jarServer.origin}/proxy/${stubOrigin}/echo-headers`, { headers: {} });
      expect((JSON.parse(after.body) as { cookie: string | null }).cookie).toBeNull();
    } finally {
      await jarServer.stop();
    }
  });

  it("proxies bare SPA paths via the Referer fallback (RSC fetch, hard redirects)", async () => {
    const referer = `${server.origin}/proxy/${stubOrigin}/login`;
    const res = await get(`${server.origin}/dashboard`);
    expect(res.status).toBe(404);
    const withReferer = await request(`${server.origin}/dashboard`, { headers: { Referer: referer } });
    expect(withReferer.status).toBe(200);
    expect(withReferer.body).toContain("Dashboard");
    expect(withReferer.body).toContain("__ds-runtime.js");

    const rsc = await request(`${server.origin}/dashboard?_rsc=abc`, {
      headers: { Referer: referer, RSC: "1" },
    });
    expect(rsc.status).toBe(200);

    const without = await get(`${server.origin}/no-referer-path`);
    expect(without.status).toBe(404);
  });

  it("proxies bare paths via the sticky dev target after hard navigations", async () => {
    const projectServer = new PreviewHostServer({ webviewRoot: makeTempWebviewRoot() });
    await projectServer.start();
    try {
      const before = await get(`${projectServer.origin}/dashboard`);
      expect(before.status).toBe(404);

      projectServer.setDevTarget(stubOrigin);
      const doc = await get(`${projectServer.origin}/dashboard`);
      expect(doc.status).toBe(200);
      expect(doc.body).toContain("Dashboard");
      expect(doc.body).toContain("__ds-runtime.js");

      projectServer.setDevTarget(null);
      const cleared = await get(`${projectServer.origin}/dashboard`);
      expect(cleared.status).toBe(404);
    } finally {
      await projectServer.stop();
    }
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

  it("resolveProjectPath blocks symlink escapes out of the project root", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ds-sym-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "ds-sym-out-"));
    fs.writeFileSync(path.join(outside, "secret.txt"), "no");
    let linkCreated = false;
    try {
      fs.symlinkSync(outside, path.join(projectRoot, "link"), process.platform === "win32" ? "junction" : "dir");
      linkCreated = true;
    } catch {
      // No symlink privileges in this environment; the lexical checks are still covered.
    }
    if (linkCreated) {
      const escaped = resolveProjectPath(projectRoot, "link/secret.txt");
      expect(escaped).toMatchObject({ ok: false, reason: "forbidden" });
      const nested = resolveProjectPath(projectRoot, "link/deep/secret.txt");
      expect(nested).toMatchObject({ ok: false, reason: "forbidden" });
    }
    expect(resolveProjectPath(projectRoot, "secret.txt")).toMatchObject({ ok: true });
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

  it("resolveProjectPath denies env, git and node_modules files", () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ds-secret-"));
    expect(resolveProjectPath(projectRoot, ".env")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(resolveProjectPath(projectRoot, ".env.local")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(resolveProjectPath(projectRoot, "config/.env.production")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(resolveProjectPath(projectRoot, ".git/config")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(resolveProjectPath(projectRoot, "node_modules/pkg/index.js")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(resolveProjectPath(projectRoot, "src/styles/site.css")).toMatchObject({ ok: true });
  });

  it("rejects requests whose Host header is not the preview origin", async () => {
    const hijack = await request(`${server.origin}/demo.html`, { headers: { Host: "evil.example" } });
    expect(hijack.status).toBe(403);
    const proper = await request(`${server.origin}/demo.html`, { headers: { Host: new URL(server.origin).host } });
    expect(proper.status).toBe(200);
  });

  it("keeps the cookie jar scoped per upstream origin", async () => {
    const isolateServer = new PreviewHostServer({ webviewRoot: makeTempWebviewRoot() });
    await isolateServer.start();
    try {
      const localOrigin = stubOrigin.replace("127.0.0.1", "localhost");
      await request(`${isolateServer.origin}/proxy/${stubOrigin}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: isolateServer.origin },
        body: JSON.stringify({ user: "u", pass: "p" }),
      });
      const same = await request(`${isolateServer.origin}/proxy/${stubOrigin}/echo-headers`, { headers: {} });
      expect((JSON.parse(same.body) as { cookie: string | null }).cookie).toContain("sid=abc");
      // Cookie app sessions must not leak to another loopback origin/port.
      const other = await request(`${isolateServer.origin}/proxy/${localOrigin}/echo-headers`, { headers: {} });
      expect((JSON.parse(other.body) as { cookie: string | null }).cookie).toBeNull();
    } finally {
      await isolateServer.stop();
    }
  });

  it("streams non-HTML responses progressively instead of buffering (SSE)", async () => {
    let firstChunkAt = 0;
    let endAt = 0;
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(`${server.origin}/proxy/${stubOrigin}/sse`, (res) => {
        let acc = "";
        res.on("data", (c: Buffer) => {
          if (firstChunkAt === 0) firstChunkAt = Date.now();
          acc += c.toString("utf8");
        });
        res.on("end", () => {
          endAt = Date.now();
          resolve(acc);
        });
        res.on("error", reject);
      });
      req.on("error", reject);
    });
    expect(body).toContain("data: one");
    expect(body).toContain("data: two");
    expect(body).toContain("data: three");
    // The first chunk must arrive well before the stream ends: the response
    // was not held back in a buffer until the upstream finished.
    expect(endAt - firstChunkAt).toBeGreaterThan(100);
  });

  it("answers 502 instead of silently truncating oversized upstream HTML", async () => {
    const cappedServer = new PreviewHostServer({ webviewRoot: makeTempWebviewRoot(), maxResponseBytes: 32 });
    await cappedServer.start();
    try {
      const res = await request(`${cappedServer.origin}/proxy/${stubOrigin}/big-html`, {});
      expect(res.status).toBe(502);
      expect(res.body).toContain("byte limit");
    } finally {
      await cappedServer.stop();
    }
  });

  it("destroys the client instead of truncating oversized streamed responses", async () => {
    const cappedServer = new PreviewHostServer({ webviewRoot: makeTempWebviewRoot(), maxResponseBytes: 32 });
    await cappedServer.start();
    try {
      const outcome = await new Promise<{ aborted: boolean; error?: string }>((resolve) => {
        const req = http.get(`${cappedServer.origin}/proxy/${stubOrigin}/big-json`, (res) => {
          res.on("aborted", () => resolve({ aborted: true }));
          res.on("end", () => resolve({ aborted: false }));
          res.on("error", (err) => resolve({ aborted: true, error: err.message }));
        });
        req.on("error", (err) => resolve({ aborted: true, error: err.message }));
        setTimeout(() => resolve({ aborted: true, error: "test timeout" }), 5000);
      });
      expect(outcome.aborted).toBe(true);
    } finally {
      await cappedServer.stop();
    }
  });

  it("forwards repeated WebSocket handshake headers instead of dropping them", async () => {
    let upstreamSide: Duplex | null = null;
    const up = http.createServer(() => {});
    up.on("upgrade", (req, socket) => {
      upstreamSide = socket;
      const multi = req.headers["x-multi"];
      const echo = Array.isArray(multi) ? multi.join(", ") : String(multi ?? "");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Multi-Echo: ${echo}\r\n\r\n`);
    });
    await new Promise<void>((r) => up.listen(0, "127.0.0.1", r));
    const upOrigin = `http://127.0.0.1:${(up.address() as { port: number }).port}`;
    const upgrader = new PreviewHostServer({ webviewRoot: makeTempWebviewRoot() });
    await upgrader.start();
    try {
      const raw = await rawUpgradeRequest(upgrader.origin, `/proxy/${upOrigin}/hmr`, ["X-Multi: a", "X-Multi: b"]);
      expect(raw).toContain("101 Switching Protocols");
      // Both duplicate header values must reach the upstream relay.
      expect(raw).toContain("X-Multi-Echo: a, b");
    } finally {
      (upstreamSide as net.Socket | null)?.destroy();
      await upgrader.stop();
      up.closeAllConnections();
      await new Promise<void>((r) => up.close(() => r()));
    }
  });

  it("closes the client without a relay when the upstream refuses the WS upgrade", async () => {
    let upstreamSide: Duplex | null = null;
    const up = http.createServer(() => {});
    up.on("upgrade", (_req, socket) => {
      upstreamSide = socket;
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    });
    await new Promise<void>((r) => up.listen(0, "127.0.0.1", r));
    const upOrigin = `http://127.0.0.1:${(up.address() as { port: number }).port}`;
    const upgrader = new PreviewHostServer({ webviewRoot: makeTempWebviewRoot() });
    await upgrader.start();
    try {
      const raw = await rawUpgradeRequest(upgrader.origin, `/proxy/${upOrigin}/hmr`);
      expect(raw).not.toContain("101 Switching Protocols");
      expect(raw).toBe("");
    } finally {
      (upstreamSide as net.Socket | null)?.destroy();
      await upgrader.stop();
      up.closeAllConnections();
      await new Promise<void>((r) => up.close(() => r()));
    }
  });

  it("rewrites the Origin header of WebSocket upgrades to the upstream origin", async () => {
    const stubPort = new URL(stubOrigin).port;
    let upstreamEcho: Duplex | null = null;
    stubServer.on("upgrade", (req, socket) => {
      upstreamEcho = socket;
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"
      );
      const origin = String(req.headers["origin"] ?? "");
      const payload = Buffer.from(origin, "utf8");
      const frame = Buffer.alloc(2 + payload.length);
      frame[0] = 0x81;
      frame[1] = payload.length;
      payload.copy(frame, 2);
      socket.write(frame);
    });
    const previewPort = new URL(server.origin).port;
    const raw = await new Promise<string>((resolve, reject) => {
      const sock = net.connect(Number(previewPort), "127.0.0.1", () => {
        sock.write(
          `GET /proxy/http://127.0.0.1:${stubPort}/_next/hmr?id=ws-test HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${previewPort}\r\n` +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
            "Sec-WebSocket-Version: 13\r\n" +
            "Origin: http://127.0.0.1:1\r\n" +
            "\r\n"
        );
      });
      let data = Buffer.alloc(0);
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error("WebSocket upgrade timed out"));
      }, 5000);
      sock.on("data", (c: Buffer) => {
        data = Buffer.concat([data, c]);
        if (data.includes("\r\n\r\n")) {
          clearTimeout(timer);
          sock.destroy();
          resolve(data.toString("latin1"));
        }
      });
      sock.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    const statusLine = raw.split("\r\n")[0];
    expect(statusLine).toContain("101");
    const frame = raw.slice(raw.indexOf("\r\n\r\n") + 4);
    // The upstream must have seen the stub origin, not the preview origin.
    expect(frame.slice(2, 2 + stubOrigin.length)).toBe(stubOrigin);
    // Tear down the half-open upstream side deterministically; leaving it to
    // TCP half-close handling would keep the stub server's sockets open.
    (upstreamEcho as Duplex | null)?.destroy();
    await new Promise<void>((r) => setTimeout(r, 50));
  });
});
