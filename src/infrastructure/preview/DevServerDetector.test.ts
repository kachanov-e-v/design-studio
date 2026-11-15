import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import {
  devServerCandidatesFromPackageJson,
  detectDevServers,
  fingerprintServer,
  probePort,
  verifyProjectMatch,
  type HttpProbe,
} from "./DevServerDetector";

function pkg(scripts: Record<string, string>): string {
  return JSON.stringify({ name: "app", scripts });
}

const urls = (candidates: { url: string }[]) => candidates.map((c) => c.url);

describe("devServerCandidatesFromPackageJson", () => {
  it("maps next dev to port 3000", () => {
    expect(urls(devServerCandidatesFromPackageJson(pkg({ dev: "next dev" })))).toEqual([
      "http://localhost:3000",
    ]);
  });

  it("maps vite to port 5173", () => {
    expect(urls(devServerCandidatesFromPackageJson(pkg({ dev: "vite" })))).toEqual([
      "http://localhost:5173",
    ]);
  });

  it("maps react-scripts start to port 3000", () => {
    expect(urls(devServerCandidatesFromPackageJson(pkg({ start: "react-scripts start" })))).toEqual([
      "http://localhost:3000",
    ]);
  });

  it("parses explicit --port for vite", () => {
    expect(urls(devServerCandidatesFromPackageJson(pkg({ dev: "vite --port 4173" })))).toEqual([
      "http://localhost:4173",
    ]);
  });

  it("parses explicit -p for next dev", () => {
    expect(urls(devServerCandidatesFromPackageJson(pkg({ dev: "next dev -p 4100" })))).toEqual([
      "http://localhost:4100",
    ]);
  });

  it("explicit port takes precedence over the framework default", () => {
    const candidates = devServerCandidatesFromPackageJson(pkg({ dev: "next dev --port 5000" }));
    expect(candidates[0]?.script).toBe("dev");
    expect(urls(candidates)).toEqual(["http://localhost:5000"]);
  });

  it("deduplicates ports across scripts", () => {
    const candidates = devServerCandidatesFromPackageJson(
      pkg({ dev: "vite", build: "next dev -p 5173" })
    );
    // both scripts point at 5173, but only one candidate survives
    expect(urls(candidates).filter((u) => u === "http://localhost:5173")).toHaveLength(1);
  });

  it("resolves npm run references to the underlying dev tool", () => {
    expect(
      urls(
        devServerCandidatesFromPackageJson(
          pkg({ dev: "npm run start:next", "start:next": "next dev" })
        )
      )
    ).toEqual(["http://localhost:3000"]);
  });

  it("skips references to unknown scripts", () => {
    expect(devServerCandidatesFromPackageJson(pkg({ dev: "npm run missing" }))).toEqual([]);
  });

  it("suggests common ports for a generic dev script of an unknown tool", () => {
    const candidates = devServerCandidatesFromPackageJson(pkg({ dev: "my-static-server ." }));
    expect(urls(candidates).slice(0, 3)).toEqual([
      "http://localhost:3000",
      "http://localhost:5173",
      "http://localhost:8080",
    ]);
  });

  it("adds no fallback ports when there is no dev-like script", () => {
    const candidates = devServerCandidatesFromPackageJson(pkg({ build: "tsc" }));
    expect(candidates).toEqual([]);
  });

  it("returns nothing without dev scripts", () => {
    expect(devServerCandidatesFromPackageJson(pkg({}))).toEqual([]);
  });

  it("returns nothing for invalid JSON", () => {
    expect(devServerCandidatesFromPackageJson("not json {")).toEqual([]);
  });
});

describe("fingerprintServer", () => {
  const probe = (partial: Partial<HttpProbe>): HttpProbe => ({
    ok: true,
    status: 200,
    headers: {},
    body: "",
    ...partial,
  });

  it("recognizes vite by the injected client script", () => {
    expect(fingerprintServer(probe({ body: '<script src="/@vite/client"></script>' }))).toBe("vite");
  });

  it("recognizes next by x-powered-by or _next static refs", () => {
    expect(fingerprintServer(probe({ headers: { "x-powered-by": "Next.js 14" } }))).toBe("next");
    expect(fingerprintServer(probe({ body: '<script src="/_next/static/chunks/main.js">' }))).toBe("next");
  });

  it("recognizes astro and webpack fingerprints", () => {
    expect(fingerprintServer(probe({ headers: { "x-powered-by": "Astro v4" } }))).toBe("astro");
    expect(fingerprintServer(probe({ body: "src=\"/webpack-hmr\"" }))).toBe("webpack");
  });

  it("treats a plain HTTP response without fingerprints as static-http", () => {
    expect(fingerprintServer(probe({ body: "<!DOCTYPE html><html><body>hi</body></html>" }))).toBe("static-http");
  });

  it("treats a failed HTTP probe as unknown", () => {
    expect(fingerprintServer(probe({ ok: false, headers: {}, body: "" }))).toBe("unknown");
  });
});

