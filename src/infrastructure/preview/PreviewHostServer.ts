import * as http from "node:http";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { targetFromProxyPath, DS_SERVICE_WORKER } from "./proxy-html";
import { rewriteProxiedCss, rewriteProxiedHtml, HEADERS_TO_STRIP } from "./proxy-html";

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export interface PreviewHostServerOptions {
  webviewRoot: string;
  host?: string;
}

export class PreviewHostServer {
  private server: http.Server | null = null;
  private port = 0;
  private readonly host: string;
  private readonly webviewRoot: string;

  constructor(options: PreviewHostServerOptions) {
    this.host = options.host ?? "127.0.0.1";
    this.webviewRoot = options.webviewRoot;
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
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }
    const urlPath = (req.url ?? "/").split("?")[0];

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
    if (urlPath.startsWith("/proxy/")) {
      await this.handleProxy(req, res);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }

  private async handleProxy(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const target = targetFromProxyPath(req.url ?? "");
    if (!target) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid proxy target");
      return;
    }
    let upstream: Response;
    try {
      upstream = await fetch(target, {
        method: req.method === "HEAD" ? "HEAD" : "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { "user-agent": req.headers["user-agent"] ?? "design-studio-preview", accept: req.headers.accept ?? "*/*" },
      });
    } catch {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Preview host could not reach ${target}`);
      return;
    }

    const headers: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      if (!HEADERS_TO_STRIP.includes(key as (typeof HEADERS_TO_STRIP)[number])) {
        headers[key] = value;
      }
    });

    const finalTarget = upstream.url || target;
    const contentType = headers["content-type"] ?? "application/octet-stream";

    if (/^text\/html/i.test(contentType) && req.method !== "HEAD") {
      const buf = Buffer.from(await upstream.arrayBuffer());
      const html = buf.subarray(0, MAX_RESPONSE_BYTES).toString("utf8");
      const rewritten = rewriteProxiedHtml(html, finalTarget, `${this.origin}/__ds-runtime.js`, this.origin);
      headers["content-type"] = "text/html; charset=utf-8";
      headers["cache-control"] = "no-store";
      res.writeHead(upstream.status, headers);
      res.end(rewritten);
      return;
    }
    if (/^text\/css/i.test(contentType) && req.method !== "HEAD") {
      const buf = Buffer.from(await upstream.arrayBuffer());
      const css = buf.subarray(0, MAX_RESPONSE_BYTES).toString("utf8");
      headers["cache-control"] = "no-store";
      res.writeHead(upstream.status, headers);
      res.end(rewriteProxiedCss(css, finalTarget));
      return;
    }

    res.writeHead(upstream.status, headers);
    if (req.method === "HEAD") {
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
    const target = targetFromProxyPath(raw);
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
