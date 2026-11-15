import * as http from "node:http";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { targetFromProxyPath, targetFromReferer, DS_SERVICE_WORKER, candidateLoopbackTargets } from "./proxy-html";
import { rewriteProxiedCss, rewriteProxiedHtml, HEADERS_TO_STRIP } from "./proxy-html";

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

/** Request headers that must not be forwarded verbatim to the upstream dev server. */
const REQUEST_HEADERS_TO_SKIP = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "content-length",
  "accept-encoding",
  "cf-connecting-ip",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

export interface PreviewHostServerOptions {
  webviewRoot: string;
  host?: string;
  /** Workspace root served under /project/ (project binding). */
  projectRoot?: string | null;
  /** Optional sink for compact proxy diagnostics (redirects, 4xx, 5xx). */
  trace?: (line: string) => void;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

/** Replace or inject the Design Studio runtime script into project HTML. */
export function injectRuntimeIntoHtml(html: string, runtimeSrc: string): string {
  if (html.includes("/__ds-runtime.js")) return html;
  const tag = `<script src="${runtimeSrc}"></script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}\n${tag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}\n${tag}`);
  }
  return `${tag}\n${html}`;
}

export type ProjectPathResolution =
  | { ok: true; filePath: string }
  | { ok: false; reason: "forbidden" | "encoding" };

/** Resolve a project-relative request path inside the project root jail. */
export function resolveProjectPath(projectRoot: string, relativePathRaw: string): ProjectPathResolution {
  let relativePath: string;
  try {
    relativePath = relativePathRaw ? decodeURIComponent(relativePathRaw) : "index.html";
  } catch {
    return { ok: false, reason: "encoding" };
  }
  const rootResolved = path.resolve(projectRoot);
  const resolved = path.resolve(rootResolved, relativePath);
  const rel = path.relative(rootResolved, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, filePath: resolved };
}