describe("probePort", () => {
  let server: http.Server;
  let port = 0;
  let closedPort = 0;

  beforeAll(async () => {
    server = http.createServer((_req, res) => res.end("ok"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;

    // claim a port and release it, so probing it deterministically fails
    const temp = net.createServer();
    await new Promise<void>((resolve) => temp.listen(0, "127.0.0.1", resolve));
    closedPort = (temp.address() as { port: number }).port;
    await new Promise<void>((resolve) => temp.close(() => resolve()));
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("reports a listening port as running", async () => {
    expect(await probePort(port)).toBe(true);
  });

  it("reports a closed port as not running", async () => {
    expect(await probePort(closedPort)).toBe(false);
  });
});

describe("verifyProjectMatch", () => {
  let server: http.Server;
  let port = 0;
  let tmpRoot: string;
  const TITLE = "Design Studio Demo";

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if ((req.url ?? "/") === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<!DOCTYPE html><html><head><title>${TITLE}</title></head><body></body></html>`);
        return;
      }
      // reachable, but with a different title than the local about.html
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<!DOCTYPE html><html><head><title>About - foreign server</title></head><body></body></html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;

    tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ds-match-"));
    await fs.promises.writeFile(
      path.join(tmpRoot, "index.html"),
      `<!DOCTYPE html><html><head><title>${TITLE}</title></head><body></body></html>`
    );
    await fs.promises.writeFile(
      path.join(tmpRoot, "about.html"),
      "<!DOCTYPE html><html><head><title>About</title></head><body></body></html>"
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  });

  const origin = () => `http://127.0.0.1:${port}`;

  it("confirms a server when served title matches the workspace entry", async () => {
    expect(await verifyProjectMatch(origin(), tmpRoot, ["index.html"])).toBe(true);
  });

  it("disproves a server when a reachable entry has a different title", async () => {
    expect(await verifyProjectMatch(origin(), tmpRoot, ["about.html"])).toBe(false);
  });

  it("returns null when no entry can be checked", async () => {
    expect(await verifyProjectMatch(origin(), tmpRoot, ["missing.html"])).toBe(null);
  });
});

describe("detectDevServers", () => {
  let devServer: http.Server;
  let foreignServer: net.Server;
  let port = 0;
  let foreignPort = 0;
  let tmpRoot: string;

  beforeAll(async () => {
    const TITLE = "Design Studio Demo";
    devServer = http.createServer((req, res) => {
      if ((req.url ?? "/") === "/index.html") {
        res.writeHead(200);
        res.end(`<!DOCTYPE html><html><head><title>${TITLE}</title></head><body></body></html>`);
        return;
      }
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => devServer.listen(0, "127.0.0.1", resolve));
    port = (devServer.address() as { port: number }).port;

    // accepts TCP but speaks no HTTP — the false-positive trap
    foreignServer = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => foreignServer.listen(0, "127.0.0.1", resolve));
    foreignPort = (foreignServer.address() as { port: number }).port;

    tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ds-detector-"));
    await fs.promises.writeFile(
      path.join(tmpRoot, "package.json"),
      JSON.stringify({
        name: "app",
        scripts: {
          dev: `my-http-server --port ${port}`,
          // "serve" as a command name produces a candidate; the process speaks no HTTP
          serve: `rsync-serve --port ${foreignPort}`,
          build: "tsc",
        },
      })
    );
    await fs.promises.writeFile(
      path.join(tmpRoot, "index.html"),
      `<!DOCTYPE html><html><head><title>${TITLE}</title></head><body></body></html>`
    );
  });

  afterAll(async () => {
    devServer.closeAllConnections();
    await new Promise<void>((resolve) => devServer.close(() => resolve()));
    await new Promise<void>((resolve) => foreignServer.close(() => resolve()));
    await fs.promises.rm(tmpRoot, { recursive: true, force: true });
  });

  it("puts a project-verified server first and demotes a live foreign port", async () => {
    const candidates = await detectDevServers(tmpRoot, ["index.html"]);
    expect(candidates[0]).toEqual({
      url: `http://localhost:${port}`,
      script: "dev",
      running: true,
      kind: "static-http",
      matchesProject: true,
    });
    const foreign = candidates.find((c) => c.url === `http://localhost:${foreignPort}`);
    expect(foreign?.running).toBe(true);
    expect(foreign?.kind).toBe("unknown");
    expect(foreign?.matchesProject).toBe(null);
    expect(candidates.indexOf(candidates[0])).toBeLessThan(candidates.indexOf(foreign!));
  });

  it("proves a live port is foreign when served entries mismatch", async () => {
    // index.html title differs from what the sync server would serve (nothing);
    // the http path: check the HTTP server does serve a mismatching entry
    await fs.promises.writeFile(
      path.join(tmpRoot, "other.html"),
      "<!DOCTYPE html><html><head><title>Different Page</title></head><body></body></html>"
    );
    const candidates = await detectDevServers(tmpRoot, ["other.html"]);
    const own = candidates.find((c) => c.url === `http://localhost:${port}`);
    expect(own?.matchesProject).toBe(false);
    await fs.promises.rm(path.join(tmpRoot, "other.html"));
  });

  it("returns an empty list when package.json is missing", async () => {
    const emptyRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "ds-empty-"));
    try {
      expect(await detectDevServers(emptyRoot)).toEqual([]);
    } finally {
      await fs.promises.rm(emptyRoot, { recursive: true, force: true });
    }
  });
});
