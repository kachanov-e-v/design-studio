import * as http from "node:http";
import * as net from "node:net";
import * as tls from "node:tls";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { targetFromProxyPath, targetFromReferer, DS_SERVICE_WORKER, candidateLoopbackTargets, proxyPathFor, injectIntoHtml, prependProxyOriginToPathUrls } from "./proxy-html";
import { rewriteProxiedCss, rewriteProxiedHtml, HEADERS_TO_STRIP } from "./proxy-html";
import { validateUpstreamTarget } from "./upstream-validation";

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const WS_CONNECT_TIMEOUT_MS = 5_000;

/**
 * Read a whole upstream body into memory, refusing oversized responses instead
 * of silently truncating them. Returns null when the cap is hit or the body
 * errors mid-stream.
 */
async function readCappedBody(body: ReadableStream<Uint8Array> | null, cap: number): Promise<Buffer | null> {
  if (!body) return Buffer.alloc(0);
  const readable = Readable.fromWeb(body as never);
  return await new Promise<Buffer | null>((resolve) => {
    const parts: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (result: Buffer | null) => {
      if (settled) return;
      settled = true;
      readable.destroy();
      resolve(result);
    };
    readable.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > cap) {
        finish(null);
        return;
      }
      parts.push(Buffer.from(chunk));
    });
    readable.on("end", () => finish(Buffer.concat(parts)));
    readable.on("error", () => finish(null));
  });
}

/**
 * Host-side cookie jar for the upstream application.
 *
 * The preview page is a cross-site iframe inside a VS Code webview, so browser
 * cookie storage cannot be relied on to keep the app session alive (SameSite,
 * partitioned/third-party cookie policies). Cookies received from the dev
 * server are stored here and re-attached to every proxied request, so
 * authorization survives navigation inside the preview session.
 */
interface JarCookie {
  value: string;
  /** Epoch ms, or null for session cookies. */
  expiresAt: number | null;
}

/** Scope upstream cookies to the local preview origin so app sessions survive navigation. */
function rewriteSetCookieForPreview(cookie: string): string {
  const [pair, ...rawAttributes] = cookie.split(";");
  if (!pair?.trim()) return cookie;

  let hasPath = false;
  const attributes = rawAttributes.flatMap((rawAttribute) => {
    const attribute = rawAttribute.trim();
    if (/^domain\s*=/i.test(attribute)) return [];
    if (/^path\s*=/i.test(attribute)) {
      hasPath = true;
      return ["Path=/"];
    }
    return attribute ? [attribute] : [];
  });

  if (!hasPath) attributes.unshift("Path=/");
  return [pair.trim(), ...attributes].join("; ");
}

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
  /** Proxy payload byte cap (tests shrink it; default 20 MiB). */
  maxResponseBytes?: number;
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

export type ProjectPathResolution =
  | { ok: true; filePath: string }
  | { ok: false; reason: "forbidden" | "encoding" };

/**
 * Resolve a project-relative request path inside the project root jail.
 * The canonical check re-resolves the deepest existing ancestor through the
 * filesystem, so a symlink/junction inside the workspace cannot redirect the
 * read outside the jail.
 */
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
  // Never expose secrets or VCS/module metadata through /project/, even when
  // a project legitimately keeps them inside the served folder.
  const segments = relativePath.split(/[\\/]+/).filter((s) => s.length > 0).map((s) => s.toLowerCase());
  const base = segments[segments.length - 1] ?? "";
  if (segments.includes(".git") || segments.includes("node_modules") || base === ".env" || /^\.env[.\-_]/.test(base)) {
    return { ok: false, reason: "forbidden" };
  }
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(rootResolved);
  } catch {
    return { ok: false, reason: "forbidden" };
  }
  let existing = resolved;
  let real: string;
  for (;;) {
    try {
      real = fs.realpathSync(existing);
      break;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return { ok: false, reason: "forbidden" };
      existing = parent;
    }
  }
  const realRel = path.relative(rootReal, real);
  const tail = path.relative(existing, resolved);
  const escapedReal = realRel !== "" && (path.isAbsolute(realRel) || realRel.replace(/\\/g, "/").startsWith("../"));
  if (escapedReal || (realRel === "" && !tail)) {
    return { ok: false, reason: "forbidden" };
  }
  // Everything between `existing` and `resolved` is plain path segments below
  // the verified ancestor, so joining them onto the canonical ancestor is safe.
  return { ok: true, filePath: tail ? path.join(real, tail) : real };
}