export class PreviewHostServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly host: string;
  private readonly webviewRoot: string;
  private readonly trace: (line: string) => void;
  private projectRoot: string | null = null;

  constructor(options: PreviewHostServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.webviewRoot = options.webviewRoot;
    this.projectRoot = options.projectRoot ?? null;
    this.trace = options.trace ?? (() => {});
  }

  setProjectRoot(root: string | null): void {
    this.projectRoot = root;
  }

  private devTarget: string | null = null;

  /**
   * Sticky dev-server target: after a hard navigation the document URL loses
   * the /proxy/ prefix, so Referer no longer identifies the upstream. The
   * extension sets the dev-server URL here and bare paths keep working.
   */
  setDevTarget(target: string | null): void {
    if (!target) {
      this.devTarget = null;
      return;
    }
    try {
      const parsed = new URL(target);
      this.devTarget = parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
    } catch {
      this.devTarget = null;
    }
  }

  /** Target of a bare-path request: explicit /proxy/, else Referer, else sticky dev target. */
  private barePathTarget(req: http.IncomingMessage, rawUrl: string): string | null {
    const explicit = targetFromProxyPath(rawUrl);
    if (explicit) return explicit;
    const fromReferer = targetFromReferer(req.headers.referer, rawUrl);
    if (fromReferer) return fromReferer;
    if (!this.devTarget) return null;
    try {
      // devTarget is an origin-only URL: resolve the request path against it.
      return new URL(rawUrl, this.devTarget).toString();
    } catch {
      return null;
    }
  }

  get origin(): string {
    return `http://${this.host}:${this.port}`;
  }

  get running(): boolean {
    return this.server !== null;
  }

  async start(): Promise<number> {
    if (this.server) return this.port;
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        }
        res.end("Design Studio preview host error");
      });
    });
    server.on("upgrade", (req, socket) => {
      this.handleUpgrade(req, socket as net.Socket).catch(() => socket.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, this.host, () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("PreviewHostServer: unexpected address");
    }
    this.port = address.port;
    this.server = server;
    return this.port;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    this.port = 0;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private serveFile(res: http.ServerResponse, fileName: string, contentType: string): void {
    const filePath = path.join(this.webviewRoot, fileName);
    let content: Buffer;
    try {
      content = fs.readFileSync(filePath);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Missing file: ${fileName}. Run npm run build.`);
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    });
    res.end(content);
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const allowed = method === "GET" || method === "HEAD" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE" || method === "OPTIONS";
    if (!allowed) {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }
    const urlPath = (req.url ?? "/").split("?")[0];

    if (urlPath.startsWith("/proxy/")) {
      await this.handleProxy(req, res);
      return;
    }
    // The request body must be consumed before a response is written; check
    // first whether a bare-path non-GET request can be proxied via the
    // proxied document URL in Referer or the sticky dev target.
    if (method !== "GET" && method !== "HEAD") {
      const bareTarget = this.barePathTarget(req, req.url ?? "/");
      if (bareTarget) {
        await this.handleProxy(req, res, bareTarget);
        return;
      }
      this.trace(`[bare] ${method} ${urlPath} -> 405 (no proxy target; referer=${req.headers.referer ?? "-"}, sticky=${this.devTarget ?? "-"})`);
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }

    if (urlPath === "/demo.html") {
      this.serveFile(res, "demo.html", "text/html; charset=utf-8");
      return;
    }
    if (urlPath === "/__ds-runtime.js") {
      this.serveFile(res, "runtime.js", "application/javascript; charset=utf-8");
      return;
    }
    if (urlPath === "/__ds-sw.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Service-Worker-Allowed": "/",
        "Cache-Control": "no-store",
      });
      res.end(DS_SERVICE_WORKER);
      return;
    }
    if (urlPath === "/project/" || urlPath === "/project") {
      this.handleProjectFile(res, "");
      return;
    }
    if (urlPath.startsWith("/project/")) {
      this.handleProjectFile(res, urlPath.slice("/project/".length));
      return;
    }
    // Browser-initiated references that bypassed /proxy/ rewriting (SPA router
    // fetches, hard navigations, HMR websocket handshakes) hit bare paths on
    // this origin; proxy them upstream via Referer or the sticky dev target.
    const refererTarget = this.barePathTarget(req, req.url ?? "/");
    if (refererTarget) {
      await this.handleProxy(req, res, refererTarget);
      return;
    }
    this.trace(`[bare] GET ${urlPath} -> 404 (no proxy target; referer=${req.headers.referer ?? "-"}, sticky=${this.devTarget ?? "-"})`);
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }

  private handleProjectFile(res: http.ServerResponse, relativePathRaw: string): void {
    if (!this.projectRoot) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("No project bound to preview host");
      return;
    }
    const resolution = resolveProjectPath(this.projectRoot, relativePathRaw);
    if (!resolution.ok) {
      res.writeHead(resolution.reason === "encoding" ? 400 : 403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(resolution.reason === "encoding" ? "Invalid project path encoding" : "Forbidden path");
      return;
    }
    const resolved = resolution.filePath;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        const index = path.join(resolved, "index.html");
        if (fs.existsSync(index)) {
          this.serveProjectPath(res, index);
          return;
        }
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Directory has no index.html");
        return;
      }
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Not found in project: ${relativePathRaw}`);
      return;
    }
    this.serveProjectPath(res, resolved);
  }

  private serveProjectPath(res: http.ServerResponse, filePath: string): void {
    let content: Buffer;
    try {
      content = fs.readFileSync(filePath);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Not found in project: ${this.projectRoot ? path.relative(this.projectRoot, filePath) : filePath}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    if (ext === ".html" && contentType.startsWith("text/html")) {
      const injected = injectRuntimeIntoHtml(content.toString("utf8"), "/__ds-runtime.js");
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
      res.end(injected);
      return;
    }
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    res.end(content);
  }

  private async readBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
    const chunk = await new Promise<Buffer | null>((resolve) => {
      let size = 0;
      const parts: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_REQUEST_BODY_BYTES) {
          req.destroy();
          resolve(null);
          return;
        }
        parts.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(parts)));
      req.on("error", () => resolve(null));
    });
    return chunk ?? undefined;
  }

  /**
   * Forward the browser's request headers to the dev server: cookies, RSC and
   * router state headers, content-type, etc. Origin/Referer are re-pointed at
   * the upstream origin so server-action CSRF/Origin checks keep passing.
   */
  private buildForwardHeaders(req: http.IncomingMessage, target: URL): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (REQUEST_HEADERS_TO_SKIP.has(key)) continue;
      headers[key] = Array.isArray(value) ? value.join(", ") : (value ?? "");
    }
    const upstreamOrigin = target.origin;
    if (headers["origin"]) headers["origin"] = upstreamOrigin;
    if (headers["referer"]) {
      try {
        const ref = new URL(headers["referer"]);
        headers["referer"] = `${upstreamOrigin}${ref.pathname}${ref.search}`;
      } catch {
        // keep as-is
      }
    }
    return headers;
  }

  private async fetchWithFallbacks(
    target: string,
    method: string,
    headers: Record<string, string>,
    body?: Buffer
  ): Promise<{ upstream: Response | null; errors: { url: string; message: string }[] }> {
    const candidates = candidateLoopbackTargets(target);
    const errors: { url: string; message: string }[] = [];
    for (const candidate of candidates) {
      try {
        const upstream = await fetch(candidate, {
          method: method === "HEAD" ? "HEAD" : method,
          redirect: "manual",
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers,
          body: method === "GET" || method === "HEAD" ? undefined : body ? new Uint8Array(body) : undefined,
        });
        return { upstream, errors };
      } catch (err) {
        const cause = (err as { cause?: { code?: string; message?: string } }).cause;
        const detail = [err instanceof Error ? err.message : String(err), cause?.code, cause?.message]
          .filter((p): p is string => typeof p === "string" && p.length > 0)
          .join(" ");
        errors.push({ url: candidate, message: detail });
      }
    }
    return { upstream: null, errors };
  }

  /** Rewrite a 3xx Location so the browser stays on the preview origin. */
  private rewriteLocation(location: string | undefined, target: URL): string | undefined {
    if (!location) return undefined;
    try {
      const u = new URL(location, target);
      if (u.protocol !== "http:" && u.protocol !== "https:") return location;
      if (u.origin !== target.origin) return u.toString();
      return `${this.origin}/proxy/${u.toString()}`;
    } catch {
      return location;
    }
  }

  private async handleProxy(req: http.IncomingMessage, res: http.ServerResponse, targetOverride?: string): Promise<void> {
    const target = targetOverride ?? targetFromProxyPath(req.url ?? "");
    if (!target) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid proxy target");
      return;
    }
    const method = req.method === "HEAD" ? "HEAD" : (req.method ?? "GET");
    const body = method === "GET" || method === "HEAD" ? undefined : await this.readBody(req);
    if (body === undefined && method !== "GET" && method !== "HEAD" && !res.writableEnded) {
      // request body overflowed — the socket was destroyed by readBody
      return;
    }
    let parsedTarget: URL;
    try {
      parsedTarget = new URL(target);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid proxy target");
      return;
    }
    const forwardHeaders = this.buildForwardHeaders(req, parsedTarget);
    const { upstream, errors } = await this.fetchWithFallbacks(target, method, forwardHeaders, body);
    if (!upstream) {
      this.trace(`[proxy] ${method} ${target} -> 502 (${errors.map((e) => `${e.url}: ${e.message}`).join("; ")})`);
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        `Preview host could not reach ${target}.\n` +
          errors.map((e, i) => `Attempt ${i + 1} (${e.url}): ${e.message}`).join("\n")
      );
      return;
    }

    const headers: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      if (!HEADERS_TO_STRIP.includes(key as (typeof HEADERS_TO_STRIP)[number])) {
        headers[key] = value;
      }
    });
    // Forward the full cookie list (forEach collapses multiple Set-Cookie headers).
    const setCookies = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
    delete headers["set-cookie"];

    const status = upstream.status;
    if (status >= 300) {
      this.trace(`[proxy] ${method} ${target} -> ${status} loc=${headers["location"] ?? "-"} action-redirect=${headers["x-action-redirect"] ?? "-"} type=${headers["content-type"] ?? "-"}`);
    }
    // 3xx: pass through with a proxied Location so the browser stays on this origin.
    if (status >= 300 && status < 400) {
      const location = this.rewriteLocation(headers["location"], parsedTarget);
      if (location) headers["location"] = location;
      if (setCookies.length > 0) res.setHeader("Set-Cookie", setCookies);
      res.writeHead(status, headers);
      if (method === "HEAD") {
        res.end();
        return;
      }
      // Next.js server-action responses are 303 with an x-action-redirect
      // header and an RSC flight body the client must read (no Location at
      // all); dropping the body makes React fail with "Connection closed".
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length > MAX_RESPONSE_BYTES) {
        res.destroy();
        return;
      }
      res.end(buf);
      return;
    }

    const finalTarget = upstream.url || target;
    const contentType = headers["content-type"] ?? "application/octet-stream";
    delete headers["location"];

    if (/^text\/html/i.test(contentType) && method !== "HEAD") {
      const buf = Buffer.from(await upstream.arrayBuffer());
      const html = buf.subarray(0, MAX_RESPONSE_BYTES).toString("utf8");
      const rewritten = rewriteProxiedHtml(html, finalTarget, `${this.origin}/__ds-runtime.js`, this.origin);
      headers["content-type"] = "text/html; charset=utf-8";
      headers["cache-control"] = "no-store";
      if (setCookies.length > 0) res.setHeader("Set-Cookie", setCookies);
      res.writeHead(status, headers);
      res.end(rewritten);
      return;
    }
    if (/^text\/css/i.test(contentType) && method !== "HEAD") {
      const buf = Buffer.from(await upstream.arrayBuffer());
      const css = buf.subarray(0, MAX_RESPONSE_BYTES).toString("utf8");
      headers["cache-control"] = "no-store";
      res.writeHead(status, headers);
      if (setCookies.length > 0) res.setHeader("Set-Cookie", setCookies);
      res.end(rewriteProxiedCss(css, finalTarget));
      return;
    }

    if (setCookies.length > 0) res.setHeader("Set-Cookie", setCookies);
    res.writeHead(status, headers);
    if (method === "HEAD") {
      res.end();
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_RESPONSE_BYTES) {
      res.destroy();
      return;
    }
    res.end(buf);
  }

  private async handleUpgrade(req: http.IncomingMessage, socket: net.Socket): Promise<void> {
    const raw = req.url ?? "";
    const target = this.barePathTarget(req, raw);
    if (!target) {
      socket.destroy();
      return;
    }
    let parsedTarget: URL;
    try {
      parsedTarget = new URL(target);
    } catch {
      socket.destroy();
      return;
    }
    const host = parsedTarget.hostname;
    const port = parsedTarget.port !== "" ? Number(parsedTarget.port) : 80;
    const upstreamSocket = net.connect(port, host, () => {
      const headers = [`${req.method} ${parsedTarget.pathname}${parsedTarget.search} HTTP/1.1`];
      for (const [key, value] of Object.entries(req.headers)) {
        if (key === "host") continue;
        if (typeof value === "string") headers.push(`${key}: ${value}`);
      }
      headers.push(`Host: ${parsedTarget.host}`);
      upstreamSocket.write(headers.join("\r\n") + "\r\n\r\n");
    });
    let headerBuffer = Buffer.alloc(0);
    let headersForwarded = false;
    upstreamSocket.on("data", (chunk: Buffer) => {
      if (!headersForwarded) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        const idx = headerBuffer.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const statusLine = headerBuffer.toString("latin1", 0, headerBuffer.indexOf("\r\n"));
        if (!/101/.test(statusLine)) {
          socket.destroy();
          upstreamSocket.destroy();
          return;
        }
        socket.write(headerBuffer);
        headersForwarded = true;
        return;
      }
      socket.write(chunk);
    });
    socket.on("data", (chunk) => upstreamSocket.write(chunk));
    upstreamSocket.on("close", () => socket.destroy());
    socket.on("close", () => upstreamSocket.destroy());
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("error", () => upstreamSocket.destroy());
  }
}