export class PreviewHostServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly host: string;
  private readonly webviewRoot: string;
  private readonly trace: (line: string) => void;
  private readonly maxResponseBytes: number;
  private projectRoot: string | null = null;

  constructor(options: PreviewHostServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.webviewRoot = options.webviewRoot;
    this.projectRoot = options.projectRoot ?? null;
    this.maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES;
    this.trace = options.trace ?? (() => {});
  }

  setProjectRoot(root: string | null): void {
    this.projectRoot = root;
  }

  private devTarget: string | null = null;
  /** Keys are `${upstreamOrigin}|${cookieName}`: cookies never leak across loopback origins/ports. */
  private cookieJar = new Map<string, JarCookie>();
  /** Hijacked WebSocket sockets: closed() waits on them unless torn down. */
  private upgradedSockets = new Set<net.Socket>();
  private acceptedSockets = new Set<net.Socket>();

  /** Sticky dev-server target lets app routes stay at the preview origin's root. */
  setDevTarget(target: string | null): void {
    const previous = this.devTarget;
    if (!target) {
      this.devTarget = null;
      this.cookieJar.clear();
      return;
    }
    try {
      const parsed = new URL(target);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:") && validateUpstreamTarget(parsed).ok) {
        this.devTarget = parsed.origin;
        // A different upstream starts a fresh preview session: drop its cookies.
        if (previous !== this.devTarget) this.cookieJar.clear();
        return;
      }
    } catch {
      // fall through to rejection
    }
    this.trace(`[dev-target] rejected non-loopback or invalid target: ${target}`);
    this.devTarget = null;
    this.cookieJar.clear();
  }

  /** Target of an explicit proxy route, referer-based request, or app route. */
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

  /**
   * The only allowed Host is this server's own loopback origin. Anything else
   * (a rebound domain resolving to 127.0.0.1, another loopback service's name)
   * is refused, so the preview host cannot be abused as an open proxy for
   * cross-origin request forgery or DNS rebinding.
   */
  private hostAllowed(rawHost: string | undefined): boolean {
    if (!rawHost) return false;
    const host = rawHost.toLowerCase().trim();
    return host === `${this.host}:${this.port}` || host === `localhost:${this.port}` || host === `[::1]:${this.port}`;
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
    // Track every accepted socket: closeAllConnections() skips sockets that
    // were detached for a WebSocket upgrade, so stop() must destroy them
    // through its own registry to guarantee that close() fires.
    server.on("connection", (socket) => {
      this.acceptedSockets.add(socket);
      socket.once("close", () => this.acceptedSockets.delete(socket));
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
    // http.Server.close() only stops accepting new connections; hijacked
    // upgrade sockets and idle keep-alive connections must be torn down
    // explicitly or close() never fires.
    for (const socket of this.upgradedSockets) socket.destroy();
    this.upgradedSockets.clear();
    for (const socket of this.acceptedSockets) socket.destroy();
    this.acceptedSockets.clear();
    server.closeIdleConnections();
    server.closeAllConnections();
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
    if (!this.hostAllowed(req.headers.host)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden Host header");
      return;
    }
    const method = req.method ?? "GET";
    const allowed = method === "GET" || method === "HEAD" || method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE" || method === "OPTIONS";
    if (!allowed) {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }
    const urlPath = (req.url ?? "/").split("?")[0];

    if (urlPath.startsWith("/proxy/")) {
      const proxiedTarget = targetFromProxyPath(req.url ?? "");
      const accept = req.headers.accept ?? "";
      if (method === "GET" && accept.includes("text/html") && proxiedTarget && this.devTarget) {
        try {
          const target = new URL(proxiedTarget);
          if (target.origin === this.devTarget) {
            // Keep app routers and auth libraries on the real route instead
            // of exposing the internal proxy transport path in window.location.
            res.writeHead(307, {
              Location: `${this.origin}${target.pathname}${target.search}`,
              "Cache-Control": "no-store",
            });
            res.end();
            return;
          }
        } catch {
          // Let handleProxy return the standard invalid-target response.
        }
      }
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
    // The project is hosted on bare paths so client-side routers see the real
    // app route (for example /login) instead of a /proxy/... URL prefix.
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
  /** The document URL prefix for /project/ pages: origin + /project/ + page directory. */
  private projectBaseHrefFor(filePath: string): string {
    const rel = this.projectRoot ? path.relative(this.projectRoot, filePath) : path.basename(filePath);
    const posixRel = rel.split(path.sep).join("/");
    let dir = path.posix.dirname(posixRel);
    if (dir === "." || dir === "/") dir = "";
    const encoded = dir.split("/").filter((s) => s.length > 0).map(encodeURIComponent).join("/");
    return `${this.origin}/project/${encoded ? `${encoded}/` : ""}`;
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
      let htmlContent = content.toString("utf8");
      // Single injection point for project pages: base + runtime + authored
      // <base> respect live in injectIntoHtml (P0-2 guard lives in the runtime).
      // The upstream origin is the preview origin itself: all /project/ links
      // are same-origin, dangerous schemes stay blocked.
      htmlContent = injectIntoHtml(htmlContent, "/__ds-runtime.js", this.projectBaseHrefFor(filePath), {
        respectAuthoredBase: true,
        upstreamOrigin: this.origin,
        parentOrigins: [this.origin],
      });
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
      res.end(htmlContent);
      return;
    }
    if (ext === ".css" && contentType.startsWith("text/css")) {
      const cssContent = content.toString("utf8");
      const rewritten = prependProxyOriginToPathUrls(cssContent, "/project");
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
      res.end(rewritten);
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
    const jarCookieHeader = this.buildCookieHeader(headers["cookie"], upstreamOrigin);
    if (jarCookieHeader) headers["cookie"] = jarCookieHeader;
    return headers;
  }

  private buildCookieHeader(browserCookie: string | undefined, upstreamOrigin: string): string | undefined {
    if (this.cookieJar.size === 0) return browserCookie;
    const prefix = `${upstreamOrigin}|`;
    const cookies = new Map<string, string>();
    for (const pair of (browserCookie ?? "").split(";")) {
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      if (name) cookies.set(name, pair.slice(eq + 1).trim());
    }
    const now = Date.now();
    for (const [key, entry] of this.cookieJar) {
      if (!key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length);
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this.cookieJar.delete(key);
        continue;
      }
      cookies.set(name, entry.value);
    }
    if (cookies.size === 0) return undefined;
    return Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ");
  }

  private rememberSetCookie(rawCookie: string, upstreamOrigin: string): void {
    const eq = rawCookie.indexOf("=");
    const semi = rawCookie.indexOf(";");
    if (eq === -1) return;
    const name = rawCookie.slice(0, eq).trim();
    if (!name) return;
    const key = `${upstreamOrigin}|${name}`;
    const valueEnd = semi === -1 ? rawCookie.length : semi;
    const value = rawCookie.slice(eq + 1, valueEnd).trim();
    const attributes = rawCookie.slice(valueEnd);
    let expiresAt: number | null = null;
    const maxAge = /max-age\s*=\s*(-?\d+)/i.exec(attributes);
    if (maxAge) {
      const seconds = Number(maxAge[1]);
      if (seconds <= 0) {
        this.cookieJar.delete(key);
        return;
      }
      expiresAt = Date.now() + seconds * 1000;
    } else {
      const expires = /expires\s*=\s*([^;]+)/i.exec(attributes);
      if (expires) {
        const parsed = Date.parse(expires[1].trim());
        if (Number.isNaN(parsed)) {
          expiresAt = null;
        } else if (parsed <= Date.now()) {
          this.cookieJar.delete(key);
          return;
        } else {
          expiresAt = parsed;
        }
      }
    }
    this.cookieJar.set(key, { value, expiresAt });
  }

  private rememberSetCookies(cookies: string[], upstreamOrigin: string): void {
    for (const cookie of cookies) this.rememberSetCookie(cookie, upstreamOrigin);
  }

  private async fetchWithFallbacks(
    target: string,
    method: string,
    headers: Record<string, string>,
    body?: Buffer
  ): Promise<{ upstream: Response | null; errors: { url: string; message: string }[]; abortUpstream: () => void }> {
    const candidates = candidateLoopbackTargets(target);
    const errors: { url: string; message: string }[] = [];
    for (const candidate of candidates) {
      const controller = new AbortController();
      // The timeout covers connection setup and response headers only: SSE,
      // streaming SSR and long-poll bodies may stay open indefinitely and are
      // bounded by the proxy byte cap instead.
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const upstream = await fetch(candidate, {
          method: method === "HEAD" ? "HEAD" : method,
          redirect: "manual",
          signal: controller.signal,
          headers,
          body: method === "GET" || method === "HEAD" ? undefined : body ? new Uint8Array(body) : undefined,
        });
        clearTimeout(timer);
        return { upstream, errors, abortUpstream: () => controller.abort() };
      } catch (err) {
        clearTimeout(timer);
        const cause = (err as { cause?: { code?: string; message?: string } }).cause;
        const detail = [err instanceof Error ? err.message : String(err), cause?.code, cause?.message]
          .filter((p): p is string => typeof p === "string" && p.length > 0)
          .join(" ");
        errors.push({ url: candidate, message: detail });
      }
    }
    return { upstream: null, errors, abortUpstream: () => {} };
  }

  /** Rewrite a 3xx Location so the browser stays on this origin. Cross-origin
   * hops are routed back through the proxy path (re-validated there) instead of
   * being handed to the browser as a raw external URL. */
  private rewriteLocation(location: string | undefined, target: URL): string | undefined {
    if (!location) return undefined;
    try {
      const u = new URL(location, target);
      if (u.protocol !== "http:" && u.protocol !== "https:") return location;
      if (u.origin !== target.origin) {
        // Cross-origin redirects stay inside the preview only when the target
        // is another loopback server. External locations (e.g. OAuth providers)
        // are left untouched: the browser follows them natively and the app's
        // callback returns to the local origin afterwards. Rewriting them into
        // proxy routes would trip the SSRF gate and render a raw 403 page.
        if (!validateUpstreamTarget(u).ok) return location;
        return proxyPathFor(u.toString());
      }
      return `${this.origin}${u.pathname}${u.search}${u.hash}`;
    } catch {
      return location;
    }
  }

  /** Keep Next.js server-action redirects on the preview host and route. */
  private rewriteActionRedirect(value: string | undefined, target: URL): string | undefined {
    if (!value) return undefined;
    const match = /^(.*?);(push|replace)$/i.exec(value);
    const rawUrl = match?.[1] ?? value;
    const navigationMode = match ? `;${match[2]}` : "";
    try {
      const url = new URL(rawUrl, target);
      if (url.origin === target.origin) {
        return `${url.pathname}${url.search}${url.hash}${navigationMode}`;
      }
      // External (non-loopback) action redirects navigate the frame natively;
      // see rewriteLocation for the policy.
      if (!validateUpstreamTarget(url).ok) return value;
      return `${proxyPathFor(url.toString())}${navigationMode}`;
    } catch {
      return value;
    }
  }

  private async handleProxy(req: http.IncomingMessage, res: http.ServerResponse, targetOverride?: string): Promise<void> {
    const target = targetOverride ?? targetFromProxyPath(req.url ?? "");
    if (!target) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid proxy target");
      return;
    }
    // SSRF gate: only loopback upstreams are ever fetched, no matter how the
    // target arrived (explicit proxy route, Referer, sticky dev target).
    const validation = validateUpstreamTarget(target);
    if (!validation.ok) {
      this.trace(`[proxy] blocked ${validation.reason} target: ${target}`);
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(
        `Destination not supported in preview (${validation.reason}): ${target}\n` +
        "Design Studio proxies only local (loopback) dev servers. External services reached via redirect open outside the preview frame."
      );
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
    const { upstream, errors, abortUpstream } = await this.fetchWithFallbacks(target, method, forwardHeaders, body);
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
    // Remember the app session in the host-side jar: browser cookie storage is
    // unreliable for a cross-site iframe inside a VS Code webview.
    const upstreamCookies =
      typeof upstream.headers.getSetCookie === "function"
        ? upstream.headers.getSetCookie()
        : upstream.headers.get("set-cookie")
          ? [upstream.headers.get("set-cookie")!]
          : [];
    this.rememberSetCookies(upstreamCookies, parsedTarget.origin);
    const setCookies = upstreamCookies.map(rewriteSetCookieForPreview);
    delete headers["set-cookie"];

    const status = upstream.status;
    if (status >= 300) {
      this.trace(`[proxy] ${method} ${target} -> ${status} loc=${headers["location"] ?? "-"} action-redirect=${headers["x-action-redirect"] ?? "-"} type=${headers["content-type"] ?? "-"}`);
    }
    // 3xx: pass through with a proxied Location so the browser stays on this origin.
    if (status >= 300 && status < 400) {
      const location = this.rewriteLocation(headers["location"], parsedTarget);
      if (location) headers["location"] = location;
      const actionRedirect = this.rewriteActionRedirect(headers["x-action-redirect"], parsedTarget);
      if (actionRedirect) headers["x-action-redirect"] = actionRedirect;
      if (setCookies.length > 0) res.setHeader("Set-Cookie", setCookies);
      res.writeHead(status, headers);
      if (method === "HEAD") {
        res.end();
        return;
      }
      // Next.js server-action responses are 303 with an x-action-redirect
      // header and an RSC flight body the client must read (no Location at
      // all); dropping the body makes React fail with "Connection closed".
      const buf = await readCappedBody(upstream.body, this.maxResponseBytes);
      if (buf === null) {
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
      const buf = await readCappedBody(upstream.body, this.maxResponseBytes);
      if (buf === null) {
        // Headers not sent yet, so an honest 502 beats silently truncated HTML.
        this.trace(`[proxy] ${method} ${target} -> 502 (body exceeds byte cap)`);
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Response body exceeds the preview byte limit");
        return;
      }
      const html = buf.toString("utf8");
      const rewritten = rewriteProxiedHtml(html, finalTarget, `${this.origin}/__ds-runtime.js`, this.origin);
      headers["content-type"] = "text/html; charset=utf-8";
      headers["cache-control"] = "no-store";
      if (setCookies.length > 0) res.setHeader("Set-Cookie", setCookies);
      res.writeHead(status, headers);
      res.end(rewritten);
      return;
    }
    if (/^text\/css/i.test(contentType) && method !== "HEAD") {
      const buf = await readCappedBody(upstream.body, this.maxResponseBytes);
      if (buf === null) {
        this.trace(`[proxy] ${method} ${target} -> 502 (body exceeds byte cap)`);
        res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Response body exceeds the preview byte limit");
        return;
      }
      const css = buf.toString("utf8");
      headers["cache-control"] = "no-store";
      // Set-Cookie must be registered before writeHead; after it Node throws
      // ERR_HTTP_HEADERS_SENT and the outer catch would append an error body.
      if (setCookies.length > 0) res.setHeader("Set-Cookie", setCookies);
      res.writeHead(status, headers);
      res.end(rewriteProxiedCss(css, finalTarget));
      return;
    }

    if (setCookies.length > 0) res.setHeader("Set-Cookie", setCookies);
    res.writeHead(status, headers);
    if (method === "HEAD") {
      res.end();
      return;
    }
    // Everything else streams through untouched, capped by bytes: SSE,
    // streaming SSR, long-poll and binaries stay live instead of buffering.
    res.on("close", () => abortUpstream());
    const streamed = await this.streamUpstreamBody(upstream, res);
    if (!streamed) {
      this.trace(`[proxy] ${method} ${finalTarget} -> destroyed (byte cap exceeded or upstream stream error)`);
    }
  }

  /** Pipe the upstream body to the client with a hard byte cap. Returns false
   * when the pipe was aborted (overflow or upstream error). */
  private async streamUpstreamBody(upstream: Response, res: http.ServerResponse): Promise<boolean> {
    if (!upstream.body) {
      res.end();
      return true;
    }
    const readable = Readable.fromWeb(upstream.body as never);
    const cap = this.maxResponseBytes;
    let sent = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, callback) {
        sent += chunk.length;
        if (sent > cap) {
          callback(new Error("Preview proxy response byte limit exceeded"));
          return;
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(readable, counter, res);
      return true;
    } catch {
      res.destroy();
      return false;
    }
  }

  private async handleUpgrade(req: http.IncomingMessage, socket: net.Socket): Promise<void> {
    if (!this.hostAllowed(req.headers.host)) {
      socket.destroy();
      return;
    }
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
    // SSRF gate for WebSocket upgrades as well.
    if (!validateUpstreamTarget(parsedTarget).ok) {
      this.trace(`[upgrade] blocked non-loopback target: ${target}`);
      socket.destroy();
      return;
    }
    const isTls = parsedTarget.protocol === "https:";
    const defaultPort = isTls ? 443 : 80;
    // URL.hostname keeps IPv6 literals bracketed; connect() needs the bare
    // address and the default port depends on the scheme.
    const rawHostname =
      parsedTarget.hostname.startsWith("[") && parsedTarget.hostname.endsWith("]")
        ? parsedTarget.hostname.slice(1, -1)
        : parsedTarget.hostname;
    const port = parsedTarget.port !== "" ? Number(parsedTarget.port) : defaultPort;
    this.trace(`[upgrade] ${parsedTarget.protocol}//${parsedTarget.host}${parsedTarget.pathname} -> ${isTls ? "tls" : "tcp"} connect to ${rawHostname}:${port}`);
    const upstreamSocket: net.Socket = isTls
      ? tls.connect({ port, host: rawHostname, servername: net.isIP(rawHostname) ? undefined : rawHostname }, () => {
          this.writeUpgradeRequest(upstreamSocket, req, parsedTarget);
        })
      : net.connect({ port, host: rawHostname }, () => {
          this.writeUpgradeRequest(upstreamSocket, req, parsedTarget);
        });
    // Fail fast when the upstream never completes the handshake.
    upstreamSocket.setTimeout(WS_CONNECT_TIMEOUT_MS, () => {
      this.trace(`[upgrade] connect timeout to ${rawHostname}:${port}`);
      upstreamSocket.destroy();
      socket.destroy();
    });
    let headerBuffer = Buffer.alloc(0);
    let headersForwarded = false;
    upstreamSocket.on("data", (chunk: Buffer) => {
      if (!headersForwarded) {
        headerBuffer = Buffer.concat([headerBuffer, chunk]);
        const idx = headerBuffer.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const statusLine = headerBuffer.toString("latin1", 0, headerBuffer.indexOf("\r\n"));
        // Exact 101 response code: a loose /101/ test would also match ids or
        // suffixes anywhere in the status line.
        if (!/^HTTP\/[\d.]{1,8} 101\b/i.test(statusLine)) {
          socket.destroy();
          upstreamSocket.destroy();
          return;
        }
        upstreamSocket.setTimeout(0);
        socket.write(headerBuffer);
        headersForwarded = true;
        return;
      }
      socket.write(chunk);
    });
    socket.on("data", (chunk) => upstreamSocket.write(chunk));
    this.upgradedSockets.add(socket);
    // Upgraded sockets may only signal a half-close ('end'): raw clients that
    // destroy their socket after a finished exchange never reach 'close' on
    // this side. Tear the relay down on either signal, in both directions.
    const dropAndTearDown = () => {
      this.upgradedSockets.delete(socket);
      upstreamSocket.destroy();
    };
    upstreamSocket.on("close", dropAndTearDown);
    upstreamSocket.on("end", dropAndTearDown);
    socket.on("close", () => {
      this.upgradedSockets.delete(socket);
      upstreamSocket.destroy();
    });
    socket.on("end", () => upstreamSocket.destroy());
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("error", () => upstreamSocket.destroy());
  }

  /** Re-write the browser's WebSocket handshake for the upstream: dev servers
   * reject upgrades whose Origin differs from the upstream host, and the
   * browser can only send the preview origin here. Repeated (list-valued)
   * headers such as Sec-WebSocket-Protocol are forwarded, not dropped. */
  private writeUpgradeRequest(upstreamSocket: net.Socket, req: http.IncomingMessage, parsedTarget: URL): void {
    const headers = [`${req.method ?? "GET"} ${parsedTarget.pathname}${parsedTarget.search} HTTP/1.1`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (key === "host" || key === "origin") continue;
      if (Array.isArray(value)) {
        for (const item of value) if (item) headers.push(`${key}: ${item}`);
      } else if (value) {
        headers.push(`${key}: ${value}`);
      }
    }
    headers.push(`Host: ${parsedTarget.host}`);
    headers.push(`Origin: ${parsedTarget.origin}`);
    upstreamSocket.write(headers.join("\r\n") + "\r\n\r\n");
  }
}
